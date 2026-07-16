import { runPersistentAiJob } from "@/lib/ai/ai-worker-client";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";
import { runQueuedAiJob } from "@/lib/jobs/ai-queue";

import type { VideoAiOptions } from "@/lib/media/video-types";

interface VideoFramesAiOptions {
  inputDirectory: string;
  outputDirectory: string;
  options: VideoAiOptions;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
}

export async function runVideoFramesRealEsrgan({
  inputDirectory,
  outputDirectory,
  options,
  signal,
  onProgress,
}: VideoFramesAiOptions) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.ai.realEsrgan) {
    throw new AppError(
      capabilities.ai.reason ?? "Real-ESRGANを利用できません。",
      503,
      "REAL_ESRGAN_UNAVAILABLE",
    );
  }
  const strength =
    options.strength === "weak" ? 0.35 : options.strength === "standard" ? 0.7 : 1;
  await runQueuedAiJob(
    () =>
      runPersistentAiJob(
        {
          type: "directory",
          inputDirectory,
          outputDirectory,
          scale: options.scale,
          model: options.model,
          denoise: options.removeCompressionNoise ? 8 : 0,
          strength,
          faceStrength: 0,
        },
        { signal, timeoutMs: 2 * 60 * 60 * 1000, onProgress },
      ),
    signal,
  );
}
