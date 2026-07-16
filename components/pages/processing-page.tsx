"use client";

import { FileAudio, FileImage, FileVideo, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  CancelProcessingDialog,
  ErrorCard,
  FileProgressCard,
  OverallProgressCard,
  ProcessingDetails,
  ProcessingLog,
  ProcessingStepList,
  type FileProgressItem,
  type ProcessingDetailData,
  type ProcessingLogEntry,
} from "@/components/progress";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { userFriendlyError } from "@/lib/ui/error-messages";

import type { ProgressEvent } from "@/lib/progress/types";

function mediaKind(event: ProgressEvent) {
  if (event.kind === "ai-image") return "image" as const;
  if (event.kind === "ai-video") return "video" as const;
  return event.kind;
}

function fileStatus(event: ProgressEvent): FileProgressItem["status"] {
  if (event.status === "completed") return "completed";
  if (event.status === "failed") return "failed";
  if (event.status === "cancelled") return "cancelled";
  if (
    event.status === "analyzing" ||
    event.status === "analyzing-media" ||
    event.status === "uploading"
  )
    return "analyzing-file";
  if (event.status === "enhancing") return "enhancing";
  if (event.status === "finalizing") return "outputting";
  return "converting";
}

export function ProcessingPage({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [logs, setLogs] = useState<ProcessingLogEntry[]>([]);

  const receive = useCallback((next: ProgressEvent) => {
    setEvent((current) => {
      if (current && next.sequence <= current.sequence) return current;
      return next;
    });
    setLogs((current) =>
      current.some((entry) => entry.id === next.eventId)
        ? current
        : [
            ...current,
            {
              id: next.eventId,
              message: next.message || next.stage,
              level:
                next.status === "failed"
                  ? "error"
                  : next.status === "cancelled"
                    ? "warning"
                    : next.status === "completed"
                      ? "success"
                      : "info",
              timestamp: next.timestamp,
            } satisfies ProcessingLogEntry,
          ].slice(-80),
    );
  }, []);

  useEffect(() => {
    let active = true;
    let source: EventSource | null = null;
    let polling = false;
    let pollTimer: number | undefined;
    const pollWhileDisconnected = async () => {
      if (!active || !polling) return;
      try {
        const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const payload = (await response.json()) as { latestEvent?: ProgressEvent };
        if (response.ok && payload.latestEvent) {
          receive(payload.latestEvent);
          if (["completed", "failed", "cancelled"].includes(payload.latestEvent.status)) {
            polling = false;
            return;
          }
        }
      } catch {
        // A later polling attempt or EventSource reconnect can recover the display.
      }
      pollTimer = window.setTimeout(() => void pollWhileDisconnected(), 1_000);
    };
    void fetch(`/api/jobs/${jobId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          latestEvent?: ProgressEvent;
          error?: string;
          code?: string;
        };
        if (!response.ok || !payload.latestEvent)
          throw new Error(userFriendlyError(payload.code, payload.error));
        if (!active) return;
        receive(payload.latestEvent);
        if (["completed", "failed", "cancelled"].includes(payload.latestEvent.status))
          return;
        source = new EventSource(`/api/jobs/${jobId}/events`);
        source.addEventListener("progress", (message) => {
          try {
            receive(JSON.parse((message as MessageEvent<string>).data) as ProgressEvent);
          } catch {
            /* keep reconnecting */
          }
        });
        source.onerror = () => {
          if (active) {
            setError("進捗通知へ再接続しています。処理はサーバーで継続しています。");
            if (!polling) {
              polling = true;
              void pollWhileDisconnected();
            }
          }
        };
        source.onopen = () => {
          polling = false;
          if (pollTimer !== undefined) window.clearTimeout(pollTimer);
          setError(null);
        };
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error ? reason.message : "処理状況を取得できませんでした。",
        ),
      );
    return () => {
      active = false;
      polling = false;
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
      source?.close();
    };
  }, [jobId, receive]);

  useEffect(() => {
    if (event?.status !== "completed") return;
    const timer = window.setTimeout(() => router.replace(`/result/${jobId}`), 900);
    return () => window.clearTimeout(timer);
  }, [event?.status, jobId, router]);

  useEffect(() => {
    if (!event || ["completed", "failed", "cancelled"].includes(event.status)) return;
    const warn = (browserEvent: BeforeUnloadEvent) => {
      browserEvent.preventDefault();
      browserEvent.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [event]);

  const cancel = async () => {
    setCancelling(true);
    const response = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    if (!response.ok)
      setError("キャンセル要求を送信できませんでした。もう一度お試しください。");
    setCancelling(false);
    setCancelOpen(false);
  };

  if (!event && !error) {
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-10 sm:px-6">
        <p className="mb-4 text-xs font-black text-[var(--primary)]">
          3 / 3　処理・結果を確認
        </p>
        <LoadingSkeleton rows={5} />
      </main>
    );
  }
  if (!event && error) {
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-4xl px-4 py-12 sm:px-6">
        <ErrorCard
          message={error}
          onRetry={() => window.location.reload()}
          onChangeSettings={() => router.push("/optimize")}
        />
      </main>
    );
  }
  if (!event) return null;

  const kind = mediaKind(event);
  const Icon = kind === "image" ? FileImage : kind === "audio" ? FileAudio : FileVideo;
  const details: ProcessingDetailData = {
    attempt: event.attempt,
    maxAttempts: event.maxAttempts,
    currentFrame: event.currentFrame,
    totalFrames: event.totalFrames,
    processedTime: event.processedTime,
    totalDuration: event.totalDuration,
    speed: event.speed,
    fps: event.fps,
    originalResolution:
      event.media?.originalWidth && event.media?.originalHeight
        ? `${event.media.originalWidth}×${event.media.originalHeight}`
        : undefined,
    outputResolution:
      event.media?.outputWidth && event.media?.outputHeight
        ? `${event.media.outputWidth}×${event.media.outputHeight}`
        : undefined,
    originalCodec: event.media?.originalCodec,
    outputCodec: event.media?.outputCodec,
    originalSize: event.originalSize,
    currentOutputSize: event.currentOutputSize,
    estimatedOutputSize: event.estimatedOutputSize,
    originalFormat: event.media?.inputFormat,
    outputFormat: event.media?.outputFormat,
    currentOperation: event.stage,
    aiScale: event.media?.aiScale,
    metadataRemoval: event.media?.metadataRemoved ? "pending" : "kept",
  };
  const fileItem: FileProgressItem = {
    id: event.fileId,
    fileName: event.fileName ?? "処理中のファイル",
    kind,
    format: event.media?.inputFormat,
    originalSize: event.originalSize,
    status: fileStatus(event),
    progress: event.progress,
    stage: event.stage,
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="mb-4 text-xs font-black text-[var(--primary)]">
          3 / 3　処理・結果を確認
        </p>
        <OverallProgressCard
          event={event}
          fileName={fileItem.fileName}
          onCancel={() => setCancelOpen(true)}
          preview={
            <div className="grid min-h-56 place-items-center bg-slate-950 text-center text-white">
              <div>
                <Icon className="mx-auto text-cyan-300" size={44} />
                <p className="mt-3 text-sm font-black">{event.stage}</p>
              </div>
            </div>
          }
        />
        {error && event.status !== "failed" && (
          <p
            className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            role="status"
          >
            <LoaderCircle
              className="mr-2 inline animate-spin motion-reduce:animate-none"
              size={14}
            />
            {error}
          </p>
        )}
        <div className="mt-4 grid gap-4 lg:grid-cols-[.75fr_1.25fr]">
          <div className="space-y-4">
            <ProcessingStepList
              steps={event.steps}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
            />
            <FileProgressCard item={fileItem} onCancel={() => setCancelOpen(true)} />
          </div>
          <div className="space-y-4">
            <ProcessingDetails kind={kind} data={details} />
            <ProcessingLog entries={logs} />
            {event.status === "failed" && (
              <ErrorCard
                message={event.message}
                onRetry={() => router.push("/optimize")}
                onChangeSettings={() => router.push("/optimize")}
              />
            )}
          </div>
        </div>
      </div>
      <CancelProcessingDialog
        open={cancelOpen}
        fileName={fileItem.fileName}
        isCancelling={cancelling}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => void cancel()}
      />
    </main>
  );
}
