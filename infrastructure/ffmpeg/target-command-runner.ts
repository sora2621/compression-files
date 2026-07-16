import {
  runCommand,
  type CommandRunOptions,
  type CommandRunner,
} from "@/infrastructure/process/command-runner";
import { AppError } from "@/lib/errors";

const COMMAND_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
export const TARGET_PROCESS_TIMEOUT_MS = 60 * 60 * 1000;

export type TargetCommandOptions = Pick<
  CommandRunOptions,
  "cwd" | "timeoutMs" | "signal"
>;
export type TargetCommandRunner = CommandRunner;

export const defaultTargetCommandRunner: TargetCommandRunner = (
  executable,
  args,
  options = {},
) =>
  runCommand(executable, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? TARGET_PROCESS_TIMEOUT_MS,
    stdoutLimitBytes: COMMAND_OUTPUT_LIMIT_BYTES,
    stderrLimitBytes: COMMAND_OUTPUT_LIMIT_BYTES,
    createAbortError: () =>
      new AppError("目標容量処理をキャンセルしました。", 499, "CANCELLED"),
    createTimeoutError: () =>
      new AppError("目標容量処理が制限時間を超えました。", 408, "TARGET_SIZE_TIMEOUT"),
    createFailureError: () =>
      new AppError(
        "FFmpegによる目標容量処理に失敗しました。",
        422,
        "TARGET_SIZE_PROCESS_FAILED",
      ),
  });
