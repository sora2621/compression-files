export const ADVANCED_OPTIMIZATION_MODES = [
  "strict-lossless",
  "high-quality-optimization",
  "size-priority",
  "archive",
] as const;

export type AdvancedOptimizationMode = (typeof ADVANCED_OPTIMIZATION_MODES)[number];

export type CandidateStatus = "selected" | "qualified" | "rejected" | "unavailable";

export interface QualitySegment {
  startSeconds: number;
  endSeconds: number;
  score: number;
}

export interface OptimizationCandidateReport {
  id: string;
  label: string;
  method: string;
  format?: string;
  codec?: string;
  size: number | null;
  status: CandidateStatus;
  losslessVerified?: boolean;
  verificationMethod?: string;
  vmafMean?: number;
  vmafMin?: number;
  lowQualitySegments?: QualitySegment[];
  reason: string;
}

export interface OptimizationReport {
  mode: AdvancedOptimizationMode;
  originalSize: number;
  outputSize: number;
  reductionPercent: number;
  selectedCandidateId: string | null;
  selectedMethod: string;
  selectedFormat: string;
  selectedCodec?: string;
  keptOriginal: boolean;
  decisionReason: string;
  losslessVerification: {
    status: "passed" | "failed" | "not-applicable";
    method: string;
    details: string;
  };
  qualityAssessment?: {
    label: "高画質基準を満たした候補";
    threshold: number;
    minimumFrameThreshold: number;
    vmafMean: number;
    vmafMin: number;
    lowQualitySegments: QualitySegment[];
  };
  candidates: OptimizationCandidateReport[];
}

export interface LosslessImageOptions {
  stripPrivacyMetadata: boolean;
  compareWebpLossless: boolean;
  enableJpegXl: boolean;
}

export interface VideoStreamSelectionOptions {
  keepPrimaryAudioOnly: boolean;
  removeSubtitles: boolean;
  removeAttachments: boolean;
  removeChapters: boolean;
  stripPrivacyMetadata: boolean;
}

export interface VideoQualitySearchOptions {
  vmafThreshold: number;
  minimumFrameThreshold: number;
  preset: "medium" | "slow" | "slower";
  includeAv1: boolean;
  includeH265: boolean;
  includeH264: boolean;
}

export const DEFAULT_LOSSLESS_IMAGE_OPTIONS: LosslessImageOptions = {
  stripPrivacyMetadata: true,
  compareWebpLossless: true,
  enableJpegXl: false,
};

export const DEFAULT_VIDEO_STREAM_SELECTION: VideoStreamSelectionOptions = {
  keepPrimaryAudioOnly: false,
  removeSubtitles: false,
  removeAttachments: false,
  removeChapters: false,
  stripPrivacyMetadata: true,
};

export const DEFAULT_VIDEO_QUALITY_SEARCH: VideoQualitySearchOptions = {
  vmafThreshold: 95,
  minimumFrameThreshold: 80,
  preset: "medium",
  includeAv1: true,
  includeH265: true,
  includeH264: true,
};

export function isAdvancedOptimizationMode(
  value: unknown,
): value is AdvancedOptimizationMode {
  return ADVANCED_OPTIMIZATION_MODES.includes(value as AdvancedOptimizationMode);
}

export function isLosslessImageOptions(value: unknown): value is LosslessImageOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<LosslessImageOptions>;
  return (
    typeof options.stripPrivacyMetadata === "boolean" &&
    typeof options.compareWebpLossless === "boolean" &&
    typeof options.enableJpegXl === "boolean"
  );
}

export function isVideoStreamSelectionOptions(
  value: unknown,
): value is VideoStreamSelectionOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<VideoStreamSelectionOptions>;
  return (
    typeof options.keepPrimaryAudioOnly === "boolean" &&
    typeof options.removeSubtitles === "boolean" &&
    typeof options.removeAttachments === "boolean" &&
    typeof options.removeChapters === "boolean" &&
    typeof options.stripPrivacyMetadata === "boolean"
  );
}

export function isVideoQualitySearchOptions(
  value: unknown,
): value is VideoQualitySearchOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<VideoQualitySearchOptions>;
  return (
    typeof options.vmafThreshold === "number" &&
    options.vmafThreshold >= 80 &&
    options.vmafThreshold <= 100 &&
    typeof options.minimumFrameThreshold === "number" &&
    options.minimumFrameThreshold >= 50 &&
    options.minimumFrameThreshold <= 100 &&
    ["medium", "slow", "slower"].includes(options.preset ?? "") &&
    typeof options.includeAv1 === "boolean" &&
    typeof options.includeH265 === "boolean" &&
    typeof options.includeH264 === "boolean" &&
    (options.includeAv1 || options.includeH265 || options.includeH264)
  );
}
