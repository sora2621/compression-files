import type { UseCasePresetDefinition } from "../types";

export const webPreset = {
  id: "web",
  label: "Webサイト",
  description: "ページを軽くし、表示速度を優先します",
  optimization: "表示速度・見た目・ブラウザー互換性",
  reductionRange: [45, 75],
  secondsPerMb: 0.75,
  image: {
    photoFormat: "webp",
    transparentFormat: "webp",
    quality: 84,
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
  audio: { outputFormat: "m4a", quality: "balanced", removeMetadata: true },
  targetMegabytes: { image: 5, multipleImages: null, mediaTotal: null },
  processingMode: "reduce-size",
  speedPreset: "balanced",
} as const satisfies UseCasePresetDefinition;
