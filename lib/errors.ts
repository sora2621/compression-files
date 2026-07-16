/** @deprecated New code should import the classified errors from `@/shared/errors`. */
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
} from "@/shared/errors/app-error";
