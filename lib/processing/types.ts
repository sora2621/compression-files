export const PROCESSING_SPEED_PRESETS = [
  "fast",
  "balanced",
  "maximum-compression",
] as const;

export type ProcessingSpeedPreset = (typeof PROCESSING_SPEED_PRESETS)[number];
export type VideoEncodingSpeed = ProcessingSpeedPreset;

export const DEFAULT_PROCESSING_SPEED_PRESET: ProcessingSpeedPreset = "balanced";

export type ProcessingPath =
  | { type: "return-original"; reason: string }
  | { type: "stream-copy" }
  | { type: "image-optimization" }
  | { type: "video-transcode" }
  | { type: "ai-processing" };

export type VideoProcessingPath =
  | { type: "return-original"; reason: string }
  | { type: "stream-copy" }
  | { type: "hardware-encode"; encoder: string }
  | { type: "software-encode"; encoder: string }
  | { type: "ai-enhancement" };

export function isProcessingSpeedPreset(value: unknown): value is ProcessingSpeedPreset {
  return PROCESSING_SPEED_PRESETS.includes(value as ProcessingSpeedPreset);
}

export function normalizeProcessingSpeedPreset(value: unknown): ProcessingSpeedPreset {
  return isProcessingSpeedPreset(value) ? value : DEFAULT_PROCESSING_SPEED_PRESET;
}

/** Two-pass is intentionally opt-in because it decodes the complete video twice. */
export function usesTwoPassVideoEncoding(value: unknown) {
  return normalizeProcessingSpeedPreset(value) === "maximum-compression";
}
