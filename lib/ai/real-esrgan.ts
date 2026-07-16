import { runPersistentAiJob } from "@/lib/ai/ai-worker-client";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";

import type { ImageAiOptions } from "@/lib/media/image-types";

interface RealEsrganRunOptions {
  inputPath: string;
  outputPath: string;
  options: ImageAiOptions;
  signal?: AbortSignal;
}

export async function runRealEsrgan({
  inputPath,
  outputPath,
  options,
  signal,
}: RealEsrganRunOptions) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.ai.realEsrgan) {
    throw new AppError(
      capabilities.ai.reason ?? "Real-ESRGANを利用できません。",
      503,
      "REAL_ESRGAN_UNAVAILABLE",
    );
  }
  if (options.faceCorrection !== "off" && !capabilities.ai.gfpgan) {
    throw new AppError(
      "GFPGANまたは顔補正モデルを利用できません。GFPGAN_MODEL_PATHを確認してください。",
      503,
      "GFPGAN_UNAVAILABLE",
    );
  }

  const strength =
    options.strength === "weak" ? 0.35 : options.strength === "standard" ? 0.7 : 1;
  const denoise = options.removeCompressionNoise ? 8 : 0;
  const faceStrength =
    options.faceCorrection === "off"
      ? 0
      : options.faceCorrection === "weak"
        ? 0.35
        : options.faceCorrection === "standard"
          ? 0.7
          : 1;
  await runPersistentAiJob(
    {
      type: "image",
      inputPath,
      outputPath,
      scale: options.scale,
      model: options.model,
      denoise,
      strength,
      faceStrength,
    },
    { signal, timeoutMs: 10 * 60 * 1000 },
  );
}
