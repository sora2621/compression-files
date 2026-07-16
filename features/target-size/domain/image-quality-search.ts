export interface ImageQualityEvaluation {
  quality: number;
  outputBytes: number;
  isWithinTarget: boolean;
  isSmallerThanOriginal: boolean;
}

export interface ImageQualitySearchRequest<Evaluation extends ImageQualityEvaluation> {
  minimumQuality: number;
  maximumQuality: number;
  maximumAttempts: number;
  targetSizeBytes: number;
  toleranceBytes: number;
  initialBest: Evaluation;
  evaluateQuality: (quality: number) => Promise<Evaluation | null>;
}

export interface ImageQualitySearchResult<Evaluation extends ImageQualityEvaluation> {
  bestEvaluation: Evaluation;
  attempts: number;
}

export interface ImageQualityBounds {
  lowestQuality: number;
  highestQuality: number;
}

/**
 * A failed candidate can only reduce the upper bound. A successful candidate
 * can only increase the lower bound. Keeping this rule pure makes the search
 * independently testable from Sharp and filesystem writes.
 */
export function updateImageQualityBounds(
  bounds: ImageQualityBounds,
  evaluatedQuality: number,
  isWithinTarget: boolean,
): ImageQualityBounds {
  return isWithinTarget
    ? { ...bounds, lowestQuality: evaluatedQuality + 1 }
    : { ...bounds, highestQuality: evaluatedQuality - 1 };
}

export function selectMiddleImageQuality(bounds: ImageQualityBounds) {
  return Math.floor((bounds.lowestQuality + bounds.highestQuality) / 2);
}

export function isImageQualityWithinTolerance(
  targetSizeBytes: number,
  outputBytes: number,
  toleranceBytes: number,
) {
  return (
    outputBytes <= targetSizeBytes && targetSizeBytes - outputBytes <= toleranceBytes
  );
}

export async function findMaximumImageQuality<Evaluation extends ImageQualityEvaluation>(
  request: ImageQualitySearchRequest<Evaluation>,
): Promise<ImageQualitySearchResult<Evaluation>> {
  let bounds: ImageQualityBounds = {
    lowestQuality: request.minimumQuality,
    highestQuality: request.maximumQuality,
  };
  let bestEvaluation = request.initialBest;
  let attempts = 0;

  while (
    bounds.lowestQuality <= bounds.highestQuality &&
    attempts < request.maximumAttempts
  ) {
    const quality = selectMiddleImageQuality(bounds);
    const evaluation = await request.evaluateQuality(quality);
    if (!evaluation) break;
    attempts += 1;

    if (
      evaluation.isWithinTarget &&
      evaluation.isSmallerThanOriginal &&
      evaluation.quality > bestEvaluation.quality
    ) {
      bestEvaluation = evaluation;
    }
    bounds = updateImageQualityBounds(bounds, quality, evaluation.isWithinTarget);

    // A tolerance hit still keeps searching when a higher quality remains;
    // otherwise a smaller file could incorrectly win over a better image.
    if (
      isImageQualityWithinTolerance(
        request.targetSizeBytes,
        evaluation.outputBytes,
        request.toleranceBytes,
      ) &&
      bounds.lowestQuality > bounds.highestQuality
    ) {
      break;
    }
  }

  return { bestEvaluation, attempts };
}
