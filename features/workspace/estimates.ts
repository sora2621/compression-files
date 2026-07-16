import {
  isStrictLosslessProcessingMode,
  type ImageOutputFormat,
  type ProcessingMode,
} from "@/lib/media/image-types";
import {
  estimateTargetSizeFeasibility,
  resolveRequestedTargetBytes,
} from "@/lib/target-size/calculations";

import type { QueueItem } from "@/features/workspace/types";
import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type { VideoCompressionOptions } from "@/lib/media/video-types";
import type { TargetSizeEstimate, TargetSizeOptions } from "@/lib/target-size/types";

export interface WorkspaceEstimateInput {
  items: QueueItem[];
  processingMode: ProcessingMode;
  outputFormat: ImageOutputFormat;
  quality: number;
  videoOptions: VideoCompressionOptions;
  audioOptions: AudioProcessingOptions;
  targetSizeOptions: TargetSizeOptions;
}

export interface WorkspaceEstimate {
  totalInputSize: number;
  targetSizeEstimate: TargetSizeEstimate | null;
  estimatedOutputSize: number;
  estimatedSavedSize: number;
}

export function estimateWorkspaceOutput({
  items,
  processingMode,
  outputFormat,
  quality,
  videoOptions,
  audioOptions,
  targetSizeOptions,
}: WorkspaceEstimateInput): WorkspaceEstimate {
  const hasImages = items.some((item) => item.kind === "image");
  const hasVideos = items.some((item) => item.kind === "video");
  const hasAudio = items.some((item) => item.kind === "audio");
  const videoInfos = items.flatMap((item) =>
    item.kind === "video" && item.videoInfo ? [item.videoInfo] : [],
  );
  const audioInfos = items.flatMap((item) =>
    item.kind === "audio" && item.audioInfo ? [item.audioInfo] : [],
  );
  const totalInputSize = items.reduce(
    (sum, item) => sum + (item.originalSize ?? item.file.size),
    0,
  );
  let targetSizeEstimate: TargetSizeEstimate | null = null;
  if (targetSizeOptions.enabled && totalInputSize > 0) {
    try {
      const targetBytes = resolveRequestedTargetBytes(targetSizeOptions, totalInputSize);
      const targetRatio = targetBytes / totalInputSize;
      const sourceHeight = videoInfos[0]?.height ?? null;
      const recommendedHeight = sourceHeight
        ? Math.min(
            sourceHeight,
            targetRatio >= 0.55
              ? sourceHeight
              : targetRatio >= 0.35
                ? 1080
                : targetRatio >= 0.2
                  ? 720
                  : 480,
          )
        : null;
      const estimatedMinimumBytes = Math.max(
        1,
        Math.round(totalInputSize * (hasVideos ? 0.18 : hasAudio ? 0.22 : 0.08)),
      );
      targetSizeEstimate = estimateTargetSizeFeasibility({
        originalBytes: totalInputSize,
        targetBytes,
        estimatedMinimumBytes,
        estimatedOutputBytes:
          targetBytes >= totalInputSize
            ? totalInputSize
            : Math.max(targetBytes, estimatedMinimumBytes),
        estimatedProcessingSeconds: hasVideos
          ? Math.max(5, Math.round((videoInfos[0]?.duration ?? 5) * 2.2))
          : hasAudio
            ? Math.max(2, Math.round((audioInfos[0]?.duration ?? 2) * 0.35))
            : 11,
        outputFormat: hasImages
          ? outputFormat
          : hasVideos
            ? (videoOptions.outputContainer ?? "mkv")
            : audioOptions.outputFormat,
        codec: hasVideos
          ? videoOptions.codec
          : hasAudio
            ? audioOptions.outputFormat
            : null,
        resolutionChange: Boolean(
          sourceHeight && recommendedHeight && recommendedHeight < sourceHeight,
        ),
        recommendedHeight,
      });
    } catch {
      targetSizeEstimate = null;
    }
  }
  const estimatedOutputFactor =
    targetSizeEstimate && totalInputSize > 0
      ? Math.min(1, targetSizeEstimate.estimatedOutputBytes / totalInputSize)
      : processingMode === "metadata-only" ||
          isStrictLosslessProcessingMode(processingMode)
        ? 0.96
        : quality >= 90 || videoOptions.quality === "high"
          ? 0.78
          : quality <= 72 || videoOptions.quality === "small"
            ? 0.42
            : 0.62;
  const estimatedOutputSize = Math.round(totalInputSize * estimatedOutputFactor);
  return {
    totalInputSize,
    targetSizeEstimate,
    estimatedOutputSize,
    estimatedSavedSize: Math.max(0, totalInputSize - estimatedOutputSize),
  };
}
