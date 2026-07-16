import type {
  TargetSizeEstimate,
  TargetSizeFeasibility,
  TargetSizeOptions,
  TargetSizeRecommendationData,
  TargetSizeResult,
  TargetSizeUnit,
} from "./types";

const UNIT_BYTES: Record<TargetSizeUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

export function targetSizeValueToBytes(value: number, unit: TargetSizeUnit) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("Target size must be a positive finite number.");
  }
  const bytes = Math.round(value * UNIT_BYTES[unit]);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError("Target size is outside the supported range.");
  }
  return bytes;
}

export function bytesToTargetSizeValue(bytes: number, unit: TargetSizeUnit) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError("Byte size must be a non-negative finite number.");
  }
  return bytes / UNIT_BYTES[unit];
}

export const convertTargetSizeToBytes = targetSizeValueToBytes;

export function resolveRequestedTargetBytes(
  options: Pick<TargetSizeOptions, "targetBytes" | "targetRatio">,
  originalBytes: number,
) {
  if (!Number.isSafeInteger(originalBytes) || originalBytes <= 0) {
    throw new RangeError("Original size must be a positive integer.");
  }
  if (options.targetBytes !== null) {
    if (!Number.isSafeInteger(options.targetBytes) || options.targetBytes <= 0) {
      throw new RangeError("Target bytes must be a positive integer.");
    }
    return options.targetBytes;
  }
  if (
    typeof options.targetRatio !== "number" ||
    !Number.isFinite(options.targetRatio) ||
    options.targetRatio <= 0
  ) {
    throw new RangeError("Target ratio must be a positive finite number.");
  }
  return Math.max(1, Math.floor(originalBytes * options.targetRatio));
}

export function targetNeedsReduction(originalBytes: number, targetBytes: number) {
  return targetBytes < originalBytes;
}

export function calculateSizeReductionPercent(
  originalBytes: number,
  outputBytes: number,
) {
  if (originalBytes <= 0) return 0;
  return Number((((originalBytes - outputBytes) / originalBytes) * 100).toFixed(1));
}

export interface TargetSizeFeasibilityInput {
  originalBytes: number;
  targetBytes: number;
  estimatedMinimumBytes: number;
  estimatedOutputBytes?: number;
  estimatedProcessingSeconds?: number;
  outputFormat: string;
  codec?: string | null;
  resolutionChange?: boolean;
  recommendedHeight?: number | null;
}

export function estimateTargetSizeFeasibility(
  input: TargetSizeFeasibilityInput,
): TargetSizeEstimate {
  const reductionRatio = Math.max(
    0,
    1 - input.targetBytes / Math.max(1, input.originalBytes),
  );
  let feasibility: TargetSizeFeasibility;
  let qualityImpact: TargetSizeEstimate["qualityImpact"];
  let message: string;
  if (input.targetBytes >= input.originalBytes) {
    feasibility = "achievable";
    qualityImpact = "none";
    message = "目標容量は元ファイル以上のため、圧縮は不要です。";
  } else if (input.targetBytes >= input.estimatedMinimumBytes) {
    if (reductionRatio <= 0.35) {
      feasibility = "achievable";
      qualityImpact = "small";
      message = "現在の設定で目標容量を達成できる見込みです。";
    } else if (reductionRatio <= 0.65) {
      feasibility = "settings-recommended";
      qualityImpact = "moderate";
      message = "品質または解像度の調整で達成できる見込みです。";
    } else {
      feasibility = "quality-risk";
      qualityImpact = "large";
      message = "達成可能ですが、目に見える品質低下が生じる可能性があります。";
    }
  } else if (input.targetBytes >= input.estimatedMinimumBytes * 0.85) {
    feasibility = "quality-risk";
    qualityImpact = "large";
    message = "品質下限を変更しない限り、目標達成は難しい見込みです。";
  } else {
    feasibility = "difficult";
    qualityImpact = "large";
    message = "現在の品質下限では目標容量を達成できない見込みです。";
  }
  const estimatedOutputBytes = Math.max(
    1,
    Math.round(
      input.estimatedOutputBytes ??
        Math.max(input.targetBytes, input.estimatedMinimumBytes),
    ),
  );
  return {
    originalBytes: input.originalBytes,
    targetBytes: input.targetBytes,
    estimatedOutputBytes,
    estimatedReductionPercent: calculateSizeReductionPercent(
      input.originalBytes,
      estimatedOutputBytes,
    ),
    estimatedProcessingSeconds: Math.max(
      0,
      Math.round(input.estimatedProcessingSeconds ?? 0),
    ),
    qualityImpact,
    feasibility,
    resolutionChange: input.resolutionChange ?? false,
    recommendedHeight: input.recommendedHeight ?? null,
    outputFormat: input.outputFormat,
    codec: input.codec ?? null,
    message,
  };
}

export interface CreateTargetSizeResultInput {
  requestedBytes: number;
  actualBytes: number;
  originalBytes: number;
  attempts: number;
  selectedQuality?: number | null;
  selectedResolution?: string | null;
  selectedCodec?: string | null;
  selectedAudioKbps?: number | null;
  reason: string;
  recommendation?: TargetSizeRecommendationData;
}

export function createTargetSizeResult(
  input: CreateTargetSizeResultInput,
): TargetSizeResult {
  const achieved = input.actualBytes <= input.requestedBytes;
  return {
    requestedBytes: input.requestedBytes,
    actualBytes: input.actualBytes,
    differenceBytes: input.actualBytes - input.requestedBytes,
    achieved,
    originalBytes: input.originalBytes,
    savedBytes: input.originalBytes - input.actualBytes,
    reductionPercent: calculateSizeReductionPercent(
      input.originalBytes,
      input.actualBytes,
    ),
    attempts: input.attempts,
    selectedQuality: input.selectedQuality ?? null,
    selectedResolution: input.selectedResolution ?? null,
    selectedCodec: input.selectedCodec ?? null,
    selectedAudioKbps: input.selectedAudioKbps ?? null,
    reason: input.reason,
    recommendation: achieved ? undefined : input.recommendation,
  };
}
