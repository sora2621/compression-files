import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import { AppError } from "@/lib/errors";
import { logger } from "@/shared/logging/logger";

interface AiWorkerRequest {
  type: "image" | "directory";
  inputPath?: string;
  outputPath?: string;
  inputDirectory?: string;
  outputDirectory?: string;
  scale: 2 | 4;
  model: "photo" | "anime";
  denoise: number;
  strength: number;
  faceStrength: number;
}

interface PendingRequest {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort: () => void;
  onProgress?: (current: number, total: number) => void;
}

interface AiWorkerState {
  child: ChildProcessWithoutNullStreams | null;
  stdout: string;
  pending: Map<string, PendingRequest>;
}

const aiWorkerGlobal = globalThis as typeof globalThis & {
  compressionFilesAiWorker?: AiWorkerState;
};

const state = (aiWorkerGlobal.compressionFilesAiWorker ??= {
  child: null,
  stdout: "",
  pending: new Map(),
});

function rejectAll(error: unknown) {
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    pending.reject(error);
  }
  state.pending.clear();
}

function stopWorker(error: unknown) {
  const child = state.child;
  state.child = null;
  state.stdout = "";
  child?.kill("SIGKILL");
  rejectAll(error);
}

function consumeWorkerLine(line: string) {
  if (!line.trim().startsWith("{")) return;
  let event: {
    id?: string;
    type?: string;
    ok?: boolean;
    current?: number;
    total?: number;
    error?: string;
    modelLoadMs?: number;
    inferenceMs?: number;
  };
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event.id) return;
  const pending = state.pending.get(event.id);
  if (!pending) return;
  if (
    event.type === "progress" &&
    typeof event.current === "number" &&
    typeof event.total === "number"
  ) {
    pending.onProgress?.(event.current, event.total);
    return;
  }
  state.pending.delete(event.id);
  clearTimeout(pending.timer);
  pending.signal?.removeEventListener("abort", pending.abort);
  if (typeof event.modelLoadMs === "number") {
    logger.info({ stage: "ai-model-load", elapsedMs: event.modelLoadMs });
  }
  if (typeof event.inferenceMs === "number") {
    logger.info({ stage: "ai-inference", elapsedMs: event.inferenceMs });
  }
  if (event.ok) pending.resolve();
  else {
    pending.reject(
      new AppError(
        "AI高画質化ワーカーで処理できませんでした。モデルとGPUメモリを確認してください。",
        422,
        "REAL_ESRGAN_FAILED",
      ),
    );
  }
}

function ensureWorker() {
  if (state.child && !state.child.killed) return state.child;
  const python = process.env.AI_PYTHON_PATH ?? "python";
  const worker = process.env.AI_WORKER_PATH ?? "workers/ai_image_worker.py";
  const child = spawn(/*turbopackIgnore: true*/ python, [worker, "--serve"], {
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.child = child;
  child.stdout.on("data", (chunk: Buffer) => {
    state.stdout += chunk.toString();
    const lines = state.stdout.split(/\r?\n/);
    state.stdout = lines.pop() ?? "";
    lines.forEach(consumeWorkerLine);
    if (state.stdout.length > 1_000_000) state.stdout = state.stdout.slice(-100_000);
  });
  child.stderr.resume();
  child.once("error", () => {
    stopWorker(
      new AppError("AIワーカーを起動できませんでした。", 503, "AI_WORKER_FAILED"),
    );
  });
  child.once("close", () => {
    if (state.child === child) {
      state.child = null;
      rejectAll(
        new AppError("AIワーカーが予期せず終了しました。", 422, "AI_WORKER_EXITED"),
      );
    }
  });
  return child;
}

export function runPersistentAiJob(
  request: AiWorkerRequest,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    onProgress?: (current: number, total: number) => void;
  },
) {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AppError("AI処理をキャンセルしました。", 499, "CANCELLED"));
      return;
    }
    const child = ensureWorker();
    const id = randomUUID();
    const abort = () => {
      stopWorker(new AppError("AI処理をキャンセルしました。", 499, "CANCELLED"));
    };
    const timer = setTimeout(() => {
      stopWorker(new AppError("AI処理がタイムアウトしました。", 408, "AI_TIMEOUT"));
    }, options.timeoutMs);
    state.pending.set(id, {
      resolve,
      reject,
      timer,
      signal: options.signal,
      abort,
      onProgress: options.onProgress,
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.write(`${JSON.stringify({ id, ...request })}\n`, (error) => {
      if (error) stopWorker(error);
    });
  });
}

export function stopPersistentAiWorker() {
  stopWorker(new AppError("AIワーカーを停止しました。", 499, "CANCELLED"));
}
