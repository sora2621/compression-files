import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import ffmpegPath from "ffmpeg-static";

import { runVideoFramesRealEsrgan } from "@/lib/ai/video-real-esrgan";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";
import { logger } from "@/shared/logging/logger";

import {
  CRF_MAP,
  selectedVideoHeight,
  type VideoAiOptions,
  type VideoCompressionOptions,
  type VideoMediaInfo,
} from "./video-types";

interface VideoAiProcessOptions {
  inputPath: string;
  directory: string;
  originalName: string;
  compression: VideoCompressionOptions;
  sourceInfo: VideoMediaInfo;
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string) => void;
}

function encoder(codec: VideoCompressionOptions["codec"]) {
  if (codec === "h264") return "libx264";
  if (codec === "h265") return "libx265";
  if (codec === "vp9") return "libvpx-vp9";
  return "libaom-av1";
}

async function runFfmpeg(
  args: string[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
  errorMessage: string,
) {
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable)
    throw new AppError("FFmpegが見つかりません。", 503, "FFMPEG_NOT_FOUND");
  await new Promise<void>((resolve, reject) => {
    const safeArgs = ["-protocol_whitelist", "file,pipe,crypto,data", ...args];
    const child = spawn(executable, safeArgs, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
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
      finish(new AppError("AI動画処理をキャンセルしました。", 499, "CANCELLED"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new AppError("AI動画処理がタイムアウトしました。", 408, "AI_VIDEO_TIMEOUT"));
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    child.stderr.resume();
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else {
        logger.error({
          stage: "ai-video-ffmpeg",
          errorCode: "AI_VIDEO_FFMPEG_FAILED",
        });
        finish(new AppError(errorMessage, 422, "AI_VIDEO_FFMPEG_FAILED"));
      }
    });
  });
}

export async function processVideoAiSuperResolution({
  inputPath,
  directory,
  compression,
  sourceInfo,
  signal,
  onProgress,
}: VideoAiProcessOptions) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.ai.realEsrgan) {
    throw new AppError(
      capabilities.ai.reason ?? "Real-ESRGANを利用できません。",
      503,
      "REAL_ESRGAN_UNAVAILABLE",
    );
  }
  const details = await stat(inputPath);
  const durationLimit = capabilities.ai.gpu ? 60 : 10;
  if (details.size > 100 * 1024 * 1024) {
    throw new AppError(
      "AI動画処理は100MB以下に制限されています。",
      413,
      "AI_VIDEO_TOO_LARGE",
    );
  }
  if (sourceInfo.duration > durationLimit) {
    throw new AppError(
      `AI動画処理の時間上限は現在の環境で${durationLimit}秒です。`,
      413,
      "AI_VIDEO_TOO_LONG",
    );
  }
  if (sourceInfo.width * sourceInfo.height > 1920 * 1080) {
    throw new AppError(
      "AI動画処理の入力解像度上限は1920×1080です。先に解像度を下げてください。",
      413,
      "AI_VIDEO_RESOLUTION_TOO_LARGE",
    );
  }
  const ai: VideoAiOptions = compression.ai ?? {
    scale: 2,
    model: "photo",
    removeCompressionNoise: false,
    strength: "standard",
  };
  if (sourceInfo.width * sourceInfo.height * ai.scale * ai.scale > 64_000_000) {
    throw new AppError(
      "AI処理後の総画素数が上限を超えます。",
      413,
      "AI_VIDEO_OUTPUT_TOO_LARGE",
    );
  }
  const fps = sourceInfo.fps ?? 30;
  const inputFrames = join(/*turbopackIgnore: true*/ directory, "ai-frames-input");
  const outputFrames = join(/*turbopackIgnore: true*/ directory, "ai-frames-output");
  const audioPath = join(/*turbopackIgnore: true*/ directory, "ai-audio.mka");
  const container =
    compression.outputContainer && compression.outputContainer !== "source"
      ? compression.outputContainer
      : compression.codec === "vp9" || compression.codec === "av1"
        ? "webm"
        : "mp4";
  const mime =
    container === "webm"
      ? "video/webm"
      : container === "mkv"
        ? "video/x-matroska"
        : container === "mov"
          ? "video/quicktime"
          : "video/mp4";
  if (!capabilities.outputs.video.includes(container)) {
    throw new AppError(
      `${container.toUpperCase()}出力は、このFFmpegでは利用できません。`,
      422,
      "VIDEO_OUTPUT_UNAVAILABLE",
    );
  }
  if (!capabilities.ffmpeg.encoders.includes(encoder(compression.codec))) {
    throw new AppError(
      `${encoder(compression.codec)}エンコーダーを利用できません。`,
      422,
      "VIDEO_ENCODER_UNAVAILABLE",
    );
  }
  if (
    (container === "webm" &&
      compression.codec !== "vp9" &&
      compression.codec !== "av1") ||
    ((container === "mp4" || container === "mov") && compression.codec === "vp9")
  ) {
    throw new AppError(
      "選択した動画コンテナとコーデックの組み合わせには対応していません。",
      422,
      "INCOMPATIBLE_VIDEO_OUTPUT",
    );
  }
  const outputName = `generated-ai-video-output.${container}`;
  const outputPath = join(/*turbopackIgnore: true*/ directory, outputName);
  const videoOnly = join(
    /*turbopackIgnore: true*/ directory,
    `ai-video-only.${container}`,
  );

  try {
    await mkdir(inputFrames, { recursive: false });
    await mkdir(outputFrames, { recursive: false });
    onProgress?.(1, "動画をフレームへ分解中");
    await runFfmpeg(
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-vsync",
        "0",
        join(/*turbopackIgnore: true*/ inputFrames, "frame-%08d.png"),
      ],
      signal,
      10 * 60 * 1000,
      "動画フレームを抽出できませんでした。",
    );

    if (sourceInfo.audioCodec) {
      onProgress?.(8, "元動画の音声を抽出中");
      await runFfmpeg(
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-i",
          inputPath,
          "-map",
          "0:a:0",
          "-vn",
          "-c:a",
          "copy",
          audioPath,
        ],
        signal,
        5 * 60 * 1000,
        "元動画の音声を抽出できませんでした。",
      );
    }

    onProgress?.(10, "Real-ESRGAN処理を待機中");
    await runVideoFramesRealEsrgan({
      inputDirectory: inputFrames,
      outputDirectory: outputFrames,
      options: ai,
      signal,
      onProgress: (current, total) =>
        onProgress?.(
          10 + (current / total) * 72,
          `AI高画質化中 (${current}/${total}フレーム)`,
        ),
    });

    onProgress?.(83, "元のFPSで動画を再構築中");
    const targetHeight = selectedVideoHeight(compression);
    const rebuildArgs = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-framerate",
      String(fps),
      "-i",
      join(/*turbopackIgnore: true*/ outputFrames, "frame-%08d.png"),
    ];
    if (targetHeight !== null) {
      rebuildArgs.push("-vf", `scale=-2:${targetHeight}:flags=lanczos`);
    }
    rebuildArgs.push(
      "-an",
      "-c:v",
      encoder(compression.codec),
      "-crf",
      String(CRF_MAP[compression.codec][compression.quality]),
      "-pix_fmt",
      "yuv420p",
    );
    if (compression.codec === "h264" || compression.codec === "h265") {
      rebuildArgs.push("-preset", "medium");
    } else {
      rebuildArgs.push("-b:v", "0");
    }
    rebuildArgs.push(videoOnly);
    await runFfmpeg(
      rebuildArgs,
      signal,
      30 * 60 * 1000,
      "AI処理したフレームから動画を再構築できませんでした。",
    );

    if (sourceInfo.audioCodec) {
      onProgress?.(95, "元音声を再結合中");
      const muxArgs = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        videoOnly,
        "-i",
        audioPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
      ];
      if (compression.audio === "copy") {
        muxArgs.push("-c:a", "copy");
      } else if (compression.audio.startsWith("opus")) {
        muxArgs.push(
          "-c:a",
          "libopus",
          "-b:a",
          compression.audio === "opus128" ? "128k" : "96k",
        );
      } else {
        muxArgs.push(
          "-c:a",
          "aac",
          "-b:a",
          compression.audio === "aac128" ? "128k" : "96k",
        );
      }
      if (compression.removeMetadata) {
        muxArgs.push("-map_metadata", "-1", "-map_chapters", "-1");
      }
      muxArgs.push(outputPath);
      await runFfmpeg(
        muxArgs,
        signal,
        10 * 60 * 1000,
        "AI動画と元音声を結合できませんでした。",
      );
    } else {
      await rename(videoOnly, outputPath);
    }
    onProgress?.(100, "AI動画処理が完了しました");
    return {
      outputName,
      outputPath,
      outputMime: mime,
      shouldReencode: true,
      crf: CRF_MAP[compression.codec][compression.quality],
      metadata: {
        detected: compression.removeMetadata,
        types: compression.removeMetadata ? ["コンテナメタデータ", "チャプター"] : [],
        fields: [],
      },
      removedMetadataTypes: compression.removeMetadata
        ? ["コンテナメタデータ", "チャプター"]
        : [],
    };
  } finally {
    await Promise.allSettled([
      rm(inputFrames, { recursive: true, force: true }),
      rm(outputFrames, { recursive: true, force: true }),
      rm(audioPath, { force: true }),
      rm(videoOnly, { force: true }),
    ]);
  }
}
