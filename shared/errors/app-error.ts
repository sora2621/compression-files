import { logger, type ProcessingLogContext } from "../logging/logger";

export interface AppErrorOptions {
  status?: number;
  code?: string;
  internalMessage?: string;
  retryable?: boolean;
  cause?: unknown;
}

export interface ClassifiedErrorOptions {
  userMessage?: string;
  internalMessage?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly userMessage: string;
  public readonly internalMessage: string;
  public readonly retryable: boolean;
  public override readonly cause?: unknown;

  constructor(message: string, status?: number, code?: string);
  constructor(message: string, options?: AppErrorOptions);
  constructor(
    message: string,
    statusOrOptions: number | AppErrorOptions = 400,
    legacyCode = "BAD_REQUEST",
  ) {
    const options =
      typeof statusOrOptions === "number"
        ? { status: statusOrOptions, code: legacyCode }
        : statusOrOptions;
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "BAD_REQUEST";
    this.userMessage = message;
    this.internalMessage = options.internalMessage ?? message;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

interface ErrorClassification {
  name: string;
  status: number;
  code: string;
  userMessage: string;
  internalMessage: string;
  retryable: boolean;
}

abstract class ClassifiedAppError extends AppError {
  protected constructor(
    classification: ErrorClassification,
    options: ClassifiedErrorOptions,
  ) {
    super(options.userMessage ?? classification.userMessage, {
      status: classification.status,
      code: classification.code,
      internalMessage: options.internalMessage ?? classification.internalMessage,
      retryable: options.retryable ?? classification.retryable,
      cause: options.cause,
    });
    this.name = classification.name;
  }
}

export class UnsupportedMediaError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "UnsupportedMediaError",
        status: 415,
        code: "UNSUPPORTED_MEDIA",
        userMessage: "このファイル形式は現在の環境では処理できません。",
        internalMessage: "The media type or codec is unsupported.",
        retryable: false,
      },
      options,
    );
  }
}

export class InvalidFileError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "InvalidFileError",
        status: 400,
        code: "INVALID_FILE",
        userMessage: "ファイルを確認して、もう一度選択してください。",
        internalMessage: "The uploaded file failed validation.",
        retryable: false,
      },
      options,
    );
  }
}

export class CorruptedMediaError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "CorruptedMediaError",
        status: 422,
        code: "CORRUPTED_MEDIA",
        userMessage: "ファイルを読み込めませんでした。破損していないか確認してください。",
        internalMessage: "The media could not be decoded or probed.",
        retryable: false,
      },
      options,
    );
  }
}

export class ProcessingTimeoutError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "ProcessingTimeoutError",
        status: 408,
        code: "PROCESSING_TIMEOUT",
        userMessage: "処理が制限時間を超えました。設定を変更してもう一度お試しください。",
        internalMessage: "Media processing exceeded its time limit.",
        retryable: true,
      },
      options,
    );
  }
}

export class TargetSizeUnreachableError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "TargetSizeUnreachableError",
        status: 422,
        code: "TARGET_SIZE_UNREACHABLE",
        userMessage: "現在の品質設定では指定容量に収められません。",
        internalMessage:
          "The target size is unreachable within configured quality limits.",
        retryable: false,
      },
      options,
    );
  }
}

export class InsufficientStorageError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "InsufficientStorageError",
        status: 507,
        code: "INSUFFICIENT_STORAGE",
        userMessage: "処理用の保存領域が不足しています。時間をおいて再度お試しください。",
        internalMessage: "Temporary storage is insufficient.",
        retryable: true,
      },
      options,
    );
  }
}

export class FfmpegExecutionError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "FfmpegExecutionError",
        status: 422,
        code: "FFMPEG_EXECUTION_FAILED",
        userMessage:
          "メディアを処理できませんでした。設定を変更してもう一度お試しください。",
        internalMessage: "FFmpeg exited without producing a valid result.",
        retryable: false,
      },
      options,
    );
  }
}

export class OutputValidationError extends ClassifiedAppError {
  constructor(options: ClassifiedErrorOptions = {}) {
    super(
      {
        name: "OutputValidationError",
        status: 422,
        code: "OUTPUT_VALIDATION_FAILED",
        userMessage:
          "処理結果を検証できませんでした。設定を変更してもう一度お試しください。",
        internalMessage: "The generated output failed validation.",
        retryable: false,
      },
      options,
    );
  }
}

export function errorResponse(error: unknown, logContext: ProcessingLogContext = {}) {
  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ ...logContext, errorCode: error.code });
    }
    return {
      status: error.status,
      body: { error: error.userMessage, code: error.code },
    };
  }

  logger.error({ ...logContext, errorCode: "INTERNAL_ERROR" });
  return {
    status: 500,
    body: {
      error:
        "ファイルの処理中に予期しないエラーが発生しました。別のファイルで再度お試しください。",
      code: "INTERNAL_ERROR",
    },
  };
}
