import { spawn } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface CommandRunOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  rejectOnStdoutLimit?: boolean;
  onStdout?: (chunk: Buffer) => void;
  onStderr?: (chunk: Buffer) => void;
  createAbortError?: () => unknown;
  createTimeoutError?: () => unknown;
  createFailureError?: (code: number | null, stderr: string) => unknown;
  createStdoutLimitError?: () => unknown;
}

export type CommandRunner = (
  executable: string,
  args: readonly string[],
  options?: CommandRunOptions,
) => Promise<CommandResult>;

const DEFAULT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

function appendWithLimit(current: string, chunk: Buffer, limitBytes: number) {
  const combined = `${current}${chunk.toString()}`;
  return Buffer.byteLength(combined) <= limitBytes
    ? combined
    : combined.slice(-limitBytes);
}

/**
 * The single low-level process boundary used by FFmpeg and FFprobe adapters.
 * Keeping the executable and arguments separate makes shell interpretation
 * impossible and allows callers to replace this runner in tests.
 */
export const runCommand: CommandRunner = (executable, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ executable, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutLimit = options.stdoutLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    const stderrLimit = options.stderrLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(options.createAbortError?.() ?? new Error("Command aborted"));
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          finish(options.createTimeoutError?.() ?? new Error("Command timed out"));
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      options.onStdout?.(chunk);
      if (
        options.rejectOnStdoutLimit &&
        Buffer.byteLength(stdout) + chunk.byteLength > stdoutLimit
      ) {
        child.kill("SIGKILL");
        finish(
          options.createStdoutLimitError?.() ??
            new Error("Command output limit exceeded"),
        );
        return;
      }
      stdout = appendWithLimit(stdout, chunk, stdoutLimit);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      options.onStderr?.(chunk);
      stderr = appendWithLimit(stderr, chunk, stderrLimit);
    });
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else {
        finish(
          options.createFailureError?.(code, stderr) ??
            new Error(`Command exited with code ${code ?? "unknown"}`),
        );
      }
    });

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
