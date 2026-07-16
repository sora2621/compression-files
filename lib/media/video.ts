import { unlink } from "node:fs/promises";
import { extname, join } from "node:path";

import ffmpegPath from "ffmpeg-static";

import { buildFfmpegArgs } from "@/infrastructure/ffmpeg/video-arguments";
import { runVideoCommand } from "@/infrastructure/ffmpeg/video-command-runner";
import { probeAudio, probeMedia, probeVideo } from "@/infrastructure/ffprobe/media-probe";
import { selectHardwareEncoder } from "@/lib/capabilities/hardware-acceleration";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";
import { runScheduledProcessingJob } from "@/lib/jobs/processing-scheduler";
import { createVideoPerformanceMetrics } from "@/lib/performance/video-performance";
import { decideVideoProcessingPath } from "@/lib/processing/path";
import { normalizeProcessingSpeedPreset } from "@/lib/processing/types";

import {
  CRF_MAP,
  DEFAULT_VIDEO_COMPRESSION_OPTIONS,
  canCopyAudioCodecToContainer,
  canCopyVideoCodecToContainer,
  type VideoCompressionOptions,
  type VideoMediaInfo,
  type VideoOutputContainer,
} from "./video-types";

import type { CommandRunner } from "@/infrastructure/process/command-runner";
import type { FfmpegProgressMetrics } from "@/lib/progress/types";

// Keep the original public entry point stable while implementations live at
// the external-tool boundary.
export { buildFfmpegArgs, probeAudio, probeMedia, probeVideo };

export interface VideoProcessOptions {
  inputPath: string;
  directory: string;
  originalName: string;
  compression: VideoCompressionOptions;
  sourceInfo: VideoMediaInfo;
  onProgress?: (progress: number, metrics?: FfmpegProgressMetrics) => void;
  signal?: AbortSignal;
  ffmpegExecutable?: string;
  runner?: CommandRunner;
  jobId?: string;
  onEncoderSelected?: (encoder: string, hardware: boolean) => void;
}

const OUTPUT_MIME: Record<Exclude<VideoOutputContainer, "source">, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

function sourceOutputContainer(
  formatName: string,
  originalName: string,
): Exclude<VideoOutputContainer, "source"> {
  const names = new Set(formatName.toLowerCase().split(","));
  const hint = extname(originalName).toLowerCase();
  if (names.has("webm")) return "webm";
  if (names.has("matroska")) return hint === ".webm" ? "webm" : "mkv";
  if (names.has("mov") || names.has("mp4")) {
    return hint === ".mov" ? "mov" : "mp4";
  }
  return "mkv";
}

function selectedOutputContainer(options: VideoProcessOptions, reencode: boolean) {
  const selected = options.compression.outputContainer ?? "source";
  if (selected !== "source") return selected;
  if (reencode) {
    return options.compression.codec === "vp9" || options.compression.codec === "av1"
      ? "webm"
      : "mp4";
  }
  return sourceOutputContainer(options.sourceInfo.formatName, options.originalName);
}

function encoderForCodec(codec: VideoCompressionOptions["codec"]) {
  if (codec === "h264") return "libx264";
  if (codec === "h265") return "libx265";
  if (codec === "vp9") return "libvpx-vp9";
  return "libaom-av1";
}

export async function runVideoEncoderWithFallback<T>(options: {
  hardwareEncoder?: string;
  signal?: AbortSignal;
  runHardware: () => Promise<T>;
  runSoftware: () => Promise<T>;
}) {
  if (!options.hardwareEncoder) {
    return { value: await options.runSoftware(), hardwareFallback: false } as const;
  }
  try {
    return { value: await options.runHardware(), hardwareFallback: false } as const;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { value: await options.runSoftware(), hardwareFallback: true } as const;
  }
}

async function assertVideoCombination(
  compression: VideoCompressionOptions,
  container: Exclude<VideoOutputContainer, "source">,
  shouldReencode: boolean,
) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.ffmpeg.available) {
    throw new AppError(
      "FFmpegを利用できません。サーバー設定を確認してください。",
      503,
      "FFMPEG_UNAVAILABLE",
    );
  }
  if (!capabilities.outputs.video.includes(container)) {
    throw new AppError(
      `${container.toUpperCase()}出力は、このFFmpegでは利用できません。`,
      422,
      "VIDEO_OUTPUT_UNAVAILABLE",
    );
  }
  if (!shouldReencode) return capabilities;

  const allowed =
    container === "webm"
      ? new Set(["vp9", "av1"])
      : container === "mp4"
        ? new Set(["h264", "h265", "av1"])
        : container === "mov"
          ? new Set(["h264", "h265"])
          : new Set(["h264", "h265", "vp9", "av1"]);
  if (!allowed.has(compression.codec)) {
    throw new AppError(
      `${container.toUpperCase()}と${compression.codec.toUpperCase()}の組み合わせには対応していません。出力形式またはコーデックを変更してください。`,
      422,
      "INCOMPATIBLE_VIDEO_OUTPUT",
    );
  }
  const encoder = encoderForCodec(compression.codec);
  if (!capabilities.ffmpeg.encoders.includes(encoder)) {
    throw new AppError(
      `${encoder}エンコーダーは、このFFmpegでは利用できません。`,
      422,
      "VIDEO_ENCODER_UNAVAILABLE",
    );
  }
  if (container === "webm" && compression.audio.startsWith("aac")) {
    throw new AppError(
      "WebMではAACを使用できません。Opusまたは元のままを選択してください。",
      422,
      "INCOMPATIBLE_AUDIO_OUTPUT",
    );
  }
  const selectedAudioCodec = compression.audio.startsWith("aac")
    ? "aac"
    : compression.audio.startsWith("opus")
      ? "opus"
      : compression.audio === "vorbis128"
        ? "vorbis"
        : compression.audio;
  const allowedAudio =
    container === "mp4"
      ? new Set(["copy", "aac"])
      : container === "webm"
        ? new Set(["copy", "opus", "vorbis"])
        : container === "mov"
          ? new Set(["copy", "aac", "pcm"])
          : new Set(["copy", "aac", "opus", "flac"]);
  if (!allowedAudio.has(selectedAudioCodec)) {
    throw new AppError(
      `${container.toUpperCase()}では選択した音声コーデックを使用できません。`,
      422,
      "INCOMPATIBLE_AUDIO_OUTPUT",
    );
  }
  if (
    compression.audio.startsWith("opus") &&
    !capabilities.ffmpeg.encoders.includes("libopus")
  ) {
    throw new AppError(
      "Opusエンコーダーは、このFFmpegでは利用できません。",
      422,
      "AUDIO_ENCODER_UNAVAILABLE",
    );
  }
  if (
    compression.audio.startsWith("aac") &&
    !capabilities.ffmpeg.encoders.includes("aac")
  ) {
    throw new AppError(
      "AACエンコーダーは、このFFmpegでは利用できません。",
      422,
      "AUDIO_ENCODER_UNAVAILABLE",
    );
  }
  const optionalEncoder =
    compression.audio === "vorbis128"
      ? "libvorbis"
      : compression.audio === "flac"
        ? "flac"
        : compression.audio === "pcm"
          ? "pcm_s16le"
          : null;
  if (optionalEncoder && !capabilities.ffmpeg.encoders.includes(optionalEncoder)) {
    throw new AppError(
      `${optionalEncoder}エンコーダーは、このFFmpegでは利用できません。`,
      422,
      "AUDIO_ENCODER_UNAVAILABLE",
    );
  }
  return capabilities;
}

export async function processVideoCompression(options: VideoProcessOptions) {
  const executable = options.ffmpegExecutable ?? process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable) {
    throw new AppError(
      "FFmpegが見つかりません。サーバーのセットアップを確認してください。",
      500,
      "FFMPEG_NOT_FOUND",
    );
  }

  const preliminaryPath = decideVideoProcessingPath(options.compression);
  const shouldReencode =
    preliminaryPath.type === "hardware-encode" ||
    preliminaryPath.type === "software-encode";
  const container = selectedOutputContainer(options, shouldReencode);
  const videoCopyCompatible = canCopyVideoCodecToContainer(
    options.sourceInfo.videoCodec,
    container,
  );
  const audioCopyCompatible = canCopyAudioCodecToContainer(
    options.sourceInfo.audioCodec,
    container,
  );
  if (
    (!shouldReencode && (!videoCopyCompatible || !audioCopyCompatible)) ||
    (shouldReencode && options.compression.audio === "copy" && !audioCopyCompatible)
  ) {
    throw new AppError(
      "元の映像または音声コーデックを選択したコンテナへコピーできません。互換性のあるコーデックを選択してください。",
      422,
      "INCOMPATIBLE_STREAM_COPY",
    );
  }
  const capabilities = await assertVideoCombination(
    options.compression,
    container,
    shouldReencode,
  );
  const outputName = `generated-video-output.${container}`;
  const outputPath = join(/*turbopackIgnore: true*/ options.directory, outputName);
  const speedPreset = normalizeProcessingSpeedPreset(options.compression.speedPreset);
  const hardwareEncoder =
    shouldReencode && speedPreset === "fast"
      ? selectHardwareEncoder(options.compression.codec, capabilities.ffmpeg.hardware)
      : undefined;
  let processingPath = decideVideoProcessingPath(options.compression, {
    hardwareEncoder,
  });
  let command = buildFfmpegArgs(options.inputPath, outputPath, options.compression, {
    hardwareEncoder,
    sourceHeight: options.sourceInfo.height,
  });

  options.onProgress?.(0);
  const softwareEncoder = shouldReencode
    ? encoderForCodec(options.compression.codec)
    : "copy";
  const runCommand = () =>
    runVideoCommand({
      executable,
      args: command.args,
      duration: options.sourceInfo.duration,
      fps: options.sourceInfo.fps,
      signal: options.signal,
      runner: options.runner,
      onProgress: options.onProgress,
      jobId: options.jobId,
    });
  const outcome = await runVideoEncoderWithFallback({
    hardwareEncoder,
    signal: options.signal,
    runHardware: () =>
      runScheduledProcessingJob(
        "videoGpu",
        async () => {
          options.onEncoderSelected?.(hardwareEncoder ?? softwareEncoder, true);
          return runCommand();
        },
        options.signal,
      ),
    runSoftware: async () => {
      if (hardwareEncoder) {
        await unlink(outputPath).catch(() => undefined);
        command = buildFfmpegArgs(options.inputPath, outputPath, options.compression, {
          forceCpu: true,
          sourceHeight: options.sourceInfo.height,
        });
        options.onProgress?.(0);
      }
      return runScheduledProcessingJob(
        "videoCpu",
        async () => {
          options.onEncoderSelected?.(softwareEncoder, false);
          return runCommand();
        },
        options.signal,
      );
    },
  });
  const hardwareFallback = outcome.hardwareFallback;
  const commandPerformance = outcome.value;

  const encoder =
    hardwareFallback || !hardwareEncoder
      ? shouldReencode
        ? encoderForCodec(options.compression.codec)
        : "copy"
      : hardwareEncoder;
  if (hardwareFallback) {
    processingPath = decideVideoProcessingPath(options.compression);
  }
  const performanceMetrics = createVideoPerformanceMetrics({
    jobId: options.jobId ?? "untracked-job",
    encoder,
    processingMode: options.compression.mode,
    inputDurationSeconds: options.sourceInfo.duration,
    encodingMilliseconds: commandPerformance?.encodingMilliseconds ?? 0,
    fpsSamples: commandPerformance?.fpsSamples,
    speedSamples: commandPerformance?.speedSamples,
  });

  return {
    outputName,
    outputPath,
    outputMime: OUTPUT_MIME[container],
    shouldReencode: command.shouldReencode,
    hardwareEncoder: hardwareFallback ? null : (hardwareEncoder ?? null),
    hardwareFallback,
    processingPath,
    performanceMetrics,
    crf: command.shouldReencode
      ? CRF_MAP[options.compression.codec][options.compression.quality]
      : null,
    metadata: {
      detected: options.compression.removeMetadata,
      types: options.compression.removeMetadata
        ? ["コンテナメタデータ", "チャプター"]
        : [],
      fields: [],
    },
    removedMetadataTypes: options.compression.removeMetadata
      ? ["コンテナメタデータ", "チャプター"]
      : [],
  };
}

export async function processVideo(
  options: Omit<VideoProcessOptions, "compression" | "sourceInfo">,
) {
  const sourceInfo = await probeVideo(options.inputPath);
  return processVideoCompression({
    ...options,
    compression: DEFAULT_VIDEO_COMPRESSION_OPTIONS,
    sourceInfo,
  });
}
