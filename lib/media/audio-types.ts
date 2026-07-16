import { getOutputFormatsForCategory } from "@/shared/media/output-formats";

import { isProcessingMode } from "./image-types";

import type { ProcessingMode } from "./image-types";
import type { AudioOutputFormatValue } from "@/shared/media/output-formats";

export const AUDIO_OUTPUT_FORMATS = getOutputFormatsForCategory("audio").map(
  (definition) => definition.value,
) as AudioOutputFormatValue[];
export type AudioOutputFormat = AudioOutputFormatValue;
export type LossyAudioOutputFormat = "mp3" | "m4a" | "aac" | "opus" | "ogg";

export const AUDIO_QUALITIES = ["high", "balanced", "small"] as const;
export type AudioQuality = (typeof AUDIO_QUALITIES)[number];

export interface AudioProcessingOptions {
  processingMode: ProcessingMode;
  outputFormat: AudioOutputFormat;
  quality: AudioQuality;
  removeMetadata: boolean;
  speedPreset?: import("@/lib/processing/types").ProcessingSpeedPreset;
}

export const DEFAULT_AUDIO_PROCESSING_OPTIONS: AudioProcessingOptions = {
  processingMode: "reduce-size",
  outputFormat: "mp3",
  quality: "balanced",
  removeMetadata: true,
  speedPreset: "balanced",
};

export const AUDIO_BITRATE_MAP: Record<
  LossyAudioOutputFormat,
  Record<AudioQuality, string>
> = {
  mp3: { high: "192k", balanced: "128k", small: "96k" },
  m4a: { high: "192k", balanced: "128k", small: "96k" },
  aac: { high: "192k", balanced: "128k", small: "96k" },
  opus: { high: "128k", balanced: "96k", small: "64k" },
  ogg: { high: "192k", balanced: "128k", small: "96k" },
};

export function isAudioProcessingOptions(
  value: unknown,
): value is AudioProcessingOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<AudioProcessingOptions>;
  return (
    isProcessingMode(options.processingMode) &&
    AUDIO_OUTPUT_FORMATS.includes(options.outputFormat as AudioOutputFormat) &&
    AUDIO_QUALITIES.includes(options.quality as AudioQuality) &&
    typeof options.removeMetadata === "boolean" &&
    (options.speedPreset === undefined ||
      ["fast", "balanced", "maximum-compression"].includes(options.speedPreset))
  );
}
