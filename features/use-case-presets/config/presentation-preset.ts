import type { UseCasePresetDefinition } from "../types";

export const presentationPreset = {
  id: "presentation",
  label: "プレゼン資料",
  description: "資料が重くならないサイズに調整します",
  optimization: "投影時の見やすさ・資料容量・互換性",
  reductionRange: [45, 70],
  secondsPerMb: 0.6,
  image: {
    photoFormat: "jpeg",
    transparentFormat: "png",
    quality: 84,
    encoding: "lossy",
    maxLongEdge: 1920,
    removeMetadata: true,
  },
  video: {
    outputContainer: "mp4",
    codec: "h264",
    quality: "balanced",
    resolution: "720",
    audio: "aac128",
    removeMetadata: true,
  },
  audio: { outputFormat: "m4a", quality: "balanced", removeMetadata: true },
  targetMegabytes: { image: null, multipleImages: null, mediaTotal: 30 },
  processingMode: "reduce-size",
  speedPreset: "fast",
} as const satisfies UseCasePresetDefinition;
