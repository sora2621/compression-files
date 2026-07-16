import { spawn } from "node:child_process";
import { extname, join } from "node:path";

import ffmpegPath from "ffmpeg-static";

import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";
import { runScheduledProcessingJob } from "@/lib/jobs/processing-scheduler";
import {
  calculateFfmpegProgress,
  FfmpegProgressParser,
} from "@/lib/progress/ffmpeg-progress";
import { logger } from "@/shared/logging/logger";

import {
  AUDIO_BITRATE_MAP,
  type LossyAudioOutputFormat,
  type AudioOutputFormat,
  type AudioProcessingOptions,
} from "./audio-types";
import { isStrictLosslessProcessingMode } from "./image-types";

import type { AudioMediaInfo } from "./video-types";
import type { FfmpegProgressMetrics } from "@/lib/progress/types";

interface AudioProcessOptions {
  inputPath: string;
  directory: string;
  originalName: string;
  sourceInfo: AudioMediaInfo;
  options: AudioProcessingOptions;
  onProgress?: (progress: number, metrics?: FfmpegProgressMetrics) => void;
  signal?: AbortSignal;
}

const OUTPUT: Record<
  AudioOutputFormat,
  { extension: string; mime: string; encoder: string; muxer: string }
> = {
  mp3: { extension: ".mp3", mime: "audio/mpeg", encoder: "libmp3lame", muxer: "mp3" },
  m4a: { extension: ".m4a", mime: "audio/mp4", encoder: "aac", muxer: "ipod" },
  aac: { extension: ".aac", mime: "audio/aac", encoder: "aac", muxer: "adts" },
  opus: { extension: ".opus", mime: "audio/opus", encoder: "libopus", muxer: "opus" },
  ogg: { extension: ".ogg", mime: "audio/ogg", encoder: "libvorbis", muxer: "ogg" },
  flac: { extension: ".flac", mime: "audio/flac", encoder: "flac", muxer: "flac" },
  wav: { extension: ".wav", mime: "audio/wav", encoder: "pcm_s16le", muxer: "wav" },
};

function sourceCopyFormat(
  source: AudioMediaInfo,
  originalName: string,
): AudioOutputFormat | null {
  const names = new Set(source.formatName.toLowerCase().split(","));
  const extension = extname(originalName).toLowerCase();
  if (names.has("mp3") && source.audioCodec === "mp3") return "mp3";
  if (
    (names.has("mov") || names.has("mp4") || names.has("m4a")) &&
    source.audioCodec === "aac"
  )
    return "m4a";
  if (names.has("aac") && source.audioCodec === "aac") return "aac";
  if ((names.has("opus") || names.has("ogg")) && source.audioCodec === "opus") {
    return extension === ".ogg" ? "ogg" : "opus";
  }
  if (names.has("ogg") && source.audioCodec === "vorbis") return "ogg";
  if (names.has("flac") && source.audioCodec === "flac") return "flac";
  if (names.has("wav") && source.audioCodec.startsWith("pcm_")) return "wav";
  return null;
}

async function assertAudioOutput(format: AudioOutputFormat, reencode: boolean) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.outputs.audio.includes(format)) {
    throw new AppError(
      `${format.toUpperCase()}出力は、このFFmpegでは利用できません。`,
      422,
      "AUDIO_OUTPUT_UNAVAILABLE",
    );
  }
  if (reencode && !capabilities.ffmpeg.encoders.includes(OUTPUT[format].encoder)) {
    throw new AppError(
      `${OUTPUT[format].encoder}エンコーダーは、このFFmpegでは利用できません。`,
      422,
      "AUDIO_ENCODER_UNAVAILABLE",
    );
  }
}

export async function processAudio({
  inputPath,
  directory,
  originalName,
  sourceInfo,
  options,
  onProgress,
  signal,
}: AudioProcessOptions) {
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable) {
    throw new AppError("FFmpegが見つかりません。", 503, "FFMPEG_NOT_FOUND");
  }
  if (
    options.processingMode === "improve-quality" ||
    options.processingMode === "improve-and-reduce"
  ) {
    throw new AppError(
      "音声の画質改善モードは未対応です。容量削減・形式変換・メタデータ削除・無劣化を選択してください。",
      400,
      "AUDIO_ENHANCEMENT_UNSUPPORTED",
    );
  }
  const copyFormat = sourceCopyFormat(sourceInfo, originalName);
  const copy = options.processingMode === "metadata-only" && copyFormat !== null;
  if (options.processingMode === "metadata-only" && !copyFormat) {
    throw new AppError(
      "この入力形式は対応出力へストリームコピーできません。形式変換を選択してください。",
      422,
      "AUDIO_COPY_UNSUPPORTED",
    );
  }
  if (
    isStrictLosslessProcessingMode(options.processingMode) &&
    options.outputFormat !== "flac" &&
    options.outputFormat !== "wav"
  ) {
    throw new AppError(
      "音声の無劣化モードではFLACまたはWAVを選択してください。",
      400,
      "LOSSLESS_AUDIO_OUTPUT_REQUIRED",
    );
  }

  const outputFormat = copy ? copyFormat : options.outputFormat;
  if (!outputFormat) {
    throw new AppError("音声出力形式を決定できません。", 422, "AUDIO_OUTPUT_INVALID");
  }
  await assertAudioOutput(outputFormat, !copy);
  const output = OUTPUT[outputFormat];
  const outputName = `generated-audio-output${output.extension}`;
  const outputPath = join(/*turbopackIgnore: true*/ directory, outputName);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file,pipe,crypto,data",
    "-i",
    inputPath,
    "-map",
    "0:a:0",
    "-vn",
  ];
  if (copy) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", output.encoder);
    if (outputFormat in AUDIO_BITRATE_MAP) {
      args.push(
        "-b:a",
        AUDIO_BITRATE_MAP[outputFormat as LossyAudioOutputFormat][options.quality],
      );
    }
    if (outputFormat === "flac") args.push("-compression_level", "8");
  }
  if (options.removeMetadata || options.processingMode === "metadata-only") {
    args.push("-map_metadata", "-1", "-map_chapters", "-1");
  }
  args.push("-f", output.muxer, "-progress", "pipe:1", "-nostats", outputPath);

  onProgress?.(0);
  await runScheduledProcessingJob(
    "audio",
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(executable, args, {
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let settled = false;
        const progressParser = new FfmpegProgressParser((metrics) => {
          onProgress?.(calculateFfmpegProgress(metrics, sourceInfo.duration), metrics);
        });
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => {
          child.kill("SIGKILL");
          finish(new AppError("音声処理をキャンセルしました。", 499, "CANCELLED"));
        };
        const timer = setTimeout(
          () => {
            child.kill("SIGKILL");
            finish(
              new AppError("音声処理がタイムアウトしました。", 408, "AUDIO_TIMEOUT"),
            );
          },
          15 * 60 * 1000,
        );
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: Buffer) => {
          progressParser.push(chunk);
        });
        child.stderr.resume();
        child.once("error", finish);
        child.once("close", (code) => {
          if (code === 0) {
            progressParser.finish();
            onProgress?.(99);
            finish();
          } else {
            logger.error({
              stage: "audio-processing",
              errorCode: "AUDIO_PROCESS_FAILED",
            });
            finish(
              new AppError(
                "音声を処理できませんでした。入力コーデックと出力形式の組み合わせをご確認ください。",
                422,
                "AUDIO_PROCESS_FAILED",
              ),
            );
          }
        });
      }),
    signal,
  );

  const metadataRemoved =
    options.removeMetadata || options.processingMode === "metadata-only";
  return {
    outputName,
    outputPath,
    outputMime: output.mime,
    outputFormat,
    copy,
    bitrate:
      outputFormat in AUDIO_BITRATE_MAP
        ? AUDIO_BITRATE_MAP[outputFormat as LossyAudioOutputFormat][options.quality]
        : null,
    metadata: {
      detected: metadataRemoved,
      types: metadataRemoved ? ["コンテナメタデータ", "チャプター"] : [],
      fields: [],
    },
    removedMetadataTypes: metadataRemoved ? ["コンテナメタデータ", "チャプター"] : [],
  };
}
