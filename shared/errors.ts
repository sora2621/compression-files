// File-level facade keeps `@/shared/errors` resolvable outside Next.js bundling.
export {
  AppError,
  CorruptedMediaError,
  FfmpegExecutionError,
  InsufficientStorageError,
  InvalidFileError,
  OutputValidationError,
  ProcessingTimeoutError,
  TargetSizeUnreachableError,
  UnsupportedMediaError,
  errorResponse,
  type AppErrorOptions,
  type ClassifiedErrorOptions,
} from "./errors/app-error";
