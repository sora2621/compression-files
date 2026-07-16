import {
  selectedVideoHeight,
  videoEnhancementsRequireReencode,
} from "@/lib/media/video-types";

import type { ProcessingPath, VideoProcessingPath } from "./types";
import type { ImageAiOptions, ImageEnhancementOptions } from "@/lib/media/image-types";
import type { VideoCompressionOptions } from "@/lib/media/video-types";

export function decideVideoProcessingPath(
  options: VideoCompressionOptions,
  runtime: {
    hardwareEncoder?: string;
    originalBytes?: number;
    targetBytes?: number;
  } = {},
): VideoProcessingPath {
  if (
    runtime.originalBytes !== undefined &&
    runtime.targetBytes !== undefined &&
    runtime.originalBytes <= runtime.targetBytes
  ) {
    return {
      type: "return-original",
      reason: "元ファイルがすでに目標容量以下のため処理を省略します。",
    };
  }
  if (options.upscaleMode === "ai") return { type: "ai-enhancement" };
  const requiresTranscode =
    options.mode === "compress" ||
    selectedVideoHeight(options) !== null ||
    (options.frameRate ?? "original") !== "original" ||
    videoEnhancementsRequireReencode(options.enhancements);
  if (!requiresTranscode) return { type: "stream-copy" };
  if (runtime.hardwareEncoder) {
    return { type: "hardware-encode", encoder: runtime.hardwareEncoder };
  }
  const encoder =
    options.codec === "h264"
      ? "libx264"
      : options.codec === "h265"
        ? "libx265"
        : options.codec === "vp9"
          ? "libvpx-vp9"
          : "libaom-av1";
  return { type: "software-encode", encoder };
}

export function decideImageProcessingPath(options: {
  ai?: ImageAiOptions;
  enhancements?: ImageEnhancementOptions;
  originalBytes?: number;
  targetBytes?: number;
}): ProcessingPath {
  if (
    options.targetBytes !== undefined &&
    options.originalBytes !== undefined &&
    options.originalBytes <= options.targetBytes
  ) {
    return {
      type: "return-original",
      reason: "元ファイルがすでに目標容量以下のため処理を省略します。",
    };
  }
  if (options.ai?.enabled) return { type: "ai-processing" };
  return { type: "image-optimization" };
}
