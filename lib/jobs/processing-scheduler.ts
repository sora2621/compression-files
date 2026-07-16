import { availableParallelism, totalmem } from "node:os";

import sharp from "sharp";

type ProcessingResourceKind = "image" | "videoCpu" | "videoGpu" | "audio" | "ai";

interface ResourceWeights {
  cpu: number;
  memory: number;
  gpu: number;
}

interface WaitingTask<T> {
  kind: ProcessingResourceKind;
  weights: ResourceWeights;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

interface SchedulerState {
  active: ResourceWeights;
  waiting: WaitingTask<unknown>[];
  gpuCount: number;
}

const cpuCount = Math.max(1, availableParallelism());
const memoryUnits = Math.max(2, Math.floor(totalmem() / (2 * 1024 ** 3)));
const imageCpuWeight = Math.max(1, Math.ceil(cpuCount / 4));

const schedulerGlobal = globalThis as typeof globalThis & {
  compressionFilesProcessingScheduler?: SchedulerState;
};
const state = (schedulerGlobal.compressionFilesProcessingScheduler ??= {
  active: { cpu: 0, memory: 0, gpu: 0 },
  waiting: [],
  gpuCount: 0,
});

function weightsFor(kind: ProcessingResourceKind): ResourceWeights {
  if (kind === "image") return { cpu: imageCpuWeight, memory: 1, gpu: 0 };
  if (kind === "videoCpu") return { cpu: cpuCount, memory: 2, gpu: 0 };
  if (kind === "videoGpu") return { cpu: Math.min(2, cpuCount), memory: 2, gpu: 1 };
  if (kind === "audio") return { cpu: 1, memory: 1, gpu: 0 };
  return state.gpuCount > 0
    ? { cpu: Math.min(2, cpuCount), memory: 2, gpu: 1 }
    : { cpu: cpuCount, memory: Math.min(4, memoryUnits), gpu: 0 };
}

function fits(weights: ResourceWeights) {
  return (
    state.active.cpu + weights.cpu <= cpuCount &&
    state.active.memory + weights.memory <= memoryUnits &&
    state.active.gpu + weights.gpu <= state.gpuCount
  );
}

function release(weights: ResourceWeights) {
  state.active.cpu -= weights.cpu;
  state.active.memory -= weights.memory;
  state.active.gpu -= weights.gpu;
}

function drain() {
  // Strict FIFO prevents a stream of small image jobs from bypassing an older video job.
  while (state.waiting.length > 0) {
    const task = state.waiting[0];
    if (task.signal?.aborted) {
      state.waiting.shift();
      task.reject(new Error("Processing cancelled"));
      continue;
    }
    if (!fits(task.weights)) return;
    state.waiting.shift();
    state.active.cpu += task.weights.cpu;
    state.active.memory += task.weights.memory;
    state.active.gpu += task.weights.gpu;
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        release(task.weights);
        drain();
      });
  }
}

export function configureProcessingResources(options: { gpuCount: number }) {
  state.gpuCount = Math.max(0, Math.floor(options.gpuCount));
  drain();
}

export function runScheduledProcessingJob<T>(
  kind: ProcessingResourceKind,
  run: () => Promise<T>,
  signal?: AbortSignal,
) {
  return new Promise<T>((resolve, reject) => {
    state.waiting.push({
      kind,
      weights: weightsFor(kind),
      run,
      resolve: resolve as (value: unknown) => void,
      reject,
      signal,
    });
    drain();
  });
}

export function getProcessingConcurrency() {
  return {
    image: Math.max(1, Math.floor(cpuCount / imageCpuWeight)),
    videoCpu: 1,
    videoGpu: Math.max(0, state.gpuCount),
    aiPerGpu: state.gpuCount > 0 ? 1 : 0,
    audio: cpuCount,
    cpuCount,
    memoryUnits,
    sharpThreadsPerImage: sharp.concurrency(),
    active: { ...state.active },
    waiting: state.waiting.length,
  } as const;
}
