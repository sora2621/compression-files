import type { MediaKind, ProcessResult } from "@/features/workspace/types";
import type { RuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type {
  ImageAiOptions,
  ImageEncoding,
  ImageEnhancementOptions,
  ImageOutputFormat,
  ProcessingMode,
} from "@/lib/media/image-types";
import type {
  AudioMediaInfo,
  MediaProbeInfo,
  VideoCompressionOptions,
  VideoMediaInfo,
} from "@/lib/media/video-types";
import type {
  LosslessImageOptions,
  VideoQualitySearchOptions,
  VideoStreamSelectionOptions,
} from "@/lib/optimization/types";
import type { ProcessingSpeedPreset } from "@/lib/processing/types";
import type { ProgressEvent } from "@/lib/progress/types";
import type { TargetSizeEstimate, TargetSizeOptions } from "@/lib/target-size/types";

type ApiFetch = typeof fetch;

export class MediaProcessingError extends Error {
  constructor(
    message: string,
    public readonly requiresReupload = false,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "MediaProcessingError";
  }
}

function processingError(
  payload: { error?: string; code?: string },
  fallbackMessage: string,
) {
  return new MediaProcessingError(
    payload.error ?? fallbackMessage,
    payload.code === "UPLOAD_EXPIRED" || payload.code === "NOT_FOUND",
    payload.code,
  );
}

export async function fetchRuntimeCapabilities(
  apiFetch: ApiFetch = fetch,
): Promise<RuntimeCapabilities> {
  const response = await apiFetch("/api/capabilities", { cache: "no-store" });
  const payload = (await response.json()) as RuntimeCapabilities | { error?: string };
  if (!response.ok || !("outputs" in payload)) {
    throw new Error(
      "error" in payload ? payload.error : "実行環境の対応形式を取得できませんでした。",
    );
  }
  return payload;
}

interface InspectionPayload {
  uploadId?: string;
  kind: MediaKind;
  detectedFormat: string;
  imageInfo?: { hasAlpha: boolean };
  mediaInfo?: MediaProbeInfo;
  originalPreviewUrl?: string;
  recommendations?: Array<{
    id: string;
    title: string;
    description: string;
  }>;
}

export interface InspectedMedia {
  uploadId?: string;
  kind: MediaKind;
  detectedFormat: string;
  hasTransparency: boolean;
  probeInfo?: MediaProbeInfo;
  videoInfo?: VideoMediaInfo;
  audioInfo?: AudioMediaInfo;
  originalPreview: string | null;
  recommendations: Array<{
    id: string;
    title: string;
    description: string;
  }>;
}

export async function inspectMediaFile(
  file: File,
  apiFetch: ApiFetch = fetch,
): Promise<InspectedMedia> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await apiFetch("/api/media/inspect", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as InspectionPayload | { error?: string };
  if (!response.ok || !("kind" in payload)) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : "ファイル形式を解析できませんでした。",
    );
  }
  const videoInfo =
    payload.kind === "video" && payload.mediaInfo?.video
      ? {
          formatName: payload.mediaInfo.formatName,
          width: payload.mediaInfo.video.width,
          height: payload.mediaInfo.video.height,
          duration: payload.mediaInfo.duration,
          bitrate: payload.mediaInfo.bitrate,
          fps: payload.mediaInfo.video.fps,
          videoCodec: payload.mediaInfo.video.codec,
          audioCodec: payload.mediaInfo.audio?.codec ?? null,
          audioBitrate: payload.mediaInfo.audio?.bitrate ?? null,
          audioTrackCount: payload.mediaInfo.audioTrackCount,
        }
      : undefined;
  const audioInfo =
    payload.kind === "audio" && payload.mediaInfo?.audio
      ? {
          formatName: payload.mediaInfo.formatName,
          duration: payload.mediaInfo.duration,
          bitrate: payload.mediaInfo.bitrate,
          audioCodec: payload.mediaInfo.audio.codec,
          audioBitrate: payload.mediaInfo.audio.bitrate,
          sampleRate: payload.mediaInfo.audio.sampleRate,
          channels: payload.mediaInfo.audio.channels,
        }
      : undefined;
  return {
    uploadId: payload.uploadId,
    kind: payload.kind,
    detectedFormat: payload.detectedFormat,
    hasTransparency: payload.imageInfo?.hasAlpha ?? false,
    probeInfo: payload.mediaInfo,
    videoInfo,
    audioInfo,
    originalPreview:
      payload.kind === "image" ? (payload.originalPreviewUrl ?? null) : null,
    recommendations: payload.recommendations ?? [],
  };
}

export async function deleteInspectedUpload(
  uploadId: string,
  apiFetch: ApiFetch = fetch,
) {
  await apiFetch(`/api/media/inspect/${uploadId}`, { method: "DELETE" });
}

export async function cancelProcessingJob(jobId: string, apiFetch: ApiFetch = fetch) {
  return apiFetch(`/api/jobs/${jobId}`, { method: "DELETE" });
}

export interface JobState {
  status?: string;
  progress?: number;
  stage?: string;
  latestEvent?: ProgressEvent;
  currentEvent?: ProgressEvent;
  event?: ProgressEvent;
}

export async function fetchJobState(jobId: string, apiFetch: ApiFetch = fetch) {
  const response = await apiFetch(`/api/jobs/${jobId}`, { cache: "no-store" });
  if (!response.ok) throw new Error("JOB_NOT_FOUND");
  return (await response.json()) as JobState;
}

export type MediaStreamEvent =
  | {
      type: "progress";
      progress: number;
      stage?: string;
      event?: ProgressEvent;
    }
  | { type: "complete"; result: ProcessResult }
  | { type: "error"; error?: string; code?: string };

export async function parseNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
  onEntry: (entry: T) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line: string) => {
    if (line.trim()) onEntry(JSON.parse(line) as T);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);
}

export interface ProcessInspectedMediaInput {
  uploadId: string;
  kind: "video" | "audio";
  options: VideoCompressionOptions | AudioProcessingOptions;
  optimizationMode?: ProcessingMode;
  streamSelection: VideoStreamSelectionOptions;
  qualitySearch: VideoQualitySearchOptions;
  targetSizeOptions: TargetSizeOptions;
  retentionMinutes: number;
  onReady?: () => void;
  onProgressEvent?: (event: ProgressEvent) => void;
  onProgressFallback?: (progress: number, stage?: string) => void;
}

interface AcceptedProcessingJob {
  jobId: string;
  status: "queued";
  statusUrl: string;
  eventsUrl: string;
  resultUrl: string;
}

const JOB_CREATION_TIMEOUT_MS = 10_000;
const JOB_POLL_INTERVAL_MS = 750;
const JOB_PROCESSING_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function isAcceptedProcessingJob(value: unknown): value is AcceptedProcessingJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<AcceptedProcessingJob>;
  return (
    typeof job.jobId === "string" &&
    job.status === "queued" &&
    typeof job.statusUrl === "string" &&
    typeof job.eventsUrl === "string" &&
    typeof job.resultUrl === "string"
  );
}

async function waitForProcessingResult(
  job: AcceptedProcessingJob,
  input: ProcessInspectedMediaInput,
  apiFetch: ApiFetch,
) {
  const deadline = Date.now() + JOB_PROCESSING_TIMEOUT_MS;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    try {
      const response = await apiFetch(job.statusUrl, { cache: "no-store" });
      const state = (await response.json()) as JobState & {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        throw new MediaProcessingError(
          state.error ?? "処理状況を取得できませんでした。",
          state.code === "JOB_NOT_FOUND",
          state.code,
        );
      }
      consecutiveFailures = 0;
      if (state.latestEvent) input.onProgressEvent?.(state.latestEvent);
      const terminalStatus = state.latestEvent?.status ?? state.status;
      if (terminalStatus === "failed" || state.status === "error") {
        throw new MediaProcessingError(
          state.latestEvent?.message ?? "メディア処理中にエラーが発生しました。",
          false,
          "PROCESSING_FAILED",
        );
      }
      if (terminalStatus === "cancelled" || state.status === "cancelled") {
        throw new MediaProcessingError("処理をキャンセルしました。", false, "CANCELLED");
      }
      if (terminalStatus === "completed" || state.status === "complete") {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const resultResponse = await apiFetch(job.resultUrl, { cache: "no-store" });
          if (resultResponse.ok) return (await resultResponse.json()) as ProcessResult;
          await delay(150 * (attempt + 1));
        }
        throw new MediaProcessingError(
          "処理は完了しましたが、結果を取得できませんでした。もう一度お試しください。",
          false,
          "RESULT_NOT_READY",
        );
      }
    } catch (error) {
      if (error instanceof MediaProcessingError) throw error;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 20) {
        throw new MediaProcessingError(
          "処理状況を確認できません。通信を確認してもう一度お試しください。",
          false,
          "JOB_STATUS_UNAVAILABLE",
        );
      }
    }
    await delay(JOB_POLL_INTERVAL_MS);
  }
  throw new MediaProcessingError(
    "処理に時間がかかりすぎています。設定画面へ戻ってもう一度お試しください。",
    false,
    "PROCESSING_TIMEOUT",
  );
}

export async function processInspectedMedia(
  input: ProcessInspectedMediaInput,
  apiFetch: ApiFetch = fetch,
): Promise<ProcessResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JOB_CREATION_TIMEOUT_MS);
  let response: Response;
  try {
    response = await apiFetch("/api/media/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: input.uploadId,
        options: input.options,
        optimizationMode: input.optimizationMode,
        streamSelection: input.streamSelection,
        qualitySearch: input.qualitySearch,
        targetSizeOptions: input.targetSizeOptions,
        retentionMinutes: input.retentionMinutes,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MediaProcessingError(
        "処理の準備に時間がかかっています。もう一度お試しください。",
        false,
        "JOB_CREATION_TIMEOUT",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const payload = (await response.json()) as { error?: string; code?: string };
    throw processingError(payload, "メディアを処理できませんでした。");
  }
  const accepted = (await response.json()) as unknown;
  if (response.status !== 202 || !isAcceptedProcessingJob(accepted)) {
    throw new MediaProcessingError(
      "処理ジョブを作成できませんでした。もう一度お試しください。",
      false,
      "INVALID_JOB_RESPONSE",
    );
  }
  input.onReady?.();
  return waitForProcessingResult(accepted, input, apiFetch);
}

export interface ProcessImageInput {
  file: File;
  jobId: string;
  processingMode: ProcessingMode;
  outputFormat: ImageOutputFormat;
  encoding: ImageEncoding;
  quality: number;
  jpegBackgroundColor: string;
  enhancements: ImageEnhancementOptions;
  ai: ImageAiOptions;
  losslessOptions: LosslessImageOptions;
  targetSizeOptions: TargetSizeOptions;
  retentionMinutes: number;
  speedPreset: ProcessingSpeedPreset;
}

export async function processImage(
  input: ProcessImageInput,
  apiFetch: ApiFetch = fetch,
): Promise<ProcessResult> {
  const body = new FormData();
  body.append("file", input.file);
  body.append("jobId", input.jobId);
  body.append(
    "operation",
    input.processingMode === "metadata-only" ? "metadata-only" : "convert",
  );
  body.append("processingMode", input.processingMode);
  body.append("outputFormat", input.outputFormat);
  body.append("encoding", input.encoding);
  body.append("quality", String(input.quality));
  body.append("jpegBackgroundColor", input.jpegBackgroundColor);
  body.append("enhancements", JSON.stringify(input.enhancements));
  body.append("ai", JSON.stringify(input.ai));
  body.append("losslessOptions", JSON.stringify(input.losslessOptions));
  body.append("targetSizeOptions", JSON.stringify(input.targetSizeOptions));
  body.append("retentionMinutes", String(input.retentionMinutes));
  body.append("speedPreset", input.speedPreset);
  const response = await apiFetch("/api/process", { method: "POST", body });
  const payload = (await response.json()) as
    ProcessResult | { error?: string; code?: string };
  if (!response.ok) {
    throw new MediaProcessingError(
      "error" in payload && payload.error
        ? payload.error
        : "ファイルを処理できませんでした。",
      false,
      "code" in payload ? payload.code : undefined,
    );
  }
  return payload as ProcessResult;
}

export async function estimateTargetSample(
  input: {
    uploadId: string;
    targetSizeOptions: TargetSizeOptions;
    codec: VideoCompressionOptions["codec"];
    signal?: AbortSignal;
  },
  apiFetch: ApiFetch = fetch,
) {
  const response = await apiFetch("/api/media/target-estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: input.signal,
  });
  const payload = (await response.json()) as
    { estimate: TargetSizeEstimate; sampledSections: number } | { error?: string };
  if (!response.ok || !("estimate" in payload)) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : "サンプル推定を実行できませんでした。",
    );
  }
  return payload;
}
