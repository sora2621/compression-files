import type { ProcessingStatus as SharedProcessingStatus } from "@/lib/progress/types";
import type { ReactNode } from "react";

export type ProcessingStatus = SharedProcessingStatus;

export type ProcessingStepStatus =
  "pending" | "processing" | "completed" | "failed" | "cancelled";

export type FileProcessingStatus =
  | "pending"
  | "analyzing-file"
  | "analyzing-metadata"
  | "compressing"
  | "converting"
  | "enhancing"
  | "outputting"
  | "completed"
  | "failed"
  | "cancelled";

export type MediaKind = "image" | "video" | "audio";

export interface ProgressEvent {
  jobId: string;
  fileId: string;
  status: ProcessingStatus;
  stage: string;
  stageIndex: number;
  totalStages: number;
  progress: number;
  currentFrame?: number;
  attempt?: number;
  maxAttempts?: number;
  totalFrames?: number;
  processedTime?: number;
  totalDuration?: number;
  fps?: number;
  speed?: string;
  elapsedSeconds: number;
  estimatedRemainingSeconds?: number;
  originalSize: number;
  currentOutputSize?: number;
  estimatedOutputSize?: number;
  message: string;
}

export interface ProcessingStep {
  id: string;
  label: string;
  status: ProcessingStepStatus;
  description?: string;
}

export interface FileProgressItem {
  id: string;
  fileName: string;
  kind: MediaKind;
  format?: string;
  originalSize: number;
  status: FileProcessingStatus;
  progress: number;
  stage?: string;
  thumbnailUrl?: string | null;
  thumbnail?: ReactNode;
  outputSize?: number;
  reductionPercent?: number;
  errorMessage?: string;
}

export interface ProcessingDetailData {
  attempt?: number;
  maxAttempts?: number;
  currentFrame?: number;
  totalFrames?: number;
  processedTime?: number;
  totalDuration?: number;
  speed?: string;
  fps?: number;
  originalResolution?: string;
  outputResolution?: string;
  originalCodec?: string;
  outputCodec?: string;
  encoder?: string;
  originalSize?: number;
  currentOutputSize?: number;
  estimatedOutputSize?: number;
  originalFormat?: string;
  outputFormat?: string;
  currentOperation?: string;
  aiScale?: 2 | 4;
  metadataRemoval?: "pending" | "removed" | "kept" | "not-found";
}

export type ProcessingLogLevel = "info" | "success" | "warning" | "error";

export interface ProcessingLogEntry {
  id: string;
  message: string;
  level?: ProcessingLogLevel;
  timestamp?: string | number | Date;
}
