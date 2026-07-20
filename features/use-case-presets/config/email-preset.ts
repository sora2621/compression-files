import type { UseCasePresetDefinition } from "../types";

export const emailPreset = {
  id: "email",
  label: "メール添付",
  description: "添付できる容量まで小さくします",
  optimization: "容量上限・受信側の互換性",
  reductionRange: [55, 82],
  secondsPerMb: 0.65,
  image: {
    photoFormat: "jpeg",
    transparentFormat: "webp",
    quality: 80,
    encoding: "lossy",
    maxLongEdge: 1920,
    removeMetadata: true,
  },
  video: {
    outputContainer: "mp4",
    codec: "h264",
    quality: "small",
    resolution: "720",
    audio: "aac96",
    removeMetadata: true,
  },
  audio: { outputFormat: "mp3", quality: "small", removeMetadata: true },
  targetMegabytes: { image: 5, multipleImages: 15, mediaTotal: 20 },
  processingMode: "target-size",
  speedPreset: "fast",
} as const satisfies UseCasePresetDefinition;
