import type { UseCasePresetDefinition } from "../types";

export const socialPreset = {
  id: "social",
  label: "SNS",
  description: "投稿しやすい形式と解像度にします",
  optimization: "投稿互換性・モバイル表示・短時間処理",
  reductionRange: [45, 72],
  secondsPerMb: 0.7,
  image: {
    photoFormat: "jpeg",
    transparentFormat: "png",
    quality: 85,
    encoding: "lossy",
    maxLongEdge: 2048,
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
  targetMegabytes: { image: null, multipleImages: null, mediaTotal: 50 },
  processingMode: "reduce-size",
  speedPreset: "balanced",
} as const satisfies UseCasePresetDefinition;
