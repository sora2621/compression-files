import {
  normalizeVideoEnhancements,
  type VideoEnhancementOptions,
  type VideoFrameRate,
} from "@/lib/media/video-types";

export function buildScaleFilter(targetHeight: number | null) {
  return targetHeight === null ? null : `scale=-2:${targetHeight}:flags=lanczos`;
}

export function buildFrameRateFilter(frameRate: VideoFrameRate | undefined) {
  return !frameRate || frameRate === "original" ? null : `fps=${frameRate}`;
}

export function buildNoiseFilter(enhancements: VideoEnhancementOptions | undefined) {
  const { denoise } = normalizeVideoEnhancements(enhancements);
  if (denoise === "hqdn3d") return "hqdn3d=1.5:1.5:6:6";
  if (denoise === "nlmeans") return "nlmeans=s=2:p=7:r=9";
  return null;
}

export function buildSharpenFilter(enhancements: VideoEnhancementOptions | undefined) {
  const { sharpen } = normalizeVideoEnhancements(enhancements);
  if (sharpen === "unsharp") return "unsharp=5:5:0.8:3:3:0.4";
  if (sharpen === "cas") return "cas=strength=0.5";
  return null;
}

export function buildColorFilters(enhancements: VideoEnhancementOptions | undefined) {
  const normalized = normalizeVideoEnhancements(enhancements);
  const filters: string[] = [];
  if (
    normalized.brightness !== 0 ||
    normalized.contrast !== 1 ||
    normalized.saturation !== 1
  ) {
    filters.push(
      `eq=brightness=${normalized.brightness}:contrast=${normalized.contrast}:saturation=${normalized.saturation}`,
    );
  }
  if (normalized.colorCorrection) {
    filters.push("colorspace=all=bt709:fast=1");
  }
  return filters;
}

export interface VideoFilterChainOptions {
  targetHeight: number | null;
  frameRate?: VideoFrameRate;
  enhancements?: VideoEnhancementOptions;
}

export function buildVideoFilterChain(options: VideoFilterChainOptions) {
  return [
    buildScaleFilter(options.targetHeight),
    buildFrameRateFilter(options.frameRate),
    buildNoiseFilter(options.enhancements),
    buildSharpenFilter(options.enhancements),
    ...buildColorFilters(options.enhancements),
  ].filter((filter): filter is string => filter !== null);
}
