import type { UseCasePresetDefinition } from "../types";

export const archivePreset = {
  id: "archive",
  label: "長期保管",
  description: "画質と復元性を優先します",
  optimization: "可逆圧縮・将来の復元性",
  reductionRange: [5, 28],
  secondsPerMb: 1.15,
  image: {
    photoFormat: "tiff",
    transparentFormat: "png",
    quality: 100,
    encoding: "lossless",
    maxLongEdge: null,
    removeMetadata: false,
  },
  video: {
    outputContainer: "mkv",
    codec: "h264",
    quality: "high",
    resolution: "original",
    audio: "flac",
    removeMetadata: false,
  },
  audio: { outputFormat: "flac", quality: "high", removeMetadata: false },
  targetMegabytes: { image: null, multipleImages: null, mediaTotal: null },
  processingMode: "archive",
  speedPreset: "maximum-compression",
} as const satisfies UseCasePresetDefinition;
