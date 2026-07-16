export const TARGET_SIZE_UNITS = ["KB", "MB", "GB"] as const;
export type TargetSizeUnit = (typeof TARGET_SIZE_UNITS)[number];

export const TARGET_SIZE_PRESET_IDS = [
  "email",
  "social",
  "website",
  "smartphone",
  "cloud",
  "half",
  "under-100mb",
  "custom",
] as const;
export type TargetSizePresetId = (typeof TARGET_SIZE_PRESET_IDS)[number];

export type TargetSizeFeasibility =
  "achievable" | "settings-recommended" | "quality-risk" | "difficult";

export type TargetAudioMode =
  "auto" | "320" | "256" | "192" | "128" | "96" | "64" | "remove";

export interface TargetSizeOptions {
  enabled: boolean;
  presetId: TargetSizePresetId;
  targetBytes: number | null;
  targetRatio: number | null;
  unit: TargetSizeUnit;
  audioMode: TargetAudioMode;
  allowResolutionChange: boolean;
  allowLossyForPng: boolean;
  jpegBackground: string | null;
  minimumQuality: {
    jpeg: number;
    webp: number;
    avif: number;
    videoHeight: number;
    audioKbps: number;
  };
  speedPreset?: import("@/lib/processing/types").ProcessingSpeedPreset;
}

export interface TargetSizeEstimate {
  originalBytes: number;
  targetBytes: number;
  estimatedOutputBytes: number;
  estimatedReductionPercent: number;
  estimatedProcessingSeconds: number;
  qualityImpact: "none" | "small" | "moderate" | "large";
  feasibility: TargetSizeFeasibility;
  resolutionChange: boolean;
  recommendedHeight: number | null;
  outputFormat: string;
  codec: string | null;
  message: string;
}

export interface TargetSizeRecommendationData {
  minimumAchievableBytes: number;
  recommendedHeight: number | null;
  recommendedCodec: string | null;
  recommendedAudioKbps: number | null;
  impact: string;
  alternatives: Array<
    | "keep-best-quality"
    | "lower-quality-floor"
    | "lower-resolution"
    | "lower-audio-quality"
    | "change-target"
  >;
}

export interface TargetSizeResult {
  requestedBytes: number;
  actualBytes: number;
  differenceBytes: number;
  achieved: boolean;
  originalBytes: number;
  savedBytes: number;
  reductionPercent: number;
  attempts: number;
  selectedQuality: number | null;
  selectedResolution: string | null;
  selectedCodec: string | null;
  selectedAudioKbps: number | null;
  reason: string;
  recommendation?: TargetSizeRecommendationData;
}

export interface TargetSizePresetDefinition {
  id: TargetSizePresetId;
  label: string;
  description: string;
  targetBytes: number | null;
  targetRatio: number | null;
}

export function isTargetSizeOptions(value: unknown): value is TargetSizeOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<TargetSizeOptions>;
  const minimum = options.minimumQuality;
  return (
    typeof options.enabled === "boolean" &&
    TARGET_SIZE_PRESET_IDS.includes(options.presetId as TargetSizePresetId) &&
    (options.targetBytes === null ||
      (typeof options.targetBytes === "number" &&
        Number.isSafeInteger(options.targetBytes) &&
        options.targetBytes > 0)) &&
    (options.targetRatio === null ||
      (typeof options.targetRatio === "number" &&
        options.targetRatio > 0 &&
        options.targetRatio <= 1)) &&
    TARGET_SIZE_UNITS.includes(options.unit as TargetSizeUnit) &&
    ["auto", "320", "256", "192", "128", "96", "64", "remove"].includes(
      options.audioMode ?? "",
    ) &&
    typeof options.allowResolutionChange === "boolean" &&
    typeof options.allowLossyForPng === "boolean" &&
    (options.jpegBackground === null ||
      (typeof options.jpegBackground === "string" &&
        /^#[0-9a-f]{6}$/i.test(options.jpegBackground))) &&
    Boolean(minimum) &&
    Number.isInteger(minimum?.jpeg) &&
    Number(minimum?.jpeg) >= 1 &&
    Number(minimum?.jpeg) <= 100 &&
    Number.isInteger(minimum?.webp) &&
    Number(minimum?.webp) >= 1 &&
    Number(minimum?.webp) <= 100 &&
    Number.isInteger(minimum?.avif) &&
    Number(minimum?.avif) >= 1 &&
    Number(minimum?.avif) <= 100 &&
    [480, 720, 1080, 1440, 2160].includes(Number(minimum?.videoHeight)) &&
    [64, 96, 128, 192, 256, 320].includes(Number(minimum?.audioKbps)) &&
    (options.speedPreset === undefined ||
      ["fast", "balanced", "maximum-compression"].includes(options.speedPreset)) &&
    (options.targetBytes !== null) !== (options.targetRatio !== null)
  );
}

export function resolveTargetBytes(options: TargetSizeOptions, originalBytes: number) {
  if (options.targetBytes !== null) return options.targetBytes;
  return Math.max(1, Math.floor(originalBytes * (options.targetRatio ?? 1)));
}
