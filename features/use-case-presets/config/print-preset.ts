import type { UseCasePresetDefinition } from "../types";

export const printPreset = {
  id: "print",
  label: "印刷",
  description: "解像度と色の品質を優先します",
  optimization: "元解像度・色・高品質",
  reductionRange: [8, 32],
  secondsPerMb: 0.9,
  image: {
    photoFormat: "jpeg",
    transparentFormat: "png",
    quality: 94,
    encoding: "lossy",
    maxLongEdge: null,
    removeMetadata: true,
  },
  video: {
    outputContainer: "mov",
    codec: "h264",
    quality: "high",
    resolution: "original",
    audio: "aac128",
    removeMetadata: false,
  },
  audio: { outputFormat: "wav", quality: "high", removeMetadata: false },
  targetMegabytes: { image: null, multipleImages: null, mediaTotal: null },
  processingMode: "high-quality-optimization",
  speedPreset: "maximum-compression",
} as const satisfies UseCasePresetDefinition;
