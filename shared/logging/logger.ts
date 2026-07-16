export type LogLevel = "info" | "warn" | "error";

/**
 * Processing logs intentionally accept identifiers and timing only. File names,
 * paths, tool output and media metadata have no representation in this type.
 */
export interface ProcessingLogContext {
  jobId?: string;
  fileId?: string;
  stage?: string;
  errorCode?: string;
  elapsedMs?: number;
  encoder?: string;
  processingMode?: string;
  inputDurationSeconds?: number;
  decodingMilliseconds?: number;
  filteringMilliseconds?: number;
  encodingMilliseconds?: number;
  outputValidationMilliseconds?: number;
  totalMilliseconds?: number;
  averageEncodingFps?: number;
  averageSpeedRatio?: number;
}

export type StructuredLogPayload = Readonly<ProcessingLogContext>;
export type LogSink = (level: LogLevel, payload: StructuredLogPayload) => void;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,80}$/;

function safeIdentifier(value: unknown) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

function safeStage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const stage = value.trim();
  if (!stage || stage.length > 80 || /[\\/]/.test(stage)) return undefined;
  return stage;
}

function safeErrorCode(value: unknown) {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value) ? value : undefined;
}

function safeElapsedMs(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safeMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safeMetricLabel(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(value)
    ? value
    : undefined;
}

/** Picks an allowlist instead of redacting a denylist so future caller fields cannot leak. */
export function createStructuredLogPayload(
  context: ProcessingLogContext,
): StructuredLogPayload {
  const payload: ProcessingLogContext = {};
  const jobId = safeIdentifier(context.jobId);
  const fileId = safeIdentifier(context.fileId);
  const stage = safeStage(context.stage);
  const errorCode = safeErrorCode(context.errorCode);
  const elapsedMs = safeElapsedMs(context.elapsedMs);

  if (jobId !== undefined) payload.jobId = jobId;
  if (fileId !== undefined) payload.fileId = fileId;
  if (stage !== undefined) payload.stage = stage;
  if (errorCode !== undefined) payload.errorCode = errorCode;
  if (elapsedMs !== undefined) payload.elapsedMs = elapsedMs;
  const encoder = safeMetricLabel(context.encoder);
  const processingMode = safeMetricLabel(context.processingMode);
  if (encoder !== undefined) payload.encoder = encoder;
  if (processingMode !== undefined) payload.processingMode = processingMode;
  for (const key of [
    "inputDurationSeconds",
    "decodingMilliseconds",
    "filteringMilliseconds",
    "encodingMilliseconds",
    "outputValidationMilliseconds",
    "totalMilliseconds",
    "averageEncodingFps",
    "averageSpeedRatio",
  ] as const) {
    const value = safeMetric(context[key]);
    if (value !== undefined) payload[key] = value;
  }

  return Object.freeze(payload);
}

const consoleSink: LogSink = (level, payload) => {
  const entry = JSON.stringify(payload);
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
};

export function createLogger(sink: LogSink = consoleSink) {
  const write = (level: LogLevel, context: ProcessingLogContext) => {
    sink(level, createStructuredLogPayload(context));
  };

  return {
    info: (context: ProcessingLogContext) => write("info", context),
    warn: (context: ProcessingLogContext) => write("warn", context),
    error: (context: ProcessingLogContext) => write("error", context),
  } as const;
}

export const logger = createLogger();
