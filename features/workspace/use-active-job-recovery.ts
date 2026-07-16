"use client";

import { useEffect } from "react";

import { fetchJobState, type JobState } from "@/features/upload/media-client";
import { forgetActiveJob, readStoredActiveJobs } from "@/features/workspace/active-jobs";
import { itemStatusFromProcessingStatus } from "@/features/workspace/progress";
import {
  AUDIO_PROCESSING_STAGES,
  IMAGE_PROCESSING_STAGES,
  VIDEO_PROCESSING_STAGES,
  inferStageIndex,
  stepsFromProgress,
} from "@/lib/progress/stages";

import type { QueueItem, StoredActiveJob } from "@/features/workspace/types";
import type { ProcessingStatus, ProgressEvent } from "@/lib/progress/types";

function processingStatusFromJobState(state: JobState): ProcessingStatus {
  if (state.status === "complete") return "completed";
  if (state.status === "error") return "failed";
  if (state.status === "cancelled") return "cancelled";
  return "processing";
}

export function createRecoveredQueueItem(
  descriptor: StoredActiveJob,
  state: JobState,
  now = Date.now(),
): QueueItem {
  const restoredEvent = state.latestEvent ?? state.currentEvent ?? state.event;
  const status = processingStatusFromJobState(state);
  const progress =
    restoredEvent?.progress ??
    Math.min(status === "completed" ? 100 : 99, state.progress ?? 0);
  const labels =
    descriptor.kind === "image"
      ? IMAGE_PROCESSING_STAGES
      : descriptor.kind === "audio"
        ? AUDIO_PROCESSING_STAGES
        : VIDEO_PROCESSING_STAGES;
  const stageIndex = inferStageIndex(progress, labels.length);
  const fallbackEvent: ProgressEvent = restoredEvent ?? {
    eventId: `${descriptor.jobId}:restored`,
    sequence: 0,
    timestamp: new Date().toISOString(),
    jobId: descriptor.jobId,
    fileId: descriptor.itemId,
    kind: descriptor.kind,
    status,
    stage: state.stage ?? "処理状況を復元しました",
    stageIndex,
    totalStages: labels.length,
    steps: stepsFromProgress(
      labels,
      stageIndex,
      status === "completed"
        ? "completed"
        : status === "failed"
          ? "failed"
          : status === "cancelled"
            ? "cancelled"
            : undefined,
    ),
    progress,
    elapsedSeconds: Math.max(0, (now - descriptor.startedAt) / 1_000),
    originalSize: descriptor.originalSize,
    message: state.stage ?? "保存済みの処理状況を復元しました",
  };
  return {
    id: descriptor.itemId,
    file: new File([], descriptor.fileName),
    kind: descriptor.kind,
    originalPreview: null,
    hasTransparency: null,
    detectedFormat: descriptor.detectedFormat,
    inspectionStatus: "ready",
    uploadId: descriptor.kind === "image" ? undefined : descriptor.jobId,
    activeJobId: descriptor.jobId,
    originalSize: descriptor.originalSize,
    startedAt: descriptor.startedAt,
    recovered: true,
    status: itemStatusFromProcessingStatus(fallbackEvent.status),
    progress: fallbackEvent.progress,
    progressStage: fallbackEvent.stage,
    progressEvent: fallbackEvent,
    logs: [
      {
        id: `${descriptor.jobId}:restore-log`,
        message: "ページ再読み込み後に処理状況を復元しました。",
        level: "info",
        timestamp: now,
      },
    ],
  };
}

export function useActiveJobRecovery({
  onRecover,
  connectJobProgress,
}: {
  onRecover: (item: QueueItem) => void;
  connectJobProgress: (itemId: string, jobId: string) => void;
}) {
  useEffect(() => {
    let active = true;
    readStoredActiveJobs().forEach((descriptor) => {
      void fetchJobState(descriptor.jobId)
        .then((state) => {
          if (!active) return;
          const item = createRecoveredQueueItem(descriptor, state);
          onRecover(item);
          const event = item.progressEvent;
          if (
            event &&
            event.status !== "completed" &&
            event.status !== "failed" &&
            event.status !== "cancelled"
          ) {
            connectJobProgress(descriptor.itemId, descriptor.jobId);
          } else {
            forgetActiveJob(descriptor.jobId);
          }
        })
        .catch(() => forgetActiveJob(descriptor.jobId));
    });
    return () => {
      active = false;
    };
  }, [connectJobProgress, onRecover]);
}
