import { isAudioProcessingOptions } from "@/lib/media/audio-types";
import {
  IMAGE_OUTPUT_FORMATS,
  isStrictLosslessProcessingMode,
} from "@/lib/media/image-types";
import { isVideoCompressionOptions, selectedVideoHeight } from "@/lib/media/video-types";
import { isTargetSizeOptions } from "@/lib/target-size/types";
import {
  isOutputFormatForCategory,
  isVideoCodecAllowed,
} from "@/shared/media/output-formats";

import type { QueueItem } from "@/features/workspace/types";
import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type {
  ImageEncoding,
  ImageOutputFormat,
  ProcessingMode,
} from "@/lib/media/image-types";
import type { VideoCompressionOptions } from "@/lib/media/video-types";
import type { TargetSizeOptions } from "@/lib/target-size/types";

export interface ProcessingSettingsValidationInput {
  items: readonly Pick<
    QueueItem,
    "kind" | "inspectionStatus" | "uploadId" | "status" | "outputFormat"
  >[];
  processingMode: ProcessingMode;
  outputFormat: ImageOutputFormat;
  encoding: ImageEncoding;
  quality: number;
  jpegBackgroundColor?: string;
  videoOptions: VideoCompressionOptions;
  audioOptions: AudioProcessingOptions;
  targetSizeOptions: TargetSizeOptions;
}

export interface ProcessingSettingsValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates user-selected settings only. This function intentionally performs no
 * file I/O, media probing, capability discovery, encoding, or AI model loading.
 */
export function validateProcessingSettings(
  input: ProcessingSettingsValidationInput,
): ProcessingSettingsValidationResult {
  const errors: string[] = [];
  const items = input.items.filter(
    (item) =>
      item.status === "queued" || item.status === "error" || item.status === "cancelled",
  );

  if (items.length === 0) {
    errors.push("処理するファイルを1件以上選択してください。");
  }
  if (items.some((item) => item.inspectionStatus !== "ready")) {
    errors.push("ファイル情報の解析が完了していません。");
  }
  if (items.some((item) => item.kind === "unknown")) {
    errors.push("実際のファイル形式を確認できていないファイルがあります。");
  }
  if (
    items.some(
      (item) => (item.kind === "video" || item.kind === "audio") && !item.uploadId,
    )
  ) {
    errors.push("動画または音声のアップロード情報がありません。再解析してください。");
  }

  const hasImages = items.some((item) => item.kind === "image");
  const hasVideos = items.some((item) => item.kind === "video");
  const hasAudio = items.some((item) => item.kind === "audio");

  if (hasImages && !IMAGE_OUTPUT_FORMATS.includes(input.outputFormat)) {
    errors.push("画像の出力形式を選択してください。");
  }
  if (
    items.some(
      (item) =>
        item.kind === "image" &&
        item.outputFormat !== undefined &&
        !isOutputFormatForCategory(item.outputFormat, "image"),
    )
  ) {
    errors.push("画像に指定された出力形式が無効です。");
  }
  const imageFormats = items
    .filter((item) => item.kind === "image")
    .map((item) => item.outputFormat ?? input.outputFormat);
  const jpegBackgroundColor = input.jpegBackgroundColor ?? "#ffffff";
  if (imageFormats.includes("jpeg") && !/^#[0-9a-f]{6}$/i.test(jpegBackgroundColor)) {
    errors.push("JPEG背景色は#RRGGBB形式で指定してください。");
  }
  if (
    hasImages &&
    input.outputFormat !== "png" &&
    !(
      input.encoding === "lossless" &&
      ["webp", "avif", "tiff"].includes(input.outputFormat)
    ) &&
    (!Number.isInteger(input.quality) || input.quality < 1 || input.quality > 100)
  ) {
    errors.push("画像品質は1から100の範囲で指定してください。");
  }
  if (
    hasImages &&
    isStrictLosslessProcessingMode(input.processingMode) &&
    (input.outputFormat === "jpeg" || input.encoding === "lossy")
  ) {
    errors.push("完全無劣化モードでは非可逆の画像出力を選択できません。");
  }

  if (hasVideos) {
    if (
      items.some(
        (item) =>
          item.kind === "video" &&
          item.outputFormat !== undefined &&
          !isOutputFormatForCategory(item.outputFormat, "video"),
      )
    ) {
      errors.push("動画に指定された出力形式が無効です。");
    }
    const height = selectedVideoHeight(input.videoOptions);
    if (
      input.videoOptions.resolution === "custom" &&
      (height === null || height < 144 || height > 4320 || height % 2 !== 0)
    ) {
      errors.push("カスタム解像度は144から4320の偶数で指定してください。");
    }
    if (!isVideoCompressionOptions(input.videoOptions)) {
      errors.push("動画圧縮設定を確認してください。");
    }
    if (
      input.videoOptions.outputContainer === "webm" &&
      input.videoOptions.codec !== "vp9" &&
      input.videoOptions.codec !== "av1"
    ) {
      errors.push("WebM出力ではVP9またはAV1を選択してください。");
    }
    const videoContainers = items
      .filter((item) => item.kind === "video")
      .map((item) => item.outputFormat ?? input.videoOptions.outputContainer)
      .filter((container): container is string =>
        Boolean(container && container !== "source"),
      );
    if (
      input.videoOptions.mode === "compress" &&
      videoContainers.some(
        (container) => !isVideoCodecAllowed(container, input.videoOptions.codec),
      )
    ) {
      errors.push("動画コンテナと映像コーデックの組み合わせが無効です。");
    }
    if (
      isStrictLosslessProcessingMode(input.processingMode) &&
      (input.videoOptions.mode !== "copy" || input.videoOptions.resolution !== "original")
    ) {
      errors.push("完全無劣化モードでは動画の再エンコードや解像度変更はできません。");
    }
  }

  if (hasAudio && !isAudioProcessingOptions(input.audioOptions)) {
    errors.push("音声変換設定を確認してください。");
  } else if (
    hasAudio &&
    isStrictLosslessProcessingMode(input.audioOptions.processingMode) &&
    input.audioOptions.outputFormat !== "flac" &&
    input.audioOptions.outputFormat !== "wav"
  ) {
    errors.push("完全無劣化の音声出力はFLACまたはWAVを選択してください。");
  }
  if (
    items.some(
      (item) =>
        item.kind === "audio" &&
        item.outputFormat !== undefined &&
        !isOutputFormatForCategory(item.outputFormat, "audio"),
    )
  ) {
    errors.push("音声に指定された出力形式が無効です。");
  }

  if (input.processingMode === "target-size") {
    if (
      !isTargetSizeOptions(input.targetSizeOptions) ||
      !input.targetSizeOptions.enabled
    ) {
      errors.push("目標容量の設定を確認してください。");
    } else if (
      (input.targetSizeOptions.targetBytes ?? 0) <= 0 &&
      (input.targetSizeOptions.targetRatio ?? 0) <= 0
    ) {
      errors.push("目標容量は0より大きい値を指定してください。");
    }
  }

  return { isValid: errors.length === 0, errors };
}
