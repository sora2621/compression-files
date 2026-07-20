import type { UseCasePresetDefinition } from "../types";

export const smartphonePreset = {
  id: "smartphone",
  label: "スマートフォン保存",
  description: "画質と保存容量のバランスを取ります",
  optimization: "端末互換性・画質と容量のバランス",
  reductionRange: [35, 65],
  secondsPerMb: 0.65,
  image: {
    photoFormat: "jpeg",
    transparentFormat: "png",
    quality: 86,
    encoding: "lossy",
    maxLongEdge: 2560,
    removeMetadata: true,
  },
  video: {
    outputContainer: "mp4",
    codec: "h264",
    quality: "balanced",
    resolution: "1080",
    audio: "aac128",
    removeMetadata: true,
  },
  audio: { outputFormat: "m4a", quality: "high", removeMetadata: true },
  targetMegabytes: { image: null, multipleImages: null, mediaTotal: 100 },
  processingMode: "reduce-size",
  speedPreset: "fast",
} as const satisfies UseCasePresetDefinition;
