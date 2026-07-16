import { getOutputFormatsForCategory } from "@/shared/media/output-formats";

import type { ImageOutputFormatValue } from "@/shared/media/output-formats";

export const IMAGE_OUTPUT_FORMATS = getOutputFormatsForCategory("image").map(
  (definition) => definition.value,
) as ImageOutputFormatValue[];
export type ImageOutputFormat = ImageOutputFormatValue;

export const IMAGE_ENCODINGS = ["lossless", "lossy"] as const;
export type ImageEncoding = (typeof IMAGE_ENCODINGS)[number];
export type ImageOperation = "convert" | "metadata-only";

export const PROCESSING_MODES = [
  "reduce-size",
  "improve-quality",
  "improve-and-reduce",
  "convert-only",
  "metadata-only",
  "lossless",
  "strict-lossless",
  "high-quality-optimization",
  "size-priority",
  "archive",
  "target-size",
] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export interface ImageEnhancementOptions {
  sharpen: boolean;
  denoise: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  autoRotate: boolean;
  normalizeColorSpace: boolean;
}

export interface ImageAiOptions {
  enabled: boolean;
  scale: 2 | 4;
  model: "photo" | "anime";
  removeCompressionNoise: boolean;
  strength: "weak" | "standard" | "strong";
  faceCorrection: "off" | "weak" | "standard" | "strong";
}

export interface ImageOutputSettings {
  format: ImageOutputFormat;
  encoding: ImageEncoding;
  quality: number;
  jpegBackgroundColor?: string;
}

export const DEFAULT_IMAGE_OUTPUT_SETTINGS: ImageOutputSettings = {
  format: "webp",
  encoding: "lossy",
  quality: 88,
  jpegBackgroundColor: "#ffffff",
};

export const DEFAULT_IMAGE_ENHANCEMENTS: ImageEnhancementOptions = {
  sharpen: false,
  denoise: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  autoRotate: true,
  normalizeColorSpace: true,
};

export const DEFAULT_IMAGE_AI_OPTIONS: ImageAiOptions = {
  enabled: false,
  scale: 2,
  model: "photo",
  removeCompressionNoise: false,
  strength: "standard",
  faceCorrection: "off",
};

export function isImageOutputFormat(value: unknown): value is ImageOutputFormat {
  return IMAGE_OUTPUT_FORMATS.includes(value as ImageOutputFormat);
}

export function isImageEncoding(value: unknown): value is ImageEncoding {
  return IMAGE_ENCODINGS.includes(value as ImageEncoding);
}

export function normalizeImageQuality(value: unknown) {
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) return null;
  return quality;
}

export function isProcessingMode(value: unknown): value is ProcessingMode {
  return PROCESSING_MODES.includes(value as ProcessingMode);
}

export function isStrictLosslessProcessingMode(value: ProcessingMode | undefined) {
  return value === "lossless" || value === "strict-lossless";
}

export function isImageEnhancementOptions(
  value: unknown,
): value is ImageEnhancementOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<ImageEnhancementOptions>;
  return (
    typeof options.sharpen === "boolean" &&
    Number.isInteger(options.denoise) &&
    Number(options.denoise) >= 0 &&
    Number(options.denoise) <= 10 &&
    typeof options.brightness === "number" &&
    options.brightness >= 0.5 &&
    options.brightness <= 1.5 &&
    typeof options.contrast === "number" &&
    options.contrast >= 0.5 &&
    options.contrast <= 1.5 &&
    typeof options.saturation === "number" &&
    options.saturation >= 0 &&
    options.saturation <= 2 &&
    typeof options.gamma === "number" &&
    options.gamma >= 1 &&
    options.gamma <= 3 &&
    typeof options.autoRotate === "boolean" &&
    typeof options.normalizeColorSpace === "boolean"
  );
}

export function isImageAiOptions(value: unknown): value is ImageAiOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<ImageAiOptions>;
  return (
    typeof options.enabled === "boolean" &&
    (options.scale === 2 || options.scale === 4) &&
    (options.model === "photo" || options.model === "anime") &&
    typeof options.removeCompressionNoise === "boolean" &&
    (options.strength === "weak" ||
      options.strength === "standard" ||
      options.strength === "strong") &&
    (options.faceCorrection === "off" ||
      options.faceCorrection === "weak" ||
      options.faceCorrection === "standard" ||
      options.faceCorrection === "strong")
  );
}
