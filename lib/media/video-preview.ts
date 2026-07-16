import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

import { AppError } from "@/lib/errors";
import { logger } from "@/shared/logging/logger";

export async function generateVideoPreview(inputPath: string, outputPath: string) {
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable) {
    throw new AppError("FFmpegが見つかりません。", 503, "FFMPEG_NOT_FOUND");
  }
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
    "-t",
    "5",
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale=-2:min(480\\,ih):flags=lanczos",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    outputPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish(
          new AppError(
            "動画プレビュー生成がタイムアウトしました。",
            408,
            "PREVIEW_TIMEOUT",
          ),
        );
      },
      2 * 60 * 1000,
    );
    child.stderr.resume();
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else {
        logger.error({
          stage: "video-preview",
          errorCode: "VIDEO_PREVIEW_FAILED",
        });
        finish(
          new AppError(
            "短い動画プレビューを生成できませんでした。",
            422,
            "VIDEO_PREVIEW_FAILED",
          ),
        );
      }
    });
  });
}
