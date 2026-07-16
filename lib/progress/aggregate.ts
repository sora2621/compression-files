import type { ProcessingStatus } from "./types";

export interface FileProgressSnapshot {
  progress: number;
  status: ProcessingStatus;
  originalSize?: number;
  outputSize?: number;
}

export interface OverallProgressSnapshot {
  completedFiles: number;
  totalFiles: number;
  progress: number;
  originalBytes: number;
  outputBytes: number;
  savedBytes: number;
}

export function clampProcessingProgress(progress: number, status: ProcessingStatus) {
  const safe = Number.isFinite(progress) ? Math.max(0, progress) : 0;
  if (status === "completed") return 100;
  return Number(Math.min(99, safe).toFixed(1));
}

export function calculateReductionPercent(originalSize: number, outputSize: number) {
  if (!Number.isFinite(originalSize) || originalSize <= 0) return null;
  if (!Number.isFinite(outputSize) || outputSize < 0) return null;
  return Number((((originalSize - outputSize) / originalSize) * 100).toFixed(1));
}

export function calculateOverallProgress(
  files: readonly FileProgressSnapshot[],
): OverallProgressSnapshot {
  if (files.length === 0) {
    return {
      completedFiles: 0,
      totalFiles: 0,
      progress: 0,
      originalBytes: 0,
      outputBytes: 0,
      savedBytes: 0,
    };
  }

  const completedFiles = files.filter((file) => file.status === "completed").length;
  const progress = files.reduce(
    (sum, file) => sum + clampProcessingProgress(file.progress, file.status),
    0,
  );
  const completedWithSizes = files.filter(
    (file) =>
      file.status === "completed" &&
      Number.isFinite(file.originalSize) &&
      Number.isFinite(file.outputSize),
  );
  const originalBytes = completedWithSizes.reduce(
    (sum, file) => sum + Math.max(0, file.originalSize ?? 0),
    0,
  );
  const outputBytes = completedWithSizes.reduce(
    (sum, file) => sum + Math.max(0, file.outputSize ?? 0),
    0,
  );

  return {
    completedFiles,
    totalFiles: files.length,
    progress: Number((progress / files.length).toFixed(1)),
    originalBytes,
    outputBytes,
    savedBytes: originalBytes - outputBytes,
  };
}

const ALLOWED_TRANSITIONS: Record<ProcessingStatus, ProcessingStatus[]> = {
  "validating-settings": ["creating-job", "failed", "cancelled"],
  "creating-job": ["uploading", "queued", "failed", "cancelled"],
  uploading: ["analyzing-media", "queued", "failed", "cancelled"],
  "analyzing-media": [
    "estimating-output",
    "queued",
    "processing",
    "enhancing",
    "encoding",
    "failed",
    "cancelled",
  ],
  "estimating-output": ["queued", "processing", "encoding", "failed", "cancelled"],
  queued: [
    "analyzing-media",
    "processing",
    "enhancing",
    "encoding",
    "failed",
    "cancelled",
  ],
  pending: ["analyzing", "processing", "cancelled", "failed"],
  analyzing: ["processing", "enhancing", "encoding", "failed", "cancelled"],
  processing: ["enhancing", "encoding", "finalizing", "failed", "cancelled"],
  enhancing: ["encoding", "finalizing", "failed", "cancelled"],
  encoding: ["finalizing", "failed", "cancelled"],
  finalizing: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["pending", "analyzing", "processing"],
  cancelled: ["pending", "analyzing", "processing"],
};

export function canTransitionProcessingStatus(
  from: ProcessingStatus,
  to: ProcessingStatus,
) {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}
