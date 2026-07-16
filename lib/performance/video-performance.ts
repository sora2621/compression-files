export type VideoPerformanceMetrics = {
  jobId: string;
  encoder: string;
  processingMode: string;
  inputDurationSeconds: number;
  decodingMilliseconds?: number;
  filteringMilliseconds?: number;
  encodingMilliseconds: number;
  outputValidationMilliseconds: number;
  totalMilliseconds: number;
  averageEncodingFps?: number;
  averageSpeedRatio?: number;
};

function finiteAverage(values: readonly number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (valid.length === 0) return undefined;
  return Number(
    (valid.reduce((total, value) => total + value, 0) / valid.length).toFixed(3),
  );
}

export function createVideoPerformanceMetrics(options: {
  jobId: string;
  encoder: string;
  processingMode: string;
  inputDurationSeconds: number;
  encodingMilliseconds: number;
  outputValidationMilliseconds?: number;
  fpsSamples?: readonly number[];
  speedSamples?: readonly number[];
}): VideoPerformanceMetrics {
  const outputValidationMilliseconds = options.outputValidationMilliseconds ?? 0;
  return {
    jobId: options.jobId,
    encoder: options.encoder,
    processingMode: options.processingMode,
    inputDurationSeconds: options.inputDurationSeconds,
    encodingMilliseconds: Number(options.encodingMilliseconds.toFixed(3)),
    outputValidationMilliseconds: Number(outputValidationMilliseconds.toFixed(3)),
    totalMilliseconds: Number(
      (options.encodingMilliseconds + outputValidationMilliseconds).toFixed(3),
    ),
    averageEncodingFps: finiteAverage(options.fpsSamples ?? []),
    averageSpeedRatio: finiteAverage(options.speedSamples ?? []),
  };
}

export function withVideoOutputValidation(
  metrics: VideoPerformanceMetrics,
  outputValidationMilliseconds: number,
): VideoPerformanceMetrics {
  return {
    ...metrics,
    outputValidationMilliseconds: Number(outputValidationMilliseconds.toFixed(3)),
    totalMilliseconds: Number(
      (metrics.encodingMilliseconds + outputValidationMilliseconds).toFixed(3),
    ),
  };
}
