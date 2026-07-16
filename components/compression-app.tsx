"use client";

import {
  AlertTriangle,
  ArrowDown,
  Check,
  Download,
  FileAudio,
  Film,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdvancedOptimizationPanel } from "@/components/advanced-optimization-panel";
import { useWorkspace } from "@/components/app/workspace-provider";
import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { ImageComparison } from "@/components/image-comparison";
import { ImageEnhancementPanel } from "@/components/image-enhancement-panel";
import { OptimizationReportCard } from "@/components/optimization-report-card";
import {
  OutputFileNamePreview,
  OutputFormatSelector,
  OutputFormatWarning,
  availableVideoCodecs,
} from "@/components/output-format";
import { ProcessingModeSelector } from "@/components/processing-mode-selector";
import { ProcessingSpeedSelector } from "@/components/processing-speed-selector";
import {
  CancelProcessingDialog,
  CompressionSummary,
  ErrorCard,
  FileProgressCard,
  OverallProgressCard,
  ProcessingDetails,
  ProcessingLog,
  ProcessingStepList,
} from "@/components/progress";
import { RealEsrganPanel } from "@/components/real-esrgan-panel";
import { TargetSizePanel } from "@/components/target-size/TargetSizePanel";
import { TargetSizeResultCard } from "@/components/target-size/TargetSizeResultCard";
import { VideoSettingsPanel } from "@/components/video-settings-panel";
import { scheduleInspection } from "@/features/upload/inspection-queue";
import {
  cancelProcessingJob,
  deleteInspectedUpload,
  estimateTargetSample,
  fetchRuntimeCapabilities,
  inspectMediaFile,
  MediaProcessingError,
  processImage,
  processInspectedMedia,
} from "@/features/upload/media-client";
import { forgetActiveJob, storeActiveJob } from "@/features/workspace/active-jobs";
import {
  MAX_FILES,
  OUTPUT_FORMATS as outputFormats,
  VIDEO_LIMIT,
} from "@/features/workspace/constants";
import { estimateWorkspaceOutput } from "@/features/workspace/estimates";
import {
  formatBytes,
  formatMediaBitrate,
  reductionCopy,
} from "@/features/workspace/formatters";
import {
  applyProgressToItem,
  buildCurrentProgressEvent,
  buildProcessingDetails,
  processingStatusFromItem,
  toFileProgressItem,
} from "@/features/workspace/progress";
import { useActiveJobRecovery } from "@/features/workspace/use-active-job-recovery";
import { useJobProgress } from "@/features/workspace/use-job-progress";
import { validateProcessingSettings } from "@/features/workspace/validate-processing-settings";
import {
  DEFAULT_AUDIO_PROCESSING_OPTIONS,
  type AudioProcessingOptions,
} from "@/lib/media/audio-types";
import {
  DEFAULT_IMAGE_AI_OPTIONS,
  DEFAULT_IMAGE_ENHANCEMENTS,
  DEFAULT_IMAGE_OUTPUT_SETTINGS,
  type ImageAiOptions,
  type ImageEncoding,
  type ImageEnhancementOptions,
  type ImageOutputFormat,
  type ProcessingMode,
  isStrictLosslessProcessingMode,
} from "@/lib/media/image-types";
import {
  DEFAULT_VIDEO_COMPRESSION_OPTIONS,
  selectedVideoHeight,
  type VideoCompressionOptions,
} from "@/lib/media/video-types";
import {
  DEFAULT_LOSSLESS_IMAGE_OPTIONS,
  DEFAULT_VIDEO_QUALITY_SEARCH,
  DEFAULT_VIDEO_STREAM_SELECTION,
  isAdvancedOptimizationMode,
  type LosslessImageOptions,
  type VideoQualitySearchOptions,
  type VideoStreamSelectionOptions,
} from "@/lib/optimization/types";
import { calculateOverallProgress } from "@/lib/progress/aggregate";
import { DEFAULT_TARGET_SIZE_OPTIONS } from "@/lib/target-size/config";
import { isOutputFormatForCategory } from "@/shared/media/output-formats";

import type { ProcessResult, QueueItem } from "@/features/workspace/types";
import type { RuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import type { ProcessingSpeedPreset } from "@/lib/processing/types";
import type { ProgressEvent } from "@/lib/progress/types";
import type { TargetSizeEstimate, TargetSizeOptions } from "@/lib/target-size/types";
import type { OutputFormatValue } from "@/shared/media/output-formats";

const timestampNow = Date.now;

export interface CompressionAppProps {
  initialFiles?: File[];
  embedded?: boolean;
  initialMode?: ProcessingMode;
  initialPreset?: "quality" | "balanced" | "small";
}

export function CompressionApp({
  initialFiles = [],
  embedded = false,
  initialMode = "high-quality-optimization",
  initialPreset = "balanced",
}: CompressionAppProps = {}) {
  const router = useRouter();
  const { preferences, addHistory, showToast } = useWorkspace();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [outputFormat, setOutputFormat] = useState<ImageOutputFormat>(
    DEFAULT_IMAGE_OUTPUT_SETTINGS.format,
  );
  const [encoding, setEncoding] = useState<ImageEncoding>(
    DEFAULT_IMAGE_OUTPUT_SETTINGS.encoding,
  );
  const [quality, setQuality] = useState(
    initialPreset === "quality" ? 94 : initialPreset === "small" ? 68 : 82,
  );
  const [jpegBackgroundColor, setJpegBackgroundColor] = useState(
    DEFAULT_IMAGE_OUTPUT_SETTINGS.jpegBackgroundColor ?? "#ffffff",
  );
  const [processingMode, setProcessingMode] = useState<ProcessingMode>(initialMode);
  const [speedPreset, setSpeedPreset] = useState<ProcessingSpeedPreset>("balanced");
  const [imageEnhancements, setImageEnhancements] = useState<ImageEnhancementOptions>(
    DEFAULT_IMAGE_ENHANCEMENTS,
  );
  const [imageAi, setImageAi] = useState<ImageAiOptions>(DEFAULT_IMAGE_AI_OPTIONS);
  const [videoOptions, setVideoOptions] = useState<VideoCompressionOptions>({
    ...DEFAULT_VIDEO_COMPRESSION_OPTIONS,
    mode:
      initialMode === "metadata-only" || isStrictLosslessProcessingMode(initialMode)
        ? "copy"
        : "compress",
    quality:
      initialPreset === "quality"
        ? "high"
        : initialPreset === "small"
          ? "small"
          : "balanced",
  });
  const [audioOptions, setAudioOptions] = useState<AudioProcessingOptions>({
    ...DEFAULT_AUDIO_PROCESSING_OPTIONS,
    processingMode: initialMode,
    quality:
      initialPreset === "quality"
        ? "high"
        : initialPreset === "small"
          ? "small"
          : "balanced",
  });
  const [losslessImageOptions, setLosslessImageOptions] = useState<LosslessImageOptions>(
    DEFAULT_LOSSLESS_IMAGE_OPTIONS,
  );
  const [videoStreamSelection, setVideoStreamSelection] =
    useState<VideoStreamSelectionOptions>(DEFAULT_VIDEO_STREAM_SELECTION);
  const [videoQualitySearch, setVideoQualitySearch] = useState<VideoQualitySearchOptions>(
    DEFAULT_VIDEO_QUALITY_SEARCH,
  );
  const [targetSizeOptions, setTargetSizeOptions] = useState<TargetSizeOptions>({
    ...DEFAULT_TARGET_SIZE_OPTIONS,
    enabled: initialMode === "target-size",
  });
  const [sampleTargetEstimate, setSampleTargetEstimate] =
    useState<TargetSizeEstimate | null>(null);
  const [sampleEstimating, setSampleEstimating] = useState(false);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => timestampNow());
  const objectUrls = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const importedInitialFiles = useRef(false);
  const processStartLock = useRef(false);
  const sampleEstimateController = useRef<AbortController | null>(null);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchRuntimeCapabilities()
      .then((payload) => {
        if (!active) return;
        setCapabilities(payload);
        setOutputFormat((current) =>
          payload.outputs.image.includes(current)
            ? current
            : ((payload.outputs.image[0] as ImageOutputFormat | undefined) ?? current),
        );
        setAudioOptions((current) =>
          payload.outputs.audio.includes(current.outputFormat)
            ? current
            : {
                ...current,
                outputFormat:
                  (payload.outputs.audio[0] as
                    AudioProcessingOptions["outputFormat"] | undefined) ??
                  current.outputFormat,
              },
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setCapabilityError(
            error instanceof Error
              ? error.message
              : "実行環境の対応形式を取得できませんでした。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const updateItem = useCallback((id: string, update: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }, []);

  const applyProgressEvent = useCallback((itemId: string, event: ProgressEvent) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId ? applyProgressToItem(item, event) : item,
      ),
    );
  }, []);

  const { connectJobProgress, stopJobProgress } = useJobProgress(applyProgressEvent);

  const recoverItem = useCallback((recoveredItem: QueueItem) => {
    setItems((current) =>
      current.some((item) => item.id === recoveredItem.id)
        ? current
        : [...current, recoveredItem],
    );
  }, []);

  useActiveJobRecovery({ onRecover: recoverItem, connectJobProgress });

  useEffect(() => {
    if (!items.some((item) => item.status === "processing")) return;
    const timer = window.setInterval(() => setClock(timestampNow()), 1_000);
    return () => window.clearInterval(timer);
  }, [items]);

  const inspectMedia = useCallback(
    async (file: File, id: string) => {
      updateItem(id, {
        status: "queued",
        inspectionStatus: "uploading",
        inspectionError: undefined,
        error: undefined,
        uploadId: undefined,
        videoInfo: undefined,
        audioInfo: undefined,
        probeInfo: undefined,
        progress: 0,
        progressStage: "ファイル形式を解析中",
      });
      try {
        const inspected = await scheduleInspection(file, () => inspectMediaFile(file));
        updateItem(id, {
          kind: inspected.kind,
          inspectionStatus: "ready",
          uploadId: inspected.uploadId,
          videoInfo: inspected.videoInfo,
          audioInfo: inspected.audioInfo,
          probeInfo: inspected.probeInfo,
          detectedFormat: inspected.detectedFormat,
          recommendations: inspected.recommendations,
          hasTransparency: inspected.hasTransparency,
          originalPreview: inspected.originalPreview,
          progressStage: undefined,
        });
      } catch (error) {
        updateItem(id, {
          status: "error",
          inspectionStatus: "error",
          inspectionError:
            error instanceof Error
              ? error.message
              : "ファイル形式を解析できませんでした。",
        });
      }
    },
    [updateItem],
  );

  const addFiles = useCallback(
    (incoming: File[]) => {
      setNotice(null);
      setItems((current) => {
        const remaining = MAX_FILES - current.length;
        if (remaining <= 0) {
          setNotice(`一度に追加できるのは${MAX_FILES}ファイルまでです。`);
          return current;
        }

        const accepted: QueueItem[] = [];
        const messages: string[] = [];

        incoming.slice(0, remaining).forEach((file) => {
          if (file.size > VIDEO_LIMIT) {
            messages.push(`${file.name}: 250MBを超えています`);
            return;
          }

          const id = crypto.randomUUID();
          accepted.push({
            id,
            file,
            originalSize: file.size,
            kind: "unknown",
            originalPreview: null,
            hasTransparency: null,
            inspectionStatus: "uploading",
            progress: 0,
            progressStage: "ファイル形式を解析中",
            status: "queued",
          });
          void inspectMedia(file, id);
        });

        if (incoming.length > remaining) {
          messages.push(
            `上限を超えた${incoming.length - remaining}ファイルは追加されませんでした`,
          );
        }
        if (messages.length) setNotice(messages.join(" / "));
        return [...current, ...accepted];
      });
    },
    [inspectMedia],
  );

  useEffect(() => {
    if (importedInitialFiles.current || initialFiles.length === 0) return;
    importedInitialFiles.current = true;
    addFiles(initialFiles);
  }, [addFiles, initialFiles]);

  const removeItem = (id: string) => {
    const stagedUploadId = items.find((item) => item.id === id)?.uploadId;
    if (stagedUploadId) {
      void deleteInspectedUpload(stagedUploadId).catch(() => undefined);
    }
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.originalPreview) {
        URL.revokeObjectURL(target.originalPreview);
        objectUrls.current.delete(target.originalPreview);
      }
      return current.filter((item) => item.id !== id);
    });
    setSelectedItemIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const cancelItem = async (item: QueueItem) => {
    const jobId = item.activeJobId ?? item.uploadId;
    if (!jobId) return;
    updateItem(item.id, { progressStage: "キャンセルを要求しています…" });
    const response = await cancelProcessingJob(jobId).catch(() => null);
    if (response?.ok) {
      updateItem(item.id, {
        status: "cancelled",
        progressStage: "キャンセル済み",
        finishedAt: timestampNow(),
      });
      forgetActiveJob(jobId);
      stopJobProgress(jobId);
    }
    setCancelTargetId(null);
  };

  const clearAll = () => {
    items.forEach((item) => {
      if (item.originalPreview) {
        URL.revokeObjectURL(item.originalPreview);
        objectUrls.current.delete(item.originalPreview);
      }
      if (item.uploadId) {
        void deleteInspectedUpload(item.uploadId).catch(() => undefined);
      }
    });
    setItems([]);
    setSelectedItemIds(new Set());
    setNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const processMediaItem = async (item: QueueItem, navigateOnReady = false) => {
    if (!item.uploadId) {
      throw new MediaProcessingError(
        "メディア解析が完了していません。再解析してください。",
        true,
      );
    }

    const itemAudioOptions =
      item.kind === "audio" &&
      item.outputFormat &&
      isOutputFormatForCategory(item.outputFormat, "audio")
        ? { ...audioOptions, outputFormat: item.outputFormat }
        : audioOptions;
    const itemVideoOptions =
      item.kind === "video" &&
      item.outputFormat &&
      isOutputFormatForCategory(item.outputFormat, "video")
        ? { ...videoOptions, outputContainer: item.outputFormat }
        : videoOptions;

    return processInspectedMedia({
      uploadId: item.uploadId,
      kind: item.kind === "audio" ? "audio" : "video",
      options:
        item.kind === "audio"
          ? { ...itemAudioOptions, speedPreset }
          : { ...itemVideoOptions, speedPreset },
      optimizationMode: isAdvancedOptimizationMode(processingMode)
        ? processingMode
        : undefined,
      streamSelection: videoStreamSelection,
      qualitySearch: videoQualitySearch,
      targetSizeOptions: { ...targetSizeOptions, speedPreset },
      retentionMinutes: preferences.retentionMinutes,
      onReady: () => {
        connectJobProgress(item.id, item.uploadId!);
        if (navigateOnReady) router.push(`/processing/${item.uploadId}`);
      },
      onProgressEvent: (event) => applyProgressEvent(item.id, event),
      onProgressFallback: (progress, stage) =>
        updateItem(item.id, { progress, progressStage: stage }),
    });
  };

  const processAll = async (onlyItemId?: string) => {
    if (processStartLock.current) return;
    processStartLock.current = true;
    const targets = items.filter(
      (item) =>
        (!onlyItemId || item.id === onlyItemId) &&
        !item.recovered &&
        (item.status === "queued" ||
          item.status === "error" ||
          item.status === "cancelled"),
    );
    setNotice(null);

    const validationStartedAt = timestampNow();
    setIsValidating(true);
    let validation;
    try {
      validation = validateProcessingSettings({
        items: targets,
        processingMode,
        outputFormat,
        encoding,
        quality,
        videoOptions: { ...videoOptions, speedPreset },
        audioOptions: { ...audioOptions, speedPreset },
        targetSizeOptions: { ...targetSizeOptions, speedPreset },
        jpegBackgroundColor,
      });
    } finally {
      setIsValidating(false);
    }
    const validationElapsedMs = Math.max(0, timestampNow() - validationStartedAt);
    if (!validation.isValid) {
      setNotice(validation.errors.join(" / "));
      processStartLock.current = false;
      return;
    }

    try {
      for (const item of targets) {
        const activeJobId = item.kind === "image" ? item.id : item.uploadId;
        const startedAt = timestampNow();
        updateItem(item.id, {
          status: "processing",
          error: undefined,
          errorCode: undefined,
          result: undefined,
          progress: 0,
          progressStage: "処理開始をサーバーへ要求中",
          progressEvent: undefined,
          activeJobId,
          startedAt,
          finishedAt: undefined,
          logs: [
            {
              id: `${item.id}:${startedAt}`,
              message: "処理を開始しました。",
              level: "info",
              timestamp: startedAt,
            },
            ...(process.env.NODE_ENV === "development"
              ? [
                  {
                    id: `${item.id}:${startedAt}:validation`,
                    message: `設定検証: ${validationElapsedMs}ms`,
                    level: "info" as const,
                    timestamp: startedAt,
                  },
                ]
              : []),
          ],
        });
        if (activeJobId && item.kind !== "unknown") {
          storeActiveJob({
            itemId: item.id,
            jobId: activeJobId,
            fileName: item.file.name,
            kind: item.kind,
            originalSize: item.originalSize ?? item.file.size,
            detectedFormat: item.detectedFormat,
            startedAt,
          });
        }

        try {
          let result: ProcessResult;
          if (item.kind === "video" || item.kind === "audio") {
            result = await processMediaItem(item, targets.length === 1);
          } else if (item.kind === "image") {
            const itemOutputFormat =
              item.outputFormat && isOutputFormatForCategory(item.outputFormat, "image")
                ? item.outputFormat
                : outputFormat;
            connectJobProgress(item.id, item.id);
            result = await processImage({
              file: item.file,
              jobId: item.id,
              processingMode,
              outputFormat: itemOutputFormat,
              encoding,
              quality,
              jpegBackgroundColor,
              enhancements: imageEnhancements,
              ai: imageAi,
              losslessOptions: losslessImageOptions,
              targetSizeOptions,
              retentionMinutes: preferences.retentionMinutes,
              speedPreset,
            });
          } else {
            throw new Error("ファイル形式の解析が完了していません。");
          }
          updateItem(item.id, {
            status: "complete",
            result,
            progress: 100,
            progressStage: "処理が完了しました",
            finishedAt: timestampNow(),
          });
          addHistory({
            jobId: result.jobId,
            kind: result.kind,
            originalName: result.originalName,
            outputName: result.outputName,
            originalSize: result.originalSize,
            outputSize: result.outputSize,
            reductionPercent: result.reductionPercent,
            outputFormat: result.outputFormat,
            downloadUrl: result.downloadUrl,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(
              timestampNow() + result.expiresInMinutes * 60_000,
            ).toISOString(),
          });
          showToast(`${result.outputName} の最適化が完了しました。`, "success");
          if (activeJobId) {
            forgetActiveJob(activeJobId);
            stopJobProgress(activeJobId);
          }
        } catch (error) {
          const requiresReupload =
            error instanceof MediaProcessingError && error.requiresReupload;
          const errorCode =
            error instanceof MediaProcessingError ? error.code : undefined;
          const cancelled = errorCode === "CANCELLED";
          updateItem(item.id, {
            status: cancelled ? "cancelled" : "error",
            inspectionStatus:
              (item.kind === "video" || item.kind === "audio") && requiresReupload
                ? "error"
                : item.inspectionStatus,
            inspectionError:
              (item.kind === "video" || item.kind === "audio") && requiresReupload
                ? "ファイルを再解析してから、もう一度お試しください。"
                : item.inspectionError,
            uploadId:
              (item.kind === "video" || item.kind === "audio") && requiresReupload
                ? undefined
                : item.uploadId,
            error:
              error instanceof Error ? error.message : "通信中にエラーが発生しました。",
            errorCode,
            progressStage: cancelled ? "キャンセル済み" : "処理に失敗しました",
            finishedAt: timestampNow(),
          });
          if (activeJobId) {
            forgetActiveJob(activeJobId);
            stopJobProgress(activeJobId);
          }
        }
      }
    } finally {
      processStartLock.current = false;
    }
  };

  const applyRecommendation = (recommendationId: string) => {
    if (recommendationId === "image-alpha-lossless") {
      setOutputFormat(capabilities?.outputs.image.includes("webp") ? "webp" : "png");
      setEncoding("lossless");
      changeProcessingMode("reduce-size");
    } else if (recommendationId === "image-animation") {
      setOutputFormat(capabilities?.outputs.image.includes("gif") ? "gif" : "webp");
      setEncoding(capabilities?.outputs.image.includes("gif") ? "lossy" : "lossless");
      changeProcessingMode("convert-only");
    } else if (recommendationId === "image-ai-2x") {
      changeProcessingMode("improve-quality");
      if (capabilities?.ai.realEsrgan) {
        setImageAi((current) => ({ ...current, enabled: true, scale: 2 }));
      }
    } else if (recommendationId === "video-1080p") {
      changeProcessingMode("reduce-size");
      setVideoOptions((current) => ({
        ...current,
        mode: "compress",
        resolution: "1080",
        customHeight: null,
      }));
    } else if (recommendationId === "video-compatible") {
      changeProcessingMode("reduce-size");
      setVideoOptions((current) => ({
        ...current,
        mode: "compress",
        outputContainer: "mp4",
        codec: "h264",
        audio: "aac128",
      }));
    } else if (recommendationId === "video-small") {
      changeProcessingMode("reduce-size");
      setVideoOptions((current) => ({
        ...current,
        mode: "compress",
        outputContainer: "mp4",
        codec: capabilities?.ffmpeg.encoders.includes("libx265") ? "h265" : "h264",
        quality: "small",
      }));
    } else if (recommendationId === "audio-compatible") {
      changeProcessingMode("reduce-size");
      setAudioOptions((current) => ({ ...current, outputFormat: "mp3" }));
    } else if (recommendationId === "audio-small") {
      changeProcessingMode("reduce-size");
      setAudioOptions((current) => ({
        ...current,
        outputFormat: capabilities?.outputs.audio.includes("opus") ? "opus" : "mp3",
        quality: "small",
      }));
    }
    setNotice("おすすめ設定を反映しました。内容を確認してから処理を実行してください。");
  };

  const isProcessing = items.some((item) => item.status === "processing");
  useEffect(() => {
    if (!isProcessing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isProcessing]);
  const isInspecting = items.some((item) => item.inspectionStatus === "uploading");
  const hasInspectionErrors = items.some((item) => item.inspectionStatus === "error");
  const pendingCount = items.filter(
    (item) =>
      item.status === "queued" || item.status === "error" || item.status === "cancelled",
  ).length;
  const completedItems = items.filter(
    (item): item is QueueItem & { result: ProcessResult } =>
      item.status === "complete" && Boolean(item.result),
  );
  const hasImages = items.some((item) => item.kind === "image");
  const hasVideos = items.some((item) => item.kind === "video");
  const hasAudio = items.some((item) => item.kind === "audio");
  const videoInfos = items.flatMap((item) =>
    item.kind === "video" && item.videoInfo ? [item.videoInfo] : [],
  );
  const advancedMode = isAdvancedOptimizationMode(processingMode)
    ? processingMode
    : "high-quality-optimization";
  const videoDeletionPreview: string[] = [];
  const videoProbeInfos = items.flatMap((item) =>
    item.kind === "video" && item.probeInfo ? [item.probeInfo] : [],
  );
  const additionalAudioCount = videoProbeInfos.reduce(
    (sum, info) =>
      sum +
      Math.max(0, info.streams.filter((stream) => stream.type === "audio").length - 1),
    0,
  );
  const subtitleCount = videoProbeInfos.reduce(
    (sum, info) =>
      sum + info.streams.filter((stream) => stream.type === "subtitle").length,
    0,
  );
  const attachmentCount = videoProbeInfos.reduce(
    (sum, info) =>
      sum +
      info.streams.filter(
        (stream) => stream.type === "attachment" || stream.isAttachedPicture,
      ).length,
    0,
  );
  const chapterCount = videoProbeInfos.reduce((sum, info) => sum + info.chapterCount, 0);
  if (videoStreamSelection.keepPrimaryAudioOnly && additionalAudioCount > 0) {
    videoDeletionPreview.push(`追加音声 ${additionalAudioCount}本`);
  }
  if (videoStreamSelection.removeSubtitles && subtitleCount > 0) {
    videoDeletionPreview.push(`字幕 ${subtitleCount}本`);
  }
  if (videoStreamSelection.removeAttachments && attachmentCount > 0) {
    videoDeletionPreview.push(`添付画像・ファイル ${attachmentCount}件`);
  }
  if (videoStreamSelection.removeChapters && chapterCount > 0) {
    videoDeletionPreview.push(`チャプター ${chapterCount}件`);
  }
  if (videoStreamSelection.stripPrivacyMetadata) {
    videoDeletionPreview.push("コメント・位置情報などのプライバシーメタデータ");
  }
  const audioInfos = items.flatMap((item) =>
    item.kind === "audio" && item.audioInfo ? [item.audioInfo] : [],
  );
  const selectedHeight = selectedVideoHeight(videoOptions);
  const videoSettingsInvalid =
    hasVideos &&
    videoOptions.mode === "compress" &&
    videoOptions.resolution === "custom" &&
    (selectedHeight === null ||
      selectedHeight < 144 ||
      selectedHeight > 4320 ||
      selectedHeight % 2 !== 0);
  const videoCombinationInvalid =
    hasVideos &&
    videoOptions.mode === "compress" &&
    videoOptions.outputContainer === "webm" &&
    videoOptions.codec !== "vp9" &&
    videoOptions.codec !== "av1";
  const audioSettingsInvalid =
    hasAudio &&
    isStrictLosslessProcessingMode(audioOptions.processingMode) &&
    audioOptions.outputFormat !== "flac" &&
    audioOptions.outputFormat !== "wav";
  const { totalInputSize, targetSizeEstimate, estimatedOutputSize, estimatedSavedSize } =
    estimateWorkspaceOutput({
      items,
      processingMode,
      outputFormat,
      quality,
      videoOptions,
      audioOptions,
      targetSizeOptions,
    });
  const targetSizeInvalid =
    processingMode === "target-size" &&
    (!targetSizeOptions.enabled || targetSizeEstimate === null);
  const startDisabledReason =
    pendingCount === 0
      ? "処理するファイルを追加してください。"
      : isInspecting
        ? "ファイルの安全性と実形式を確認しています。"
        : hasInspectionErrors
          ? "エラーになったファイルを再解析または削除してください。"
          : videoSettingsInvalid ||
              videoCombinationInvalid ||
              audioSettingsInvalid ||
              targetSizeInvalid
            ? "選択した出力設定の組み合わせを確認してください。"
            : null;
  const qualityEnhancementMode =
    processingMode === "improve-quality" ||
    processingMode === "improve-and-reduce" ||
    processingMode === "high-quality-optimization";
  const selectedFormat = outputFormats.find((format) => format.id === outputFormat)!;
  const selectedItems = items.filter((item) => selectedItemIds.has(item.id));
  const bulkCategory =
    selectedItems.length > 0 &&
    selectedItems[0].kind !== "unknown" &&
    selectedItems.every((item) => item.kind === selectedItems[0].kind)
      ? selectedItems[0].kind
      : null;

  function resolvedOutputFormat(item: QueueItem) {
    if (item.outputFormat) return item.outputFormat;
    if (item.kind === "image") return outputFormat;
    if (item.kind === "video") {
      return videoOptions.outputContainer && videoOptions.outputContainer !== "source"
        ? videoOptions.outputContainer
        : isOutputFormatForCategory(item.detectedFormat, "video")
          ? item.detectedFormat
          : (capabilities?.outputs.video[0] ?? "mp4");
    }
    if (item.kind === "audio") return audioOptions.outputFormat;
    return "";
  }

  function applyOutputFormatToItems(ids: ReadonlySet<string>, value: OutputFormatValue) {
    const targets = items.filter((item) => ids.has(item.id));
    if (
      targets.length === 0 ||
      targets.some(
        (item) => item.kind === "unknown" || !isOutputFormatForCategory(value, item.kind),
      )
    ) {
      setNotice("異なるメディア種別へ同じ出力形式を一括適用することはできません。");
      return;
    }
    if (targets[0].kind === "video") {
      const codecs = availableVideoCodecs(
        value as VideoCompressionOptions["outputContainer"],
        capabilities,
      );
      if (!codecs.includes(videoOptions.codec)) {
        setVideoOptions((current) => ({ ...current, codec: codecs[0] ?? "h264" }));
        setNotice("出力コンテナとの互換性を保つため映像コーデックを変更しました。");
      }
    }
    setItems((current) =>
      current.map((item) => (ids.has(item.id) ? { ...item, outputFormat: value } : item)),
    );
  }
  const availableImageFormats = outputFormats.filter((format) =>
    capabilities?.outputs.image.includes(format.id),
  );
  const isLosslessOutput =
    outputFormat === "png" ||
    outputFormat === "tiff" ||
    ((outputFormat === "webp" || outputFormat === "avif") && encoding === "lossless");
  const showQuality =
    !isStrictLosslessProcessingMode(processingMode) &&
    (outputFormat === "jpeg" ||
      ((outputFormat === "webp" || outputFormat === "avif") && encoding === "lossy"));
  const warnsAboutTransparency =
    processingMode !== "metadata-only" &&
    items.some(
      (item) =>
        item.kind === "image" &&
        item.hasTransparency === true &&
        resolvedOutputFormat(item) === "jpeg",
    );
  const warnsAboutJpegToPng =
    processingMode !== "metadata-only" &&
    items.some(
      (item) =>
        item.kind === "image" &&
        ["jpeg", "webp", "avif"].includes(item.detectedFormat ?? "") &&
        resolvedOutputFormat(item) === "png",
    );
  const currentProcessingItem = items.find((item) => item.status === "processing");
  const overallProgress = calculateOverallProgress(
    items.map((item) => ({
      progress: item.status === "complete" ? 100 : (item.progress ?? 0),
      status: processingStatusFromItem(item),
      originalSize: item.result?.originalSize ?? item.originalSize ?? item.file.size,
      outputSize: item.result?.outputSize,
    })),
  );
  const currentProgressEvent = currentProcessingItem
    ? buildCurrentProgressEvent({
        item: currentProcessingItem,
        videoOptions,
        clock,
      })
    : null;
  const currentProcessingDetails =
    currentProcessingItem && currentProgressEvent
      ? buildProcessingDetails({
          item: currentProcessingItem,
          event: currentProgressEvent,
          videoOptions:
            currentProcessingItem.kind === "video" &&
            currentProcessingItem.outputFormat &&
            isOutputFormatForCategory(currentProcessingItem.outputFormat, "video")
              ? {
                  ...videoOptions,
                  outputContainer: currentProcessingItem.outputFormat,
                }
              : videoOptions,
          audioOptions:
            currentProcessingItem.kind === "audio" &&
            currentProcessingItem.outputFormat &&
            isOutputFormatForCategory(currentProcessingItem.outputFormat, "audio")
              ? { ...audioOptions, outputFormat: currentProcessingItem.outputFormat }
              : audioOptions,
          imageAi,
          outputFormat:
            currentProcessingItem.kind === "image" &&
            currentProcessingItem.outputFormat &&
            isOutputFormatForCategory(currentProcessingItem.outputFormat, "image")
              ? currentProcessingItem.outputFormat
              : outputFormat,
        })
      : null;
  const fileProgressItems = items.map(toFileProgressItem);
  const cancelTarget = cancelTargetId
    ? (items.find((item) => item.id === cancelTargetId) ?? null)
    : null;

  function changeProcessingMode(mode: ProcessingMode) {
    setProcessingMode(mode);
    setTargetSizeOptions((current) => ({
      ...current,
      enabled: mode === "target-size",
    }));
    setAudioOptions((current) => ({ ...current, processingMode: mode }));
    setVideoOptions((current) => {
      if (
        mode === "metadata-only" ||
        isStrictLosslessProcessingMode(mode) ||
        mode === "archive"
      ) {
        return {
          ...current,
          mode: "copy",
          resolution: "original",
          customHeight: null,
          audio: "copy",
          frameRate: "original",
          enhancements: DEFAULT_VIDEO_COMPRESSION_OPTIONS.enhancements,
          upscaleMode: "simple",
        };
      }
      if (mode === "convert-only") {
        return {
          ...current,
          mode: "copy",
          resolution: "original",
          customHeight: null,
          audio: "copy",
          frameRate: "original",
          enhancements: DEFAULT_VIDEO_COMPRESSION_OPTIONS.enhancements,
          upscaleMode: "simple",
        };
      }
      if (
        mode === "reduce-size" ||
        mode === "improve-quality" ||
        mode === "improve-and-reduce" ||
        mode === "high-quality-optimization" ||
        mode === "size-priority" ||
        mode === "target-size"
      ) {
        return { ...current, mode: "compress" };
      }
      return current;
    });
    if (isStrictLosslessProcessingMode(mode)) {
      setEncoding("lossless");
      setOutputFormat((current) =>
        current === "jpeg" || current === "gif" ? "webp" : current,
      );
      setImageAi((current) => ({ ...current, enabled: false }));
      setImageEnhancements({
        ...DEFAULT_IMAGE_ENHANCEMENTS,
        normalizeColorSpace: false,
      });
    } else if (mode === "convert-only" || mode === "metadata-only") {
      setImageAi((current) => ({
        ...current,
        enabled: false,
        faceCorrection: "off",
      }));
      setImageEnhancements({
        ...DEFAULT_IMAGE_ENHANCEMENTS,
        normalizeColorSpace: false,
      });
    }
  }

  async function runTargetSampleEstimate() {
    const item = items.find(
      (candidate) => candidate.kind === "video" && candidate.uploadId,
    );
    if (!item?.uploadId) {
      setNotice("サンプル推定を行う動画の解析が完了していません。");
      return;
    }
    setSampleEstimating(true);
    setNotice(null);
    const controller = new AbortController();
    sampleEstimateController.current?.abort();
    sampleEstimateController.current = controller;
    try {
      const payload = await estimateTargetSample({
        uploadId: item.uploadId,
        targetSizeOptions,
        codec: videoOptions.codec,
        signal: controller.signal,
      });
      setSampleTargetEstimate(payload.estimate);
      setNotice(
        `先頭・中間・終盤の${payload.sampledSections}区間から出力容量を推定しました。`,
      );
    } catch (error) {
      setNotice(
        controller.signal.aborted
          ? "詳細な容量予測をキャンセルしました。簡易予測のまま処理を開始できます。"
          : error instanceof Error
            ? error.message
            : "サンプル推定を実行できませんでした。",
      );
    } finally {
      if (sampleEstimateController.current === controller) {
        sampleEstimateController.current = null;
      }
      setSampleEstimating(false);
    }
  }

  function cancelTargetSampleEstimate() {
    sampleEstimateController.current?.abort();
  }

  return (
    <main className="min-h-screen overflow-hidden">
      {!embedded && (
        <>
          <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
              <a
                href="#top"
                className="group flex items-center gap-3"
                aria-label="Compression Files トップ"
              >
                <span className="brand-grid grid size-10 place-items-center rounded-xl bg-[#5865e8] text-sm font-black tracking-tight text-white shadow-[0_8px_22px_rgba(88,101,232,.25)] transition-transform group-hover:-rotate-3">
                  CF
                </span>
                <span className="text-[17px] font-bold tracking-[-0.03em] text-slate-900">
                  Compression Files
                </span>
              </a>
              <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 sm:flex">
                <LockKeyhole size={14} aria-hidden="true" />
                一時保存・30分で自動削除
              </div>
            </div>
          </header>

          <section id="top" className="relative border-b border-slate-200 bg-white">
            <div className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-indigo-100/60 blur-3xl" />
            <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-14 pt-14 sm:px-8 lg:grid-cols-[1fr_390px] lg:items-center lg:pb-16 lg:pt-20">
              <div className="relative">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700">
                  <Sparkles size={14} aria-hidden="true" />
                  画質を大切にするファイル最適化
                </div>
                <h1 className="max-w-3xl text-[clamp(2.35rem,6vw,4.65rem)] font-black leading-[1.05] tracking-[-0.065em] text-slate-950">
                  画質は、そのまま。
                  <br />
                  <span className="text-[#5865e8]">余計な重さ</span>だけ手放す。
                </h1>
                <p className="mt-6 max-w-2xl text-base font-medium leading-8 text-slate-600 sm:text-lg">
                  実行環境で読める画像・動画・音声を安全に解析し、形式変換、通常補正、AI高画質化、容量削減へ。
                  大切な見た目を比較しながら、共有しやすいファイルへ整えます。
                </p>
              </div>

              <div className="relative grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-3xl bg-[#172033] p-6 text-white shadow-[0_22px_50px_rgba(23,32,51,.16)]">
                  <div className="mb-7 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-300">処理エンジン</span>
                    <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                      <span className="size-1.5 rounded-full bg-emerald-400" /> READY
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-black tracking-[-0.04em]">
                        Sharp + FFmpeg
                      </p>
                      <p className="mt-2 text-xs font-medium text-slate-400">
                        画像も動画も、サーバー側で安全に処理
                      </p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <ScanSearch className="mb-4 text-[#5865e8]" size={23} />
                  <p className="text-2xl font-black tracking-tight">EXIF</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">GPS・XMPも検出</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <Film className="mb-4 text-[#ff8468]" size={23} />
                  <p className="text-2xl font-black tracking-tight">-c copy</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    動画を再エンコードしない
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}

      <section className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-[#5865e8]">
              Optimize workspace
            </p>
            <h2 className="text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
              ファイルを最適化
            </h2>
          </div>
          <p className="text-sm font-medium text-slate-500">
            最大10ファイルまで順番に処理します
          </p>
        </div>

        {currentProcessingItem && currentProgressEvent && (
          <div className="mb-8 space-y-4" aria-label="現在の処理状況">
            <OverallProgressCard
              event={currentProgressEvent}
              fileName={currentProcessingItem.file.name}
              completedFiles={overallProgress.completedFiles}
              totalFiles={overallProgress.totalFiles}
              savedBytes={overallProgress.savedBytes}
              onCancel={() => setCancelTargetId(currentProcessingItem.id)}
              preview={
                currentProcessingItem.kind === "image" &&
                currentProcessingItem.originalPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentProcessingItem.originalPreview}
                    alt={`${currentProcessingItem.file.name}の処理前プレビュー`}
                    className="h-full min-h-52 w-full object-contain"
                  />
                ) : currentProcessingItem.kind === "video" &&
                  currentProcessingItem.uploadId ? (
                  <div className="relative h-full min-h-52">
                    <video
                      src={`/api/media/preview/${currentProcessingItem.uploadId}`}
                      controls
                      muted
                      preload="metadata"
                      className="h-full min-h-52 w-full object-contain"
                    />
                    <span className="absolute bottom-3 left-3 rounded-lg bg-slate-950/80 px-3 py-1.5 text-[10px] font-black text-white">
                      処理前プレビュー ·{" "}
                      {currentProgressEvent.processedTime !== undefined
                        ? `${Math.floor(currentProgressEvent.processedTime / 60)}:${String(Math.floor(currentProgressEvent.processedTime % 60)).padStart(2, "0")}`
                        : "位置を取得中"}
                    </span>
                  </div>
                ) : (
                  <div className="grid min-h-52 place-items-center bg-slate-900 text-center text-white">
                    <div>
                      <FileAudio className="mx-auto text-sky-300" size={42} />
                      <p className="mt-3 text-sm font-black">音声を処理しています</p>
                    </div>
                  </div>
                )
              }
            />
            <div className="flex justify-end">
              <Link
                href={`/processing/${currentProgressEvent.jobId}`}
                className="inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-black text-[var(--text)]"
              >
                専用の進捗画面で見る
              </Link>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(280px,.72fr)_minmax(0,1.28fr)]">
              <ProcessingStepList
                steps={currentProgressEvent.steps}
                className="rounded-3xl border border-slate-200 bg-white p-5 soft-shadow sm:p-6"
              />
              <div className="space-y-4">
                {currentProcessingDetails && currentProcessingItem.kind !== "unknown" && (
                  <ProcessingDetails
                    kind={currentProcessingItem.kind}
                    data={currentProcessingDetails}
                  />
                )}
                <ProcessingLog entries={currentProcessingItem.logs ?? []} />
              </div>
            </div>
          </div>
        )}

        <div className="soft-shadow overflow-hidden rounded-[28px] border border-slate-200 bg-white">
          <div className="p-4 sm:p-7">
            {!embedded && (
              <label
                htmlFor="file-upload"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (event.currentTarget === event.target) setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className={`drop-sheen flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed px-5 py-10 text-center outline-none transition-all focus-within:ring-4 focus-within:ring-indigo-100 ${
                  dragActive
                    ? "scale-[.995] border-[#5865e8] bg-indigo-50"
                    : "border-slate-300 bg-slate-50/70 hover:border-indigo-400 hover:bg-indigo-50/30"
                }`}
              >
                <input
                  ref={inputRef}
                  id="file-upload"
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
                />
                <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-white text-[#5865e8] shadow-[0_12px_30px_rgba(49,57,95,.12)]">
                  <UploadCloud size={30} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="text-lg font-black tracking-tight text-slate-900 sm:text-xl">
                  ここに画像・動画・音声をドロップ
                </span>
                <span className="mt-2 text-sm font-medium text-slate-500">
                  またはクリックしてファイルを選択
                </span>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
                    Sharpが読める画像
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">
                    FFmpegが読める動画・音声
                  </span>
                </div>
                <span className="mt-3 text-[11px] font-medium text-slate-400">
                  画像25MB・音声100MB・動画250MBまで／実データを解析して判定
                </span>
              </label>
            )}

            {notice && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800"
              >
                <Info className="mt-0.5 shrink-0" size={16} />
                {notice}
              </div>
            )}

            {capabilityError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800"
              >
                <AlertTriangle className="mt-0.5 shrink-0" size={15} />
                対応形式を取得できません: {capabilityError}
              </div>
            )}
            {capabilities && !embedded && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2 text-[10px] font-black text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                    Sharp {capabilities.sharp.version} / libvips{" "}
                    {capabilities.sharp.libvipsVersion}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">
                    {capabilities.ffmpeg.version ?? "FFmpeg 利用不可"}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
                    実行環境から動的取得済み
                  </span>
                </div>
                <details className="mt-3 rounded-xl border border-slate-200 bg-white text-xs">
                  <summary className="cursor-pointer px-4 py-3 font-black text-slate-600">
                    このサーバーで実際に利用できる形式を見る
                  </summary>
                  <div className="grid gap-3 border-t border-slate-200 p-4 text-[10px] leading-5 text-slate-600 lg:grid-cols-2">
                    <div>
                      <p className="font-black text-slate-800">Sharp画像入力</p>
                      <p className="mt-1 break-words font-medium">
                        {capabilities.sharp.inputExtensions.join(" / ")}
                      </p>
                      <p className="mt-3 font-black text-slate-800">利用可能な出力</p>
                      <p className="mt-1 font-medium">
                        画像: {capabilities.outputs.image.join(" / ") || "なし"}
                      </p>
                      <p className="font-medium">
                        動画: {capabilities.outputs.video.join(" / ") || "なし"}
                      </p>
                      <p className="font-medium">
                        音声: {capabilities.outputs.audio.join(" / ") || "なし"}
                      </p>
                    </div>
                    <div>
                      <p className="font-black text-slate-800">
                        FFmpeg demuxer（入力コンテナ）
                      </p>
                      <p className="mt-1 max-h-32 overflow-auto break-words font-mono text-[9px]">
                        {capabilities.ffmpeg.demuxers.join(" / ") || "FFmpeg利用不可"}
                      </p>
                    </div>
                  </div>
                </details>
              </div>
            )}

            {items.length > 0 && (
              <div className="mt-7">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-black text-slate-900">
                    選択中のファイル{" "}
                    <span className="ml-1 text-[#5865e8]">{items.length}</span>
                  </p>
                  <button
                    type="button"
                    onClick={clearAll}
                    disabled={isProcessing}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} /> すべて削除
                  </button>
                </div>
                {selectedItems.length > 0 && (
                  <div className="mb-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3">
                    {bulkCategory ? (
                      <OutputFormatSelector
                        compact
                        mediaCategory={bulkCategory}
                        value={resolvedOutputFormat(selectedItems[0])}
                        availableFormats={capabilities?.outputs[bulkCategory]}
                        disabled={isProcessing}
                        label={`選択した${selectedItems.length}件へ一括適用`}
                        onChange={(value) =>
                          applyOutputFormatToItems(selectedItemIds, value)
                        }
                      />
                    ) : (
                      <p role="alert" className="text-[10px] font-bold text-amber-800">
                        画像・動画・音声が混在しているため、出力形式を一括適用できません。
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-2">
                  {fileProgressItems.map((progressItem) => {
                    const queueItem = items.find((item) => item.id === progressItem.id)!;
                    return (
                      <div key={progressItem.id} className="relative">
                        <FileProgressCard
                          item={progressItem}
                          onRetry={
                            queueItem.recovered
                              ? undefined
                              : (id) => {
                                  const target = items.find((item) => item.id === id);
                                  if (target?.inspectionStatus === "error") {
                                    void inspectMedia(target.file, target.id);
                                  } else {
                                    void processAll(id);
                                  }
                                }
                          }
                          onCancel={(id) => setCancelTargetId(id)}
                        />
                        {queueItem.inspectionStatus === "ready" &&
                          queueItem.kind !== "unknown" &&
                          queueItem.status !== "processing" && (
                            <div className="mt-1 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-end">
                              <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[10px] font-black text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={selectedItemIds.has(queueItem.id)}
                                  disabled={isProcessing}
                                  onChange={(event) =>
                                    setSelectedItemIds((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked) next.add(queueItem.id);
                                      else next.delete(queueItem.id);
                                      return next;
                                    })
                                  }
                                  className="size-4 accent-indigo-600"
                                />
                                一括設定に選択
                              </label>
                              <OutputFormatSelector
                                compact
                                mediaCategory={queueItem.kind}
                                value={resolvedOutputFormat(queueItem)}
                                availableFormats={capabilities?.outputs[queueItem.kind]}
                                disabled={isProcessing}
                                label="このファイルの出力形式"
                                onChange={(value) =>
                                  applyOutputFormatToItems(new Set([queueItem.id]), value)
                                }
                              />
                              <OutputFileNamePreview
                                originalFileName={queueItem.file.name}
                                outputFormat={resolvedOutputFormat(queueItem)}
                              />
                              <div className="sm:col-span-3">
                                <OutputFormatWarning
                                  transparencyToJpeg={
                                    queueItem.kind === "image" &&
                                    queueItem.hasTransparency === true &&
                                    resolvedOutputFormat(queueItem) === "jpeg"
                                  }
                                  photoToPng={
                                    queueItem.kind === "image" &&
                                    ["jpeg", "webp", "avif"].includes(
                                      queueItem.detectedFormat ?? "",
                                    ) &&
                                    resolvedOutputFormat(queueItem) === "png"
                                  }
                                />
                              </div>
                            </div>
                          )}
                        {queueItem.status === "queued" &&
                          queueItem.inspectionStatus !== "uploading" && (
                            <button
                              type="button"
                              onClick={() => removeItem(queueItem.id)}
                              aria-label={`${queueItem.file.name}を削除`}
                              className="absolute bottom-4 right-4 grid size-10 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            >
                              <X size={17} />
                            </button>
                          )}
                        {queueItem.recovered &&
                          queueItem.status === "complete" &&
                          queueItem.activeJobId && (
                            <a
                              href={`/api/files/${queueItem.activeJobId}`}
                              download
                              className="absolute bottom-4 right-4 rounded-lg bg-[#5865e8] px-3 py-2 text-xs font-black text-white"
                            >
                              ダウンロード
                            </a>
                          )}
                      </div>
                    );
                  })}
                </div>
                {items.some((item) => item.error || item.inspectionError) && (
                  <div aria-live="polite" className="mt-4 grid gap-3">
                    {items
                      .filter((item) => item.error || item.inspectionError)
                      .map((item) => (
                        <ErrorCard
                          key={item.id}
                          title={`${item.file.name}を処理できませんでした`}
                          message={
                            item.error ?? item.inspectionError ?? "処理に失敗しました。"
                          }
                          details={item.progressStage}
                          errorCode={item.errorCode}
                          onRetry={
                            item.recovered
                              ? undefined
                              : () =>
                                  item.inspectionStatus === "error"
                                    ? void inspectMedia(item.file, item.id)
                                    : void processAll(item.id)
                          }
                          onChangeSettings={() =>
                            document
                              .getElementById("processing-settings")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                          onDismiss={() =>
                            updateItem(item.id, {
                              error: undefined,
                              inspectionError: undefined,
                            })
                          }
                        />
                      ))}
                  </div>
                )}
                {items.some((item) => item.recommendations?.length) && (
                  <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex items-center gap-2 text-xs font-black text-violet-800">
                      <Sparkles size={15} /> 解析結果からのおすすめ
                    </div>
                    <p className="mt-1 text-[10px] font-medium text-violet-700">
                      自動適用はしません。「反映する」を押したあと、設定を確認してください。
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {items.flatMap((item) =>
                        (item.recommendations ?? []).map((recommendation) => (
                          <div
                            key={`${item.id}-${recommendation.id}`}
                            className="flex items-start justify-between gap-3 rounded-xl border border-violet-100 bg-white p-3"
                          >
                            <div>
                              <p className="text-[11px] font-black text-slate-800">
                                {recommendation.title}
                              </p>
                              <p className="mt-1 text-[9px] font-medium leading-4 text-slate-500">
                                {recommendation.description}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={
                                isProcessing ||
                                isInspecting ||
                                (recommendation.id === "image-ai-2x" &&
                                  !capabilities?.ai.realEsrgan)
                              }
                              onClick={() => applyRecommendation(recommendation.id)}
                              className="shrink-0 rounded-lg bg-violet-100 px-2.5 py-1.5 text-[9px] font-black text-violet-700 disabled:opacity-40"
                            >
                              反映する
                            </button>
                          </div>
                        )),
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            id="processing-settings"
            className="border-t border-slate-200 bg-slate-50/80 p-4 sm:p-7"
          >
            {items.length > 0 && (
              <div className="mb-7">
                <ProcessingModeSelector
                  value={processingMode}
                  disabled={isProcessing || isInspecting}
                  unavailableModes={
                    hasAudio
                      ? {
                          "improve-quality":
                            "音声ファイルとの一括処理では選択できません。",
                          "improve-and-reduce":
                            "音声ファイルとの一括処理では選択できません。",
                        }
                      : undefined
                  }
                  onChange={changeProcessingMode}
                />
                <ProcessingSpeedSelector
                  value={speedPreset}
                  onChange={setSpeedPreset}
                  disabled={isProcessing || isInspecting}
                />
                {isAdvancedOptimizationMode(processingMode) && (
                  <AdvancedOptimizationPanel
                    className="mt-4"
                    mode={advancedMode}
                    onModeChange={changeProcessingMode}
                    losslessImageOptions={losslessImageOptions}
                    onLosslessImageOptionsChange={(update) =>
                      setLosslessImageOptions((current) => ({ ...current, ...update }))
                    }
                    videoStreamSelection={videoStreamSelection}
                    onVideoStreamSelectionChange={(update) =>
                      setVideoStreamSelection((current) => ({ ...current, ...update }))
                    }
                    videoQualitySearch={videoQualitySearch}
                    onVideoQualitySearchChange={(update) =>
                      setVideoQualitySearch((current) => ({ ...current, ...update }))
                    }
                    mediaKinds={[
                      ...(hasImages ? (["image"] as const) : []),
                      ...(hasVideos ? (["video"] as const) : []),
                      ...(hasAudio ? (["audio"] as const) : []),
                    ]}
                    videoDeletionPreview={videoDeletionPreview}
                    disabled={isProcessing || isInspecting}
                  />
                )}
                {processingMode === "target-size" && (
                  <TargetSizePanel
                    className="mt-4"
                    options={targetSizeOptions}
                    onChange={(update) => {
                      setSampleTargetEstimate(null);
                      setTargetSizeOptions((current) => ({ ...current, ...update }));
                      if (update.enabled === false) changeProcessingMode("size-priority");
                    }}
                    originalBytes={totalInputSize}
                    mediaKinds={[
                      ...(hasImages ? (["image"] as const) : []),
                      ...(hasVideos ? (["video"] as const) : []),
                      ...(hasAudio ? (["audio"] as const) : []),
                    ]}
                    estimate={sampleTargetEstimate ?? targetSizeEstimate}
                    onRunSampleEstimate={() => void runTargetSampleEstimate()}
                    onCancelSampleEstimate={cancelTargetSampleEstimate}
                    onStartWithoutEstimate={() => {
                      cancelTargetSampleEstimate();
                      void processAll();
                    }}
                    sampleEstimating={sampleEstimating}
                    disabled={isProcessing || isInspecting}
                  />
                )}
              </div>
            )}
            {(hasImages || hasVideos || hasAudio) && (
              <details className="group rounded-2xl border border-slate-200 bg-white">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-black text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5865e8] sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span>
                    詳細設定
                    <span className="ml-2 text-[10px] font-bold text-slate-400">
                      形式・品質・解像度・補正
                    </span>
                  </span>
                  <span className="text-xs text-[#5865e8] group-open:hidden">開く</span>
                  <span className="hidden text-xs text-[#5865e8] group-open:inline">
                    閉じる
                  </span>
                </summary>
                <div className="border-t border-slate-200 p-4 sm:p-5">
                  {hasImages && (
                    <div className="space-y-7">
                      <div className="hidden">
                        <p className="mb-3 text-sm font-black text-slate-900">処理内容</p>
                        <div className="grid gap-2 rounded-2xl bg-slate-100 p-1 sm:grid-cols-2">
                          {(
                            [
                              {
                                id: "convert",
                                label: "形式変換 + メタデータ削除",
                                detail: "選んだ形式へ変換します",
                              },
                              {
                                id: "metadata-only",
                                label: "メタデータ削除のみ",
                                detail: "元の画像形式を維持します",
                              },
                            ] as const
                          ).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={
                                processingMode ===
                                (option.id === "metadata-only"
                                  ? "metadata-only"
                                  : "reduce-size")
                              }
                              disabled={isProcessing}
                              onClick={() =>
                                changeProcessingMode(
                                  option.id === "metadata-only"
                                    ? "metadata-only"
                                    : "reduce-size",
                                )
                              }
                              className={`rounded-xl px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                processingMode ===
                                (option.id === "metadata-only"
                                  ? "metadata-only"
                                  : "reduce-size")
                                  ? "bg-white text-[#5865e8] shadow-sm"
                                  : "text-slate-500 hover:text-slate-800"
                              }`}
                            >
                              <span className="block text-xs font-black">
                                {option.label}
                              </span>
                              <span className="mt-0.5 block text-[10px] font-semibold opacity-70">
                                {option.detail}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {processingMode === "metadata-only" && (
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs font-medium leading-6 text-indigo-900">
                          <div className="mb-1 flex items-center gap-2 font-black">
                            <ShieldCheck size={16} /> 元の形式と見た目を優先
                          </div>
                          対応する元形式を優先し、EXIF・GPS・XMP・IPTCを削除します。安全な維持ができない形式は明確なエラーを返します。
                        </div>
                      )}

                      <fieldset
                        disabled={isProcessing || processingMode === "metadata-only"}
                        className={
                          processingMode === "metadata-only" ? "opacity-45" : undefined
                        }
                      >
                        <legend className="mb-3 text-sm font-black text-slate-900">
                          画像の出力形式
                        </legend>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {availableImageFormats.map((option) => {
                            const selected = outputFormat === option.id;
                            return (
                              <label
                                key={option.id}
                                className={`relative rounded-2xl border p-4 transition ${
                                  selected
                                    ? "border-[#5865e8] bg-white shadow-[0_8px_22px_rgba(88,101,232,.10)] ring-1 ring-[#5865e8]"
                                    : "border-slate-200 bg-white/70 hover:border-slate-300"
                                } ${isStrictLosslessProcessingMode(processingMode) && option.id === "gif" ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                              >
                                <input
                                  type="radio"
                                  name="output-format"
                                  value={option.id}
                                  checked={selected}
                                  disabled={
                                    isStrictLosslessProcessingMode(processingMode) &&
                                    option.id === "gif"
                                  }
                                  onChange={() => {
                                    setOutputFormat(option.id);
                                    if (option.id === "png" || option.id === "tiff")
                                      setEncoding("lossless");
                                    if (option.id === "jpeg" || option.id === "gif")
                                      setEncoding("lossy");
                                  }}
                                  className="sr-only"
                                />
                                <div className="mb-3 flex items-center justify-between">
                                  <span
                                    className={`rounded-lg px-2.5 py-1 text-xs font-black ${
                                      selected
                                        ? "bg-indigo-100 text-indigo-700"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    .{option.id === "jpeg" ? "jpg" : option.id}
                                  </span>
                                  {selected && (
                                    <span className="grid size-5 place-items-center rounded-full bg-[#5865e8] text-white">
                                      <Check size={12} strokeWidth={3} />
                                    </span>
                                  )}
                                </div>
                                <p className="text-base font-black text-slate-900">
                                  {option.label}
                                </p>
                                <p className="mt-1 text-[11px] font-bold text-slate-500">
                                  {option.description}
                                </p>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>

                      <div
                        className={`grid gap-4 lg:grid-cols-[1fr_1fr] ${
                          processingMode === "metadata-only" ? "hidden" : ""
                        }`}
                      >
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-black text-slate-900">
                                {selectedFormat.label} の設定
                              </p>
                              <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                                {selectedFormat.detail}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-black uppercase text-indigo-700">
                              {isLosslessOutput ? "LOSSLESS" : "LOSSY"}
                            </span>
                          </div>

                          {(outputFormat === "webp" || outputFormat === "avif") && (
                            <fieldset
                              className="mt-5"
                              disabled={
                                isProcessing ||
                                isStrictLosslessProcessingMode(processingMode)
                              }
                            >
                              <legend className="mb-2 text-xs font-black text-slate-700">
                                圧縮方式
                              </legend>
                              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                                {(["lossless", "lossy"] as const).map((value) => (
                                  <label
                                    key={value}
                                    className={`cursor-pointer rounded-lg px-3 py-2 text-center text-xs font-black transition ${
                                      encoding === value
                                        ? "bg-white text-[#5865e8] shadow-sm"
                                        : "text-slate-500"
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="encoding"
                                      value={value}
                                      checked={encoding === value}
                                      onChange={() => setEncoding(value)}
                                      className="sr-only"
                                    />
                                    {value === "lossless"
                                      ? "可逆（lossless）"
                                      : "非可逆（lossy）"}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          )}

                          {showQuality && (
                            <div className="mt-5">
                              <div className="mb-2 flex items-center justify-between">
                                <label
                                  htmlFor="image-quality"
                                  className="text-xs font-black text-slate-700"
                                >
                                  品質
                                </label>
                                <output
                                  htmlFor="image-quality"
                                  className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-black text-indigo-700"
                                >
                                  {quality}
                                </output>
                              </div>
                              <input
                                id="image-quality"
                                type="range"
                                min="1"
                                max="100"
                                step="1"
                                value={quality}
                                disabled={isProcessing}
                                onChange={(event) =>
                                  setQuality(Number(event.target.value))
                                }
                                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#5865e8] disabled:cursor-not-allowed"
                                aria-describedby="image-quality-help"
                              />
                              <div
                                id="image-quality-help"
                                className="mt-2 flex justify-between text-[10px] font-bold text-slate-400"
                              >
                                <span>小さい</span>
                                <span>高画質</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs font-medium leading-6 text-indigo-900">
                            <div className="mb-1 flex items-center gap-2 font-black">
                              <ShieldCheck size={16} /> メタデータは自動で削除
                            </div>
                            EXIFの向きを画素へ反映してから、EXIF・GPS・XMP・IPTCを取り除きます。
                          </div>
                          <OutputFormatWarning
                            transparencyToJpeg={warnsAboutTransparency}
                            photoToPng={warnsAboutJpegToPng}
                          />
                          {warnsAboutTransparency && (
                            <fieldset className="rounded-2xl border border-slate-200 bg-white p-4">
                              <legend className="px-1 text-xs font-black text-slate-800">
                                JPEGの背景色
                              </legend>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {[
                                  ["#ffffff", "白"],
                                  ["#000000", "黒"],
                                ].map(([color, label]) => (
                                  <button
                                    key={color}
                                    type="button"
                                    aria-pressed={jpegBackgroundColor === color}
                                    onClick={() => setJpegBackgroundColor(color)}
                                    className={`rounded-lg border px-3 py-2 text-[10px] font-black ${
                                      jpegBackgroundColor === color
                                        ? "border-indigo-500 ring-1 ring-indigo-500"
                                        : "border-slate-200"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                                <label className="flex items-center gap-2 text-[10px] font-black text-slate-600">
                                  カスタム
                                  <input
                                    type="color"
                                    value={jpegBackgroundColor}
                                    onChange={(event) =>
                                      setJpegBackgroundColor(event.target.value)
                                    }
                                    className="size-9 rounded border border-slate-200 bg-white p-1"
                                  />
                                </label>
                              </div>
                            </fieldset>
                          )}
                          {items.find((item) => item.kind === "image") && (
                            <OutputFileNamePreview
                              originalFileName={
                                items.find((item) => item.kind === "image")!.file.name
                              }
                              outputFormat={outputFormat}
                            />
                          )}
                        </div>
                      </div>

                      <ImageEnhancementPanel
                        value={imageEnhancements}
                        disabled={isProcessing || !qualityEnhancementMode}
                        disabledReason={
                          qualityEnhancementMode
                            ? undefined
                            : "「画質をよくする」または「画質改善＋容量削減」で利用できます。"
                        }
                        onChange={(update) =>
                          setImageEnhancements((current) => ({ ...current, ...update }))
                        }
                      />

                      <RealEsrganPanel
                        value={imageAi}
                        capability={
                          capabilities?.ai ?? {
                            realEsrgan: false,
                            gfpgan: false,
                            gpu: false,
                            reason:
                              capabilityError ??
                              "Python・Real-ESRGAN・モデルの利用可否を確認しています。",
                          }
                        }
                        disabled={isProcessing || !qualityEnhancementMode}
                        disabledReason={
                          qualityEnhancementMode
                            ? undefined
                            : "画質改善を含む処理モードで利用できます。"
                        }
                        onChange={(update) =>
                          setImageAi((current) => ({ ...current, ...update }))
                        }
                      />
                    </div>
                  )}

                  {hasVideos && (
                    <div className={hasImages ? "mt-7" : ""}>
                      <VideoSettingsPanel
                        mediaInfos={videoInfos}
                        options={videoOptions}
                        capabilities={capabilities}
                        originalFileName={
                          items.find((item) => item.kind === "video")?.file.name
                        }
                        disabled={isProcessing || isInspecting}
                        onChange={(update) =>
                          setVideoOptions((current) => ({ ...current, ...update }))
                        }
                      />
                    </div>
                  )}

                  {hasAudio && (
                    <div className={hasImages || hasVideos ? "mt-7" : ""}>
                      <AudioSettingsPanel
                        mediaInfos={audioInfos}
                        options={audioOptions}
                        availableFormats={capabilities?.outputs.audio ?? []}
                        originalFileName={
                          items.find((item) => item.kind === "audio")?.file.name
                        }
                        disabled={isProcessing || isInspecting}
                        onChange={(update) =>
                          setAudioOptions((current) => ({ ...current, ...update }))
                        }
                      />
                    </div>
                  )}
                </div>
              </details>
            )}

            {items.length === 0 && (
              <p className="text-center text-sm font-bold text-slate-400">
                ファイルを追加すると、実形式を解析して対応する設定を表示します。
              </p>
            )}

            <div className="sticky bottom-0 z-30 -mx-4 mt-7 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-10px_30px_rgba(15,23,42,.08)] backdrop-blur sm:-mx-7 sm:px-7">
              <div className="mb-3 grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500 sm:grid-cols-4">
                <div>
                  <span className="block">ファイル</span>
                  <strong className="mt-0.5 block text-sm text-slate-900">
                    {items.length}件
                  </strong>
                </div>
                <div>
                  <span className="block">入力合計</span>
                  <strong className="mt-0.5 block text-sm text-slate-900">
                    {formatBytes(totalInputSize)}
                  </strong>
                </div>
                <div>
                  <span className="block">推定出力</span>
                  <strong className="mt-0.5 block text-sm text-slate-900">
                    約{formatBytes(estimatedOutputSize)}
                  </strong>
                </div>
                <div>
                  <span className="block">推定削減</span>
                  <strong className="mt-0.5 block text-sm text-emerald-700">
                    約{formatBytes(estimatedSavedSize)}
                  </strong>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void processAll()}
                disabled={
                  pendingCount === 0 ||
                  isValidating ||
                  isProcessing ||
                  isInspecting ||
                  hasInspectionErrors ||
                  videoSettingsInvalid ||
                  videoCombinationInvalid ||
                  audioSettingsInvalid ||
                  targetSizeInvalid
                }
                aria-describedby={
                  startDisabledReason ? "start-disabled-reason" : undefined
                }
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#5865e8] px-6 text-sm font-black text-white shadow-[0_12px_30px_rgba(88,101,232,.25)] transition hover:-translate-y-0.5 hover:bg-[#424dc5] disabled:cursor-not-allowed disabled:translate-y-0 disabled:bg-slate-300 disabled:shadow-none sm:text-base"
              >
                {isValidating ? (
                  <>
                    <LoaderCircle className="animate-spin" size={20} />{" "}
                    設定を確認しています
                  </>
                ) : isInspecting ? (
                  <>
                    <LoaderCircle className="animate-spin" size={20} />{" "}
                    実際のファイル形式を解析しています…
                  </>
                ) : isProcessing ? (
                  <>
                    <LoaderCircle className="animate-spin" size={20} /> 最適化しています…
                  </>
                ) : hasInspectionErrors ? (
                  <>
                    <RefreshCw size={19} /> ファイルを再解析してください
                  </>
                ) : videoSettingsInvalid ||
                  videoCombinationInvalid ||
                  audioSettingsInvalid ||
                  targetSizeInvalid ? (
                  <>
                    <AlertTriangle size={19} /> 出力設定を確認してください
                  </>
                ) : (
                  <>
                    <Sparkles size={19} />{" "}
                    {pendingCount > 0
                      ? `${pendingCount}ファイルを最適化する`
                      : "ファイルを選択してください"}
                  </>
                )}
              </button>
              {startDisabledReason && !isProcessing && (
                <p
                  id="start-disabled-reason"
                  className="mt-2 text-center text-[11px] font-bold text-amber-700"
                >
                  {startDisabledReason}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {completedItems.length > 0 && (
        <section className="border-y border-slate-200 bg-white py-14 sm:py-18">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="mb-8">
              <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-600">
                Complete
              </p>
              <h2 className="text-2xl font-black tracking-[-0.04em] text-slate-950 sm:text-3xl">
                最適化が完了しました
              </h2>
            </div>

            <div className="mb-8 grid gap-4">
              {completedItems.map((item) => {
                const result = item.result;
                const beforeResolution = result.image
                  ? `${result.image.before.width ?? "?"}×${result.image.before.height ?? "?"}`
                  : result.video
                    ? `${result.video.before.width}×${result.video.before.height}`
                    : undefined;
                const afterResolution = result.image
                  ? `${result.image.after.width ?? "?"}×${result.image.after.height ?? "?"}`
                  : result.video
                    ? `${result.video.after.width}×${result.video.after.height}`
                    : undefined;
                const outputCodec =
                  result.video?.after.videoCodec ?? result.audio?.after.audioCodec;
                return (
                  <div key={`${item.id}-summary`} className="space-y-2">
                    <CompressionSummary
                      originalSize={result.originalSize}
                      outputSize={result.outputSize}
                      elapsedSeconds={
                        item.startedAt && item.finishedAt
                          ? Math.max(0, (item.finishedAt - item.startedAt) / 1_000)
                          : item.progressEvent?.elapsedSeconds
                      }
                      originalResolution={beforeResolution}
                      outputResolution={afterResolution}
                      outputFormat={result.outputFormat}
                      outputCodec={outputCodec ?? undefined}
                      removedMetadata={result.removedMetadataTypes}
                      downloadUrl={result.downloadUrl}
                      downloadName={result.outputName}
                      onCompare={() =>
                        document.getElementById(`comparison-${item.id}`)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }
                      onReprocess={() => {
                        updateItem(item.id, {
                          status: "queued",
                          result: undefined,
                          progress: 0,
                          progressStage: undefined,
                          progressEvent: undefined,
                          error: undefined,
                        });
                        if (item.kind === "video" || item.kind === "audio") {
                          void inspectMedia(item.file, item.id);
                        }
                        document.getElementById("processing-settings")?.scrollIntoView({
                          behavior: "smooth",
                        });
                      }}
                    />
                    {result.optimizationReport && (
                      <OptimizationReportCard report={result.optimizationReport} />
                    )}
                    {result.targetSizeResult && (
                      <TargetSizeResultCard result={result.targetSizeResult} />
                    )}
                    <div className="-mt-2 flex justify-end">
                      <Link
                        href={`/result/${result.jobId}`}
                        className="inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 text-xs font-black text-[var(--text)]"
                      >
                        結果ページを開く
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-8">
              {completedItems.map((item) => {
                const result = item.result;
                const reduced = result.savedBytes >= 0;
                return (
                  <article
                    id={`comparison-${item.id}`}
                    key={item.id}
                    className="result-enter scroll-mt-5 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(23,32,51,.07)]"
                  >
                    <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:px-7">
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-900">
                          {result.outputName}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-indigo-100 px-2 py-1 text-[10px] font-black uppercase text-indigo-700">
                            {result.outputFormat}
                          </span>
                          {result.kind === "image" && result.encoding && (
                            <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                              {result.encoding}
                              {result.quality !== null ? ` · Q${result.quality}` : ""}
                            </span>
                          )}
                          <span className="text-xs font-bold text-slate-400">
                            {result.kind === "video" || result.kind === "audio"
                              ? result.processing === "stream-copy"
                                ? "無劣化ストリームコピー"
                                : `FFmpegで再エンコード${result.video?.crf ? ` · CRF ${result.video.crf}` : ""}`
                              : result.processing === "real-esrgan"
                                ? "Real-ESRGAN + Sharpで処理済み"
                                : "Sharpで処理済み"}
                          </span>
                        </div>
                      </div>
                      <a
                        href={result.downloadUrl}
                        download={result.outputName}
                        className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#172033] px-5 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-slate-700"
                      >
                        <Download size={17} /> ダウンロード
                      </a>
                    </div>

                    <div className="grid lg:grid-cols-[1.25fr_.75fr]">
                      <div className="border-b border-slate-200 p-5 sm:p-7 lg:border-b-0 lg:border-r">
                        {result.kind === "image" &&
                        item.originalPreview &&
                        result.previewUrl ? (
                          <div>
                            <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                              <ImageIcon size={17} className="text-[#5865e8]" />{" "}
                              プレビュー比較
                            </div>
                            <ImageComparison
                              beforeUrl={item.originalPreview}
                              afterUrl={result.previewUrl}
                            />
                            {result.image && (
                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                {[
                                  ["BEFORE", result.image.before],
                                  ["AFTER", result.image.after],
                                ].map(([label, info]) => {
                                  const imageInfo = info as NonNullable<
                                    ProcessResult["image"]
                                  >["before"];
                                  return (
                                    <div
                                      key={label as string}
                                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                                    >
                                      <p className="text-[9px] font-black text-slate-400">
                                        {label as string}
                                      </p>
                                      <p className="mt-1 font-black uppercase text-slate-800">
                                        {imageInfo.format} · {imageInfo.width ?? "?"} ×{" "}
                                        {imageInfo.height ?? "?"}
                                      </p>
                                      <p className="mt-1 text-[10px] font-bold text-slate-500">
                                        {imageInfo.pages}ページ / フレーム
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ) : result.video ? (
                          <div>
                            <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                              <Film size={17} className="text-orange-600" />{" "}
                              動画情報の比較
                            </div>
                            {result.previewUrls && (
                              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                                {[
                                  ["BEFORE", result.previewUrls.before],
                                  ["AFTER", result.previewUrls.after],
                                ].map(([label, url]) => (
                                  <figure
                                    key={label}
                                    className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950"
                                  >
                                    <video
                                      src={url}
                                      controls
                                      muted
                                      preload="metadata"
                                      className="aspect-video w-full object-contain"
                                    />
                                    <figcaption className="bg-white px-3 py-2 text-center text-[9px] font-black text-slate-500">
                                      {label}
                                    </figcaption>
                                  </figure>
                                ))}
                              </div>
                            )}
                            <div className="grid gap-3 sm:grid-cols-2">
                              {[
                                {
                                  label: "BEFORE",
                                  info: result.video.before,
                                  after: false,
                                },
                                { label: "AFTER", info: result.video.after, after: true },
                              ].map((entry) => (
                                <div
                                  key={entry.label}
                                  className={`rounded-2xl border p-4 ${
                                    entry.after
                                      ? "border-orange-200 bg-orange-50"
                                      : "border-slate-200 bg-slate-50"
                                  }`}
                                >
                                  <p
                                    className={`text-[10px] font-black ${entry.after ? "text-orange-700" : "text-slate-500"}`}
                                  >
                                    {entry.label}
                                  </p>
                                  <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">
                                    {entry.info.width} × {entry.info.height}
                                  </p>
                                  <dl className="mt-4 space-y-2 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">映像</dt>
                                      <dd className="font-black uppercase text-slate-700">
                                        {entry.info.videoCodec}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">
                                        動画ビットレート
                                      </dt>
                                      <dd className="font-black text-slate-700">
                                        {formatMediaBitrate(entry.info.bitrate)}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">FPS</dt>
                                      <dd className="font-black text-slate-700">
                                        {entry.info.fps?.toFixed(3) ?? "不明"}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">音声</dt>
                                      <dd className="font-black uppercase text-slate-700">
                                        {entry.info.audioCodec ?? "なし"} ·{" "}
                                        {formatMediaBitrate(entry.info.audioBitrate)}
                                      </dd>
                                    </div>
                                  </dl>
                                </div>
                              ))}
                            </div>
                            <p className="mt-3 rounded-xl bg-slate-900 px-4 py-3 text-[10px] font-bold leading-5 text-slate-300">
                              {result.processing === "stream-copy"
                                ? "-c copyで映像・音声・解像度を変更せずに処理しました。"
                                : `${result.video.options.codec === "h264" ? "libx264" : result.video.options.codec === "h265" ? "libx265" : result.video.options.codec === "vp9" ? "libvpx-vp9" : "libaom-av1"} / CRF ${result.video.crf} で変換しました。`}
                            </p>
                          </div>
                        ) : result.audio ? (
                          <div>
                            <div className="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                              <FileAudio size={17} className="text-sky-600" />{" "}
                              音声情報の比較
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {[
                                {
                                  label: "BEFORE",
                                  info: result.audio.before,
                                  after: false,
                                },
                                { label: "AFTER", info: result.audio.after, after: true },
                              ].map((entry) => (
                                <div
                                  key={entry.label}
                                  className={`rounded-2xl border p-4 ${entry.after ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50"}`}
                                >
                                  <p className="text-[10px] font-black text-slate-500">
                                    {entry.label}
                                  </p>
                                  <p className="mt-3 text-xl font-black uppercase text-slate-900">
                                    {entry.info.audioCodec}
                                  </p>
                                  <dl className="mt-4 space-y-2 text-xs">
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">
                                        ビットレート
                                      </dt>
                                      <dd className="font-black text-slate-700">
                                        {formatMediaBitrate(
                                          entry.info.audioBitrate ?? entry.info.bitrate,
                                        )}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">
                                        サンプルレート
                                      </dt>
                                      <dd className="font-black text-slate-700">
                                        {entry.info.sampleRate
                                          ? `${entry.info.sampleRate} Hz`
                                          : "不明"}
                                      </dd>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                      <dt className="font-bold text-slate-400">
                                        チャンネル
                                      </dt>
                                      <dd className="font-black text-slate-700">
                                        {entry.info.channels ?? "不明"}
                                      </dd>
                                    </div>
                                  </dl>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-slate-50 text-center">
                            <span className="grid size-16 place-items-center rounded-2xl bg-orange-100 text-orange-600">
                              <Film size={28} />
                            </span>
                            <p className="mt-4 font-black text-slate-900">
                              映像・音声ストリームを維持
                            </p>
                            <p className="mt-2 max-w-sm text-xs font-medium leading-5 text-slate-500">
                              -c copy / -map_metadata -1 / -map_chapters -1
                              を使用し、再エンコードせずに不要情報を除去しました。
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="p-5 sm:p-7">
                        <div className="mb-5 flex items-center gap-2 text-sm font-black text-slate-900">
                          <ArrowDown
                            size={17}
                            className={reduced ? "text-emerald-600" : "text-amber-600"}
                          />{" "}
                          サイズ比較
                        </div>
                        <div
                          className={`rounded-2xl p-5 ${reduced ? "bg-emerald-50" : "bg-amber-50"}`}
                        >
                          <p
                            className={`text-xs font-black ${reduced ? "text-emerald-700" : "text-amber-700"}`}
                          >
                            {reduced ? "削減率" : "サイズ変化"}
                          </p>
                          <p
                            className={`mt-1 text-4xl font-black tracking-[-0.05em] ${reduced ? "text-emerald-700" : "text-amber-700"}`}
                          >
                            {result.reductionPercent > 0
                              ? "−"
                              : result.reductionPercent < 0
                                ? "+"
                                : ""}
                            {Math.abs(result.reductionPercent)}%
                          </p>
                          <p className="mt-2 text-xs font-bold text-slate-600">
                            {reductionCopy(result)}
                          </p>
                        </div>
                        <div className="mt-5 space-y-3">
                          <div>
                            <div className="mb-1.5 flex justify-between text-xs font-bold text-slate-500">
                              <span>処理前</span>
                              <span>{formatBytes(result.originalSize)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full w-full rounded-full bg-slate-300" />
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 flex justify-between text-xs font-bold text-slate-700">
                              <span>処理後</span>
                              <span>{formatBytes(result.outputSize)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-[#5865e8]"
                                style={{
                                  width: `${Math.min(100, Math.max(3, (result.outputSize / result.originalSize) * 100))}%`,
                                }}
                              />
                            </div>
                          </div>
                        </div>

                        {result.warnings.length > 0 && (
                          <div className="mt-5 space-y-2">
                            {result.warnings.map((warning) => (
                              <p
                                key={warning}
                                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-5 text-amber-800"
                              >
                                <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                                {warning}
                              </p>
                            ))}
                          </div>
                        )}

                        <div className="mt-7 border-t border-slate-200 pt-6">
                          <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-900">
                            <ScanSearch size={17} className="text-[#5865e8]" /> メタデータ
                          </div>
                          {result.removedMetadataTypes.length > 0 ? (
                            <>
                              <div className="flex flex-wrap gap-1.5">
                                {result.removedMetadataTypes.map((type) => (
                                  <span
                                    key={type}
                                    className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-700"
                                  >
                                    {type} 削除
                                  </span>
                                ))}
                              </div>
                              {result.metadataAfter && (
                                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                                  <div className="rounded-xl bg-slate-100 p-3">
                                    <p className="font-black text-slate-500">処理前</p>
                                    <p className="mt-1 font-bold text-slate-700">
                                      {result.metadata.types.length
                                        ? result.metadata.types.join(" / ")
                                        : "なし"}
                                    </p>
                                  </div>
                                  <div className="rounded-xl bg-emerald-50 p-3">
                                    <p className="font-black text-emerald-700">処理後</p>
                                    <p className="mt-1 font-bold text-emerald-800">
                                      {result.metadataAfter.types.length
                                        ? result.metadataAfter.types.join(" / ")
                                        : "検出なし"}
                                    </p>
                                  </div>
                                </div>
                              )}
                              {result.metadata.fields.length > 0 && (
                                <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50">
                                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">
                                    検出した項目を見る（{result.metadata.fields.length}）
                                  </summary>
                                  <dl className="max-h-48 space-y-2 overflow-auto border-t border-slate-200 p-3">
                                    {result.metadata.fields.map((field, index) => (
                                      <div
                                        key={`${field.key}-${index}`}
                                        className="grid grid-cols-[72px_1fr] gap-2 text-[10px]"
                                      >
                                        <dt className="font-black text-slate-500">
                                          {field.group} · {field.key}
                                        </dt>
                                        <dd className="break-all font-medium text-slate-700">
                                          {field.value}
                                        </dd>
                                      </div>
                                    ))}
                                  </dl>
                                </details>
                              )}
                            </>
                          ) : (
                            <p className="text-xs font-medium text-slate-500">
                              {result.kind !== "image"
                                ? "メタデータ削除はオフです。"
                                : "削除対象のEXIF・GPS・XMPは見つかりませんでした。"}
                            </p>
                          )}
                        </div>
                        <p className="mt-5 flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                          <LockKeyhole size={12} /> ダウンロード期限は
                          {result.expiresInMinutes}分です
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {!embedded && (
        <section className="mx-auto grid max-w-6xl gap-4 px-5 py-14 sm:grid-cols-3 sm:px-8 sm:py-18">
          {[
            {
              icon: ShieldCheck,
              title: "実環境から形式を取得",
              body: "Sharp・FFmpegが実際に使える画像・動画・音声形式だけを表示します。",
            },
            {
              icon: LockKeyhole,
              title: "短時間だけ保存",
              body: "元ファイルは処理直後、完成ファイルも30分後に削除します。",
            },
            {
              icon: Film,
              title: "比較して選べる",
              body: "画像スライダー、短尺動画、サイズ・解像度・コーデック差を確認できます。",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <feature.icon size={21} className="mb-4 text-[#5865e8]" />
              <h3 className="font-black text-slate-900">{feature.title}</h3>
              <p className="mt-2 text-xs font-medium leading-6 text-slate-500">
                {feature.body}
              </p>
            </div>
          ))}
        </section>
      )}

      <CancelProcessingDialog
        open={Boolean(cancelTarget)}
        fileName={cancelTarget?.file.name}
        isCancelling={cancelTarget?.progressStage === "キャンセルを要求しています…"}
        onClose={() => setCancelTargetId(null)}
        onConfirm={() => {
          if (cancelTarget) void cancelItem(cancelTarget);
        }}
      />

      {!embedded && (
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-xs font-bold text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p>© 2026 Compression Files</p>
            <p className="flex items-center gap-1.5">
              <ShieldCheck size={13} /> プライバシーを考えた一時ファイル設計
            </p>
          </div>
        </footer>
      )}
    </main>
  );
}
