export type ProcessingStatus =
  | "validating-settings"
  | "creating-job"
  | "uploading"
  | "analyzing-media"
  | "estimating-output"
  | "queued"
  | "pending"
  | "analyzing"
  | "processing"
  | "enhancing"
  | "encoding"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

export type ProcessingStepStatus =
  "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface ProcessingStep {
  id: string;
  label: string;
  status: ProcessingStepStatus;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

/** Values emitted by FFmpeg's machine-readable `-progress pipe:1` output. */
export interface FfmpegProgressMetrics {
  frame?: number;
  fps?: number;
  bitrate?: string;
  bitrateKbps?: number;
  totalSize?: number;
  outTimeSeconds?: number;
  outTime?: string;
  duplicateFrames?: number;
  droppedFrames?: number;
  speed?: string;
  speedMultiplier?: number;
  progress?: "continue" | "end";
}

export interface ProgressMediaDetails {
  originalWidth?: number;
  originalHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  originalCodec?: string;
  outputCodec?: string;
  encoder?: string;
  inputFormat?: string;
  outputFormat?: string;
  aiScale?: 2 | 4;
  metadataRemoved?: boolean;
}

/**
 * Immutable event sent to progress clients. `sequence` and `eventId` make
 * reconnect/replay idempotent even when EventSource delivers an event twice.
 */
export interface ProgressEvent {
  eventId: string;
  sequence: number;
  timestamp: string;
  jobId: string;
  fileId: string;
  fileName?: string;
  kind: "image" | "video" | "audio" | "ai-image" | "ai-video";
  status: ProcessingStatus;
  stage: string;
  stageIndex: number;
  totalStages: number;
  steps: ProcessingStep[];
  /** 0..99 while work is in-flight; exactly 100 only after validation. */
  progress: number;
  currentFrame?: number;
  attempt?: number;
  maxAttempts?: number;
  totalFrames?: number;
  processedTime?: number;
  totalDuration?: number;
  fps?: number;
  bitrate?: string;
  speed?: string;
  speedMultiplier?: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds?: number;
  originalSize: number;
  currentOutputSize?: number;
  estimatedOutputSize?: number;
  media?: ProgressMediaDetails;
  message: string;
}

export type ProgressEventUpdate = Partial<
  Omit<
    ProgressEvent,
    "eventId" | "sequence" | "timestamp" | "jobId" | "fileId" | "kind" | "elapsedSeconds"
  >
>;

export interface ProgressJobRegistration {
  fileId?: string;
  fileName?: string;
  originalSize?: number;
  totalDuration?: number;
  totalFrames?: number;
  stageLabels?: string[];
  media?: ProgressMediaDetails;
}

export interface PersistedProgressJob {
  version: 1;
  state: import("@/lib/jobs/job-registry").ProcessingJobState;
  events: ProgressEvent[];
}
