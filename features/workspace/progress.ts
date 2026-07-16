import {
  selectedVideoHeight,
  type VideoCompressionOptions,
} from "@/lib/media/video-types";
import {
  AI_VIDEO_PROCESSING_STAGES,
  AUDIO_PROCESSING_STAGES,
  IMAGE_PROCESSING_STAGES,
  VIDEO_PROCESSING_STAGES,
  inferStageIndex,
  stepsFromProgress,
} from "@/lib/progress/stages";

import type { FileProgressItem, ProcessingDetailData } from "@/components/progress";
import type { ItemStatus, QueueItem } from "@/features/workspace/types";
import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type { ImageAiOptions, ImageOutputFormat } from "@/lib/media/image-types";
import type { ProcessingStatus, ProgressEvent } from "@/lib/progress/types";

export function isTerminalProgressEvent(event: ProgressEvent) {
  return (
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled"
  );
}

export function itemStatusFromProcessingStatus(status: ProcessingStatus): ItemStatus {
  if (status === "completed") return "complete";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  if (status === "pending" || status === "queued") return "queued";
  return "processing";
}

export function processingStatusFromItem(item: QueueItem): ProcessingStatus {
  if (item.progressEvent) return item.progressEvent.status;
  if (item.status === "complete") return "completed";
  if (item.status === "error") return "failed";
  if (item.status === "cancelled") return "cancelled";
  if (item.status === "queued") return "pending";
  return "processing";
}

export function fileProgressStatus(item: QueueItem): FileProgressItem["status"] {
  if (item.status === "complete") return "completed";
  if (item.status === "error") return "failed";
  if (item.status === "cancelled") return "cancelled";
  if (item.status === "queued") {
    return item.inspectionStatus === "uploading" ? "analyzing-file" : "pending";
  }
  const status = item.progressEvent?.status;
  if (status === "analyzing" || status === "analyzing-media" || status === "uploading") {
    return item.progressStage?.includes("メタデータ")
      ? "analyzing-metadata"
      : "analyzing-file";
  }
  if (status === "enhancing") return "enhancing";
  if (status === "finalizing") return "outputting";
  if (item.progressStage?.includes("圧縮")) return "compressing";
  return "converting";
}

export function stagesForItem(item: QueueItem) {
  if (item.kind === "image") return IMAGE_PROCESSING_STAGES;
  if (item.kind === "audio") return AUDIO_PROCESSING_STAGES;
  if (
    item.kind === "video" &&
    (item.progressEvent?.kind === "ai-video" ||
      item.result?.video?.options.upscaleMode === "ai")
  ) {
    return AI_VIDEO_PROCESSING_STAGES;
  }
  return VIDEO_PROCESSING_STAGES;
}

export function applyProgressToItem(
  item: QueueItem,
  event: ProgressEvent,
  now = Date.now(),
): QueueItem {
  if (
    item.progressEvent &&
    Number.isFinite(event.sequence) &&
    event.sequence <= item.progressEvent.sequence
  ) {
    return item;
  }
  const nextStatus = itemStatusFromProcessingStatus(event.status);
  const logEntry = {
    id: event.eventId,
    message: event.message || event.stage,
    level:
      event.status === "failed"
        ? ("error" as const)
        : event.status === "cancelled"
          ? ("warning" as const)
          : event.status === "completed"
            ? ("success" as const)
            : ("info" as const),
    timestamp: event.timestamp,
  };
  const previousLogs = item.logs ?? [];
  const logs = previousLogs.some((entry) => entry.id === logEntry.id)
    ? previousLogs
    : [...previousLogs, logEntry].slice(-80);
  const terminal =
    nextStatus === "complete" || nextStatus === "error" || nextStatus === "cancelled";
  return {
    ...item,
    status: nextStatus,
    progress: event.progress,
    progressStage: event.stage,
    progressEvent: event,
    logs,
    finishedAt: terminal ? now : item.finishedAt,
    error: event.status === "failed" ? event.message : item.error,
  };
}

export interface CurrentProgressInput {
  item: QueueItem;
  videoOptions: VideoCompressionOptions;
  clock: number;
}

export function buildCurrentProgressEvent({
  item,
  videoOptions,
  clock,
}: CurrentProgressInput): ProgressEvent {
  const existing = item.progressEvent;
  const labels =
    item.kind === "video" && videoOptions.upscaleMode === "ai"
      ? AI_VIDEO_PROCESSING_STAGES
      : stagesForItem(item);
  const progress = Math.min(99, item.progress ?? 0);
  const status = existing?.status ?? "processing";
  const stageIndex = existing?.stageIndex ?? inferStageIndex(progress, labels.length);
  const elapsedSeconds = Math.max(
    existing?.elapsedSeconds ?? 0,
    item.startedAt ? (clock - item.startedAt) / 1_000 : 0,
  );
  if (existing) return { ...existing, elapsedSeconds };
  const kind: ProgressEvent["kind"] =
    item.kind === "video" && videoOptions.upscaleMode === "ai"
      ? "ai-video"
      : item.kind === "unknown"
        ? "image"
        : item.kind;
  return {
    eventId: `${item.id}:local`,
    sequence: 0,
    timestamp: new Date(clock).toISOString(),
    jobId: item.activeJobId ?? item.uploadId ?? item.id,
    fileId: item.id,
    kind,
    status,
    stage: item.progressStage ?? "処理開始を待っています",
    stageIndex,
    totalStages: labels.length,
    steps: stepsFromProgress(labels, stageIndex),
    progress,
    elapsedSeconds,
    originalSize: item.originalSize ?? item.file.size,
    message: item.progressStage ?? "処理開始を待っています",
  };
}

export interface ProcessingDetailsInput {
  item: QueueItem;
  event: ProgressEvent;
  videoOptions: VideoCompressionOptions;
  audioOptions: AudioProcessingOptions;
  imageAi: ImageAiOptions;
  outputFormat: ImageOutputFormat;
}

export function buildProcessingDetails({
  item,
  event,
  videoOptions,
  audioOptions,
  imageAi,
  outputFormat,
}: ProcessingDetailsInput): ProcessingDetailData {
  const originalSize = item.originalSize ?? item.file.size;
  if (item.kind === "video" && item.videoInfo) {
    const source = item.videoInfo;
    const targetHeight = selectedVideoHeight(videoOptions) ?? source.height;
    const targetWidth = Math.max(
      2,
      Math.round((source.width * targetHeight) / source.height / 2) * 2,
    );
    const outputCodec =
      videoOptions.mode === "copy"
        ? source.videoCodec
        : videoOptions.codec === "h264"
          ? "H.264"
          : videoOptions.codec === "h265"
            ? "H.265"
            : videoOptions.codec.toUpperCase();
    return {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      currentFrame: event.currentFrame,
      totalFrames:
        event.totalFrames ??
        (source.fps ? Math.round(source.duration * source.fps) : undefined),
      processedTime: event.processedTime,
      totalDuration: event.totalDuration ?? source.duration,
      speed: event.speed,
      fps: event.fps,
      originalResolution: `${source.width}×${source.height}`,
      outputResolution: `${targetWidth}×${targetHeight}`,
      originalCodec: source.videoCodec.toUpperCase(),
      outputCodec,
      encoder: event.media?.encoder,
      originalSize,
      currentOutputSize: event.currentOutputSize,
      estimatedOutputSize: event.estimatedOutputSize,
    };
  }
  if (item.kind === "audio") {
    return {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      processedTime: event.processedTime,
      totalDuration: event.totalDuration ?? item.audioInfo?.duration,
      speed: event.speed,
      originalCodec: item.audioInfo?.audioCodec.toUpperCase(),
      outputCodec: audioOptions.outputFormat.toUpperCase(),
      originalSize,
      currentOutputSize: event.currentOutputSize,
      estimatedOutputSize: event.estimatedOutputSize,
      originalFormat: item.detectedFormat,
      outputFormat: audioOptions.outputFormat,
      currentOperation: event.stage,
      metadataRemoval: audioOptions.removeMetadata ? "pending" : "kept",
    };
  }
  const imageBefore = item.result?.image?.before;
  const scale = imageAi.enabled ? imageAi.scale : 1;
  const sourceWidth = imageBefore?.width;
  const sourceHeight = imageBefore?.height;
  return {
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    originalSize,
    currentOutputSize: event.currentOutputSize,
    estimatedOutputSize: event.estimatedOutputSize,
    originalResolution:
      sourceWidth && sourceHeight ? `${sourceWidth}×${sourceHeight}` : undefined,
    outputResolution:
      sourceWidth && sourceHeight
        ? `${sourceWidth * scale}×${sourceHeight * scale}`
        : undefined,
    originalFormat: item.detectedFormat,
    outputFormat,
    currentOperation: event.stage,
    aiScale: imageAi.enabled ? imageAi.scale : undefined,
    metadataRemoval: "pending",
  };
}

export function toFileProgressItem(item: QueueItem): FileProgressItem {
  return {
    id: item.id,
    fileName: item.file.name,
    kind: item.kind === "unknown" ? "image" : item.kind,
    format: item.detectedFormat,
    originalSize: item.result?.originalSize ?? item.originalSize ?? item.file.size,
    status: fileProgressStatus(item),
    progress: item.status === "complete" ? 100 : (item.progress ?? 0),
    stage: item.progressStage,
    thumbnailUrl: item.originalPreview,
    outputSize: item.result?.outputSize,
    reductionPercent: item.result?.reductionPercent,
    errorMessage: item.error ?? item.inspectionError,
  };
}
