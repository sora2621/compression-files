import { runCommand, type CommandRunner } from "@/infrastructure/process/command-runner";
import { AppError } from "@/lib/errors";
import {
  calculateFfmpegProgress,
  FfmpegProgressParser,
} from "@/lib/progress/ffmpeg-progress";
import { logger } from "@/shared/logging/logger";
import { createProcessingTimer } from "@/shared/logging/processing-timer";

import type { FfmpegProgressMetrics } from "@/lib/progress/types";

const VIDEO_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;

export interface RunVideoCommandOptions {
  executable: string;
  args: readonly string[];
  duration: number;
  fps: number | null;
  signal?: AbortSignal;
  runner?: CommandRunner;
  onProgress?: (progress: number, metrics?: FfmpegProgressMetrics) => void;
  jobId?: string;
}

export async function runVideoCommand(options: RunVideoCommandOptions) {
  const timer = createProcessingTimer({ jobId: options.jobId });
  const startedAt = performance.now();
  const fpsSamples: number[] = [];
  const speedSamples: number[] = [];
  const progressParser = new FfmpegProgressParser((metrics) => {
    if (metrics.fps !== undefined && metrics.fps >= 0) fpsSamples.push(metrics.fps);
    if (metrics.speedMultiplier !== undefined && metrics.speedMultiplier >= 0) {
      speedSamples.push(metrics.speedMultiplier);
    }
    options.onProgress?.(
      calculateFfmpegProgress(
        metrics,
        options.duration,
        options.fps !== null && options.fps > 0
          ? Math.round(options.duration * options.fps)
          : undefined,
      ),
      metrics,
    );
  });
  await timer.measure("ffmpeg-processing", () =>
    (options.runner ?? runCommand)(options.executable, options.args, {
      timeoutMs: VIDEO_PROCESS_TIMEOUT_MS,
      signal: options.signal,
      stderrLimitBytes: 10_000,
      onStdout: (chunk) => progressParser.push(chunk),
      createAbortError: () =>
        new AppError("動画処理をキャンセルしました。", 499, "CANCELLED"),
      createTimeoutError: () =>
        new AppError(
          "動画の処理がタイムアウトしました。より短い動画か低い解像度でお試しください。",
          408,
          "PROCESS_TIMEOUT",
        ),
      createFailureError: () => {
        logger.error({
          stage: "video-processing",
          errorCode: "VIDEO_PROCESS_FAILED",
        });
        return new AppError(
          "動画を処理できませんでした。コーデック、音声設定、またはファイルの破損を確認してください。",
          422,
          "VIDEO_PROCESS_FAILED",
        );
      },
    }),
  );
  progressParser.finish();
  options.onProgress?.(99);
  return {
    encodingMilliseconds: Number((performance.now() - startedAt).toFixed(3)),
    fpsSamples,
    speedSamples,
  } as const;
}
