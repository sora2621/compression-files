import { AppError } from "@/lib/errors";

interface WaitingTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

const configured = Number(process.env.AI_MAX_CONCURRENCY ?? 1);
const concurrency = Number.isInteger(configured)
  ? Math.min(2, Math.max(1, configured))
  : 1;

const globalQueue = globalThis as typeof globalThis & {
  compressionAiQueue?: { active: number; waiting: WaitingTask<unknown>[] };
};

const queue = (globalQueue.compressionAiQueue ??= { active: 0, waiting: [] });

function drain() {
  while (queue.active < concurrency && queue.waiting.length > 0) {
    const task = queue.waiting.shift();
    if (!task) return;
    if (task.signal?.aborted) {
      task.reject(new AppError("AI処理をキャンセルしました。", 499, "CANCELLED"));
      continue;
    }
    queue.active += 1;
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        queue.active -= 1;
        drain();
      });
  }
}

export function runQueuedAiJob<T>(run: () => Promise<T>, signal?: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    queue.waiting.push({
      run,
      resolve: resolve as (value: unknown) => void,
      reject,
      signal,
    });
    drain();
  });
}

export function getAiQueueStatus() {
  return {
    active: queue.active,
    waiting: queue.waiting.length,
    concurrency,
  };
}
