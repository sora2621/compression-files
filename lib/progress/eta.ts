interface EtaSample {
  elapsedSeconds: number;
  progress: number;
  remainingSeconds: number;
}

/**
 * Smooths ETA using the recent observed completion rate. It deliberately waits
 * for several useful samples so startup/probe spikes do not produce wild ETAs.
 */
export class StableEtaEstimator {
  private readonly samples: EtaSample[] = [];
  private smoothed?: number;

  constructor(
    private readonly sampleLimit = 8,
    private readonly minimumSamples = 3,
  ) {}

  update(progress: number, elapsedSeconds: number) {
    if (
      !Number.isFinite(progress) ||
      !Number.isFinite(elapsedSeconds) ||
      progress <= 0 ||
      progress >= 100 ||
      elapsedSeconds <= 0
    ) {
      return undefined;
    }

    const previous = this.samples.at(-1);
    if (
      previous &&
      (progress <= previous.progress || elapsedSeconds <= previous.elapsedSeconds)
    ) {
      return this.smoothed === undefined
        ? undefined
        : Math.max(0, Math.round(this.smoothed));
    }

    const remainingSeconds = (elapsedSeconds / progress) * (100 - progress);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0) return undefined;
    this.samples.push({ elapsedSeconds, progress, remainingSeconds });
    if (this.samples.length > this.sampleLimit) this.samples.shift();
    if (this.samples.length < this.minimumSamples || progress < 1 || elapsedSeconds < 2) {
      return undefined;
    }

    // More recent observations carry more weight, then an EWMA further dampens
    // one-off encoder speed changes without making the estimate unresponsive.
    let weighted = 0;
    let weightTotal = 0;
    for (let index = 0; index < this.samples.length; index += 1) {
      const weight = index + 1;
      weighted += this.samples[index].remainingSeconds * weight;
      weightTotal += weight;
    }
    const average = weighted / weightTotal;
    this.smoothed =
      this.smoothed === undefined ? average : this.smoothed * 0.65 + average * 0.35;
    return Math.max(0, Math.round(this.smoothed));
  }

  reset() {
    this.samples.length = 0;
    this.smoothed = undefined;
  }
}

export function estimateRemainingSeconds(progress: number, elapsedSeconds: number) {
  if (
    !Number.isFinite(progress) ||
    !Number.isFinite(elapsedSeconds) ||
    progress <= 0 ||
    progress >= 100 ||
    elapsedSeconds < 0
  ) {
    return undefined;
  }
  const estimate = (elapsedSeconds / progress) * (100 - progress);
  return Number.isFinite(estimate) ? Math.max(0, Math.round(estimate)) : undefined;
}
