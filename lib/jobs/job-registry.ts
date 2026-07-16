import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { FILE_TTL_MS, TEMP_ROOT } from "@/lib/config";
import { StableEtaEstimator } from "@/lib/progress/eta";
import { logger } from "@/shared/logging/logger";

import type {
  ProcessingStatus,
  ProcessingStep,
  ProgressEvent,
  ProgressEventUpdate,
  ProgressJobRegistration,
} from "@/lib/progress/types";

export type ProcessingJobKind = "image" | "video" | "audio" | "ai-image" | "ai-video";
export type ProcessingJobStatus =
  "queued" | "running" | "complete" | "cancelled" | "error";

export interface ProcessingJobState {
  jobId: string;
  kind: ProcessingJobKind;
  status: ProcessingJobStatus;
  progress: number;
  stage: string;
  startedAt: string;
  updatedAt: string;
  latestEvent: ProgressEvent;
}

export type ProcessingJobUpdate = Omit<ProgressEventUpdate, "status"> & {
  /** Both the old route status and the detailed UI status are accepted. */
  status?: ProcessingJobStatus | ProcessingStatus;
};
export type ProgressEventSubscriber = (event: ProgressEvent) => void;

interface RegisteredJob {
  state: ProcessingJobState;
  controller: AbortController;
  events: ProgressEvent[];
  subscribers: Set<ProgressEventSubscriber>;
  eta: StableEtaEstimator;
  startedAtMs: number;
  stateFile?: string;
  persistQueue: Promise<void>;
  deletionTimer?: ReturnType<typeof setTimeout>;
}

interface PersistedJobFile {
  version: 1;
  state: ProcessingJobState;
  events: ProgressEvent[];
}

const MAX_EVENT_HISTORY = 400;
const DEFAULT_STAGES: Record<ProcessingJobKind, string[]> = {
  image: [
    "ファイルを確認",
    "メタデータを解析",
    "画像を変換",
    "画像を最適化",
    "出力ファイルを生成",
    "ダウンロード準備",
  ],
  video: [
    "ファイルを確認",
    "ffprobeで動画情報を解析",
    "メタデータを確認",
    "動画をデコード",
    "解像度を変更",
    "動画をエンコード",
    "音声を結合",
    "出力ファイルを生成",
    "ダウンロード準備",
  ],
  audio: [
    "ファイルを確認",
    "ffprobeで音声情報を解析",
    "メタデータを確認",
    "音声をデコード",
    "音声をエンコード",
    "出力ファイルを生成",
    "ダウンロード準備",
  ],
  "ai-image": [
    "ファイルを解析",
    "AIモデルを読み込み",
    "AI高画質化",
    "画像を最適化",
    "出力ファイルを生成",
    "ダウンロード準備",
  ],
  "ai-video": [
    "ファイルを解析",
    "フレームを抽出",
    "AIモデルを読み込み",
    "AI高画質化",
    "動画を再構築",
    "音声を結合",
    "出力ファイルを生成",
    "ダウンロード準備",
  ],
};

const globalJobs = globalThis as typeof globalThis & {
  compressionFileJobs?: Map<string, RegisteredJob>;
};
const jobs = (globalJobs.compressionFileJobs ??= new Map());

function now() {
  return new Date().toISOString();
}

function validJobId(jobId: string) {
  return /^[0-9a-f-]{36}$/i.test(jobId);
}

function cloneEvent(event: ProgressEvent): ProgressEvent {
  return {
    ...event,
    steps: event.steps.map((step) => ({ ...step })),
    media: event.media ? { ...event.media } : undefined,
  };
}

function cloneState(state: ProcessingJobState): ProcessingJobState {
  return { ...state, latestEvent: cloneEvent(state.latestEvent) };
}

function toLegacyStatus(status: ProcessingJobUpdate["status"]): ProcessingJobStatus {
  if (status === "completed") return "complete";
  if (status === "failed") return "error";
  if (status === "cancelled") return "cancelled";
  if (
    status === "pending" ||
    status === "queued" ||
    status === "validating-settings" ||
    status === "creating-job" ||
    status === "uploading"
  )
    return "queued";
  if (status === "complete" || status === "error") {
    return status;
  }
  return "running";
}

function toDetailedStatus(
  status: ProcessingJobUpdate["status"],
  stage: string,
  progress: number,
): ProcessingStatus {
  if (status === "complete" || status === "completed") return "completed";
  if (status === "error" || status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "queued" || status === "pending") return "queued";
  if (
    status === "validating-settings" ||
    status === "creating-job" ||
    status === "uploading" ||
    status === "analyzing-media" ||
    status === "estimating-output" ||
    status === "analyzing" ||
    status === "processing" ||
    status === "enhancing" ||
    status === "encoding" ||
    status === "finalizing"
  ) {
    return status;
  }
  if (/AI|高画質|補正/.test(stage)) return "enhancing";
  if (/解析|ffprobe|確認|検出/.test(stage)) return "analyzing";
  if (/エンコード|FFmpeg|変換|圧縮|再構築/.test(stage)) return "encoding";
  if (/出力|検証|プレビュー|ダウンロード|完了/.test(stage) || progress >= 99) {
    return "finalizing";
  }
  return "processing";
}

function inferStageIndex(
  stage: string,
  labels: readonly string[],
  previous: number,
  progress: number,
) {
  const exact = labels.findIndex(
    (label) => label === stage || stage.includes(label) || label.includes(stage),
  );
  if (exact >= 0) return exact;
  const patterns = [
    /ファイル|設定|確認中/,
    /ffprobe|解析/,
    /メタデータ/,
    /デコード|抽出|分解/,
    /AIモデル|解像度|変換/,
    /エンコード|FFmpeg|高画質|最適化/,
    /音声|結合/,
    /出力|生成|再構築|検証/,
    /ダウンロード|プレビュー|完了/,
  ];
  const match = patterns.findIndex((pattern) => pattern.test(stage));
  if (match >= 0) return Math.min(labels.length - 1, Math.max(previous, match));
  if (progress >= 99) return labels.length - 1;
  return Math.min(labels.length - 1, Math.max(0, previous));
}

function buildSteps(
  labels: readonly string[],
  activeIndex: number,
  status: ProcessingStatus,
  timestamp: string,
  previous?: readonly ProcessingStep[],
) {
  return labels.map((label, index): ProcessingStep => {
    const old = previous?.[index];
    const waiting = status === "pending" || status === "queued";
    if (status === "completed" || index < activeIndex) {
      return {
        id: `step-${index + 1}`,
        label,
        status: "completed",
        startedAt: old?.startedAt ?? timestamp,
        completedAt: old?.completedAt ?? timestamp,
      };
    }
    if (index === activeIndex) {
      const terminal = status === "failed" || status === "cancelled";
      return {
        id: `step-${index + 1}`,
        label,
        status:
          status === "failed"
            ? "failed"
            : status === "cancelled"
              ? "cancelled"
              : waiting
                ? "pending"
                : "processing",
        startedAt: old?.startedAt ?? (waiting ? undefined : timestamp),
        completedAt: terminal ? timestamp : undefined,
      };
    }
    return { id: `step-${index + 1}`, label, status: "pending" };
  });
}

function schedulePersistence(job: RegisteredJob) {
  if (!job.stateFile) return;
  const snapshot: PersistedJobFile = {
    version: 1,
    state: cloneState(job.state),
    events: job.events.map(cloneEvent),
  };
  const contents = JSON.stringify(snapshot);
  job.persistQueue = job.persistQueue
    .then(() => writeFile(job.stateFile!, contents, "utf8"))
    .catch(() => undefined);
}

function appendEvent(job: RegisteredJob, event: ProgressEvent) {
  const immutable = cloneEvent(event);
  job.events.push(immutable);
  if (job.events.length > MAX_EVENT_HISTORY) {
    job.events.splice(0, job.events.length - MAX_EVENT_HISTORY);
  }
  job.state.latestEvent = immutable;
  job.state.progress = immutable.progress;
  job.state.stage = immutable.stage;
  job.state.updatedAt = immutable.timestamp;
  schedulePersistence(job);
  for (const subscriber of job.subscribers) {
    try {
      subscriber(cloneEvent(immutable));
    } catch {
      // A disconnected SSE client must not interrupt media processing.
    }
  }
}

function initialEvent(
  jobId: string,
  kind: ProcessingJobKind,
  registration: ProgressJobRegistration,
  startedAt: string,
): ProgressEvent {
  const labels =
    registration.stageLabels?.filter((label) => label.trim()) ?? DEFAULT_STAGES[kind];
  const timestamp = now();
  return {
    eventId: `${jobId}:1`,
    sequence: 1,
    timestamp,
    jobId,
    fileId: registration.fileId ?? jobId,
    fileName: registration.fileName,
    kind,
    status: "queued",
    stage: labels[0] ?? "ファイルを確認",
    stageIndex: 0,
    totalStages: labels.length,
    steps: buildSteps(labels, 0, "queued", timestamp),
    progress: 0,
    totalFrames: registration.totalFrames,
    totalDuration: registration.totalDuration,
    elapsedSeconds: Math.max(0, (Date.now() - Date.parse(startedAt)) / 1000),
    originalSize: registration.originalSize ?? 0,
    media: registration.media ? { ...registration.media } : undefined,
    message: "処理開始を待っています。",
  };
}

export function registerProcessingJob(
  jobId: string,
  kind: ProcessingJobKind,
  directory?: string,
  registration: ProgressJobRegistration = {},
) {
  const previous = jobs.get(jobId);
  previous?.controller.abort();
  if (previous?.deletionTimer) clearTimeout(previous.deletionTimer);
  const controller = new AbortController();
  const startedAt = now();
  const event = initialEvent(jobId, kind, registration, startedAt);
  const state: ProcessingJobState = {
    jobId,
    kind,
    status: "queued",
    progress: 0,
    stage: event.stage,
    startedAt,
    updatedAt: event.timestamp,
    latestEvent: event,
  };
  const job: RegisteredJob = {
    state,
    controller,
    events: [cloneEvent(event)],
    subscribers: new Set(),
    eta: new StableEtaEstimator(),
    startedAtMs: Date.now(),
    stateFile: directory
      ? join(/*turbopackIgnore: true*/ directory, "job-state.json")
      : undefined,
    persistQueue: Promise.resolve(),
  };
  jobs.set(jobId, job);
  schedulePersistence(job);
  return controller.signal;
}

export function updateProcessingJob(jobId: string, update: ProcessingJobUpdate) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (["complete", "cancelled", "error"].includes(job.state.status)) {
    return cloneEvent(job.state.latestEvent);
  }
  const previous: ProgressEvent = job.state.latestEvent;
  const requested = update.progress ?? previous.progress;
  const completing = update.status === "complete" || update.status === "completed";
  const progress = completing
    ? 100
    : Number(Math.min(99, Math.max(previous.progress, requested)).toFixed(1));
  const stage = update.stage ?? previous.stage;
  const status = toDetailedStatus(update.status, stage, progress);
  const timestamp = now();
  const elapsedSeconds = Math.max(0, (Date.now() - job.startedAtMs) / 1000);
  const labels = previous.steps.map((step) => step.label);
  const stageIndex = Math.min(
    Math.max(
      0,
      update.stageIndex ?? inferStageIndex(stage, labels, previous.stageIndex, progress),
    ),
    Math.max(0, labels.length - 1),
  );
  const estimatedRemainingSeconds =
    status === "completed"
      ? 0
      : (job.eta.update(progress, elapsedSeconds) ?? previous.estimatedRemainingSeconds);
  const currentOutputSize = update.currentOutputSize ?? previous.currentOutputSize;
  const estimatedOutputSize =
    update.estimatedOutputSize ??
    (currentOutputSize !== undefined && progress > 0
      ? Math.max(currentOutputSize, Math.round(currentOutputSize / (progress / 100)))
      : previous.estimatedOutputSize);
  const event: ProgressEvent = {
    ...previous,
    ...update,
    eventId: `${jobId}:${previous.sequence + 1}`,
    sequence: previous.sequence + 1,
    timestamp,
    jobId,
    fileId: previous.fileId,
    kind: previous.kind,
    status,
    stage,
    stageIndex,
    totalStages: labels.length,
    steps: buildSteps(labels, stageIndex, status, timestamp, previous.steps),
    progress,
    elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
    estimatedRemainingSeconds,
    originalSize: previous.originalSize,
    currentOutputSize,
    estimatedOutputSize,
    media: { ...previous.media, ...update.media },
    message: update.message ?? stage,
  };
  job.state.status = toLegacyStatus(update.status);
  appendEvent(job, event);
  return cloneEvent(event);
}

export function getProcessingJob(jobId: string) {
  const job = jobs.get(jobId);
  return job ? cloneState(job.state) : null;
}

function isPersistedJobFile(value: unknown): value is PersistedJobFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedJobFile>;
  return (
    candidate.version === 1 &&
    !!candidate.state &&
    typeof candidate.state.jobId === "string" &&
    Array.isArray(candidate.events)
  );
}

export async function getOrRestoreProcessingJob(jobId: string) {
  const existing = getProcessingJob(jobId);
  if (existing) return existing;
  if (!validJobId(jobId)) return null;
  const stateFile = join(/*turbopackIgnore: true*/ TEMP_ROOT, jobId, "job-state.json");
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (!isPersistedJobFile(parsed) || parsed.state.jobId !== jobId) return null;
    const events = parsed.events
      .filter(
        (event): event is ProgressEvent =>
          !!event &&
          typeof event === "object" &&
          event.jobId === jobId &&
          typeof event.sequence === "number" &&
          Array.isArray(event.steps),
      )
      .sort((left, right) => left.sequence - right.sequence)
      .slice(-MAX_EVENT_HISTORY)
      .map(cloneEvent);
    const latest = events.at(-1);
    if (!latest) return null;
    const parsedStart = Date.parse(parsed.state.startedAt);
    const job: RegisteredJob = {
      state: {
        ...parsed.state,
        progress: latest.progress,
        stage: latest.stage,
        updatedAt: latest.timestamp,
        latestEvent: cloneEvent(latest),
      },
      controller: new AbortController(),
      events,
      subscribers: new Set(),
      eta: new StableEtaEstimator(),
      startedAtMs: Number.isFinite(parsedStart)
        ? parsedStart
        : Date.parse(latest.timestamp),
      stateFile,
      persistQueue: Promise.resolve(),
    };
    for (const event of events) job.eta.update(event.progress, event.elapsedSeconds);
    jobs.set(jobId, job);
    if (job.state.status !== "running" && job.state.status !== "queued") {
      scheduleMemoryCleanup(jobId, job);
    }
    return cloneState(job.state);
  } catch {
    return null;
  }
}

function eventSequence(eventId: string | null | undefined) {
  if (!eventId) return 0;
  const match = /(?:^|:)(\d+)$/.exec(eventId.trim());
  const sequence = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}

export function getProcessingJobEvents(jobId: string, afterEventId?: string | null) {
  const job = jobs.get(jobId);
  if (!job) return [];
  const afterSequence = eventSequence(afterEventId);
  return job.events
    .filter((event: ProgressEvent) => event.sequence > afterSequence)
    .map(cloneEvent);
}

export function subscribeProcessingJob(
  jobId: string,
  subscriber: ProgressEventSubscriber,
) {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.subscribers.add(subscriber);
  return () => job.subscribers.delete(subscriber);
}

function scheduleMemoryCleanup(jobId: string, job: RegisteredJob) {
  if (job.deletionTimer) clearTimeout(job.deletionTimer);
  job.deletionTimer = setTimeout(() => {
    if (jobs.get(jobId) === job) jobs.delete(jobId);
  }, FILE_TTL_MS);
  job.deletionTimer.unref();
}

export function cancelProcessingJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job || job.state.status === "complete" || job.state.status === "error") {
    return false;
  }
  if (job.state.status === "cancelled") return true;
  job.controller.abort();
  updateProcessingJob(jobId, {
    status: "cancelled",
    stage: "キャンセルしました",
    message: "処理をキャンセルしました。",
  });
  scheduleMemoryCleanup(jobId, job);
  return true;
}

export function finishProcessingJob(
  jobId: string,
  status: "complete" | "error" | "cancelled",
  message?: string,
) {
  const job = jobs.get(jobId);
  if (!job) return null;
  const event = updateProcessingJob(jobId, {
    status,
    progress: status === "complete" ? 100 : job.state.progress,
    stage:
      status === "complete"
        ? "完了"
        : status === "cancelled"
          ? "キャンセルしました"
          : "エラー",
    stageIndex: status === "complete" ? job.state.latestEvent.totalStages - 1 : undefined,
    estimatedRemainingSeconds: status === "complete" ? 0 : undefined,
    message:
      message ??
      (status === "complete"
        ? "処理が完了し、ダウンロードの準備ができました。"
        : status === "cancelled"
          ? "処理をキャンセルしました。"
          : "処理中にエラーが発生しました。"),
  });
  if (status === "error") {
    logger.error({
      jobId,
      fileId: job.state.latestEvent.fileId,
      stage: "job-finished",
      errorCode: "PROCESSING_JOB_FAILED",
      elapsedMs: Math.max(0, Date.now() - job.startedAtMs),
    });
  }
  scheduleMemoryCleanup(jobId, job);
  return event;
}
