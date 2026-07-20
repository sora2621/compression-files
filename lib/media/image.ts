import { readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, parse } from "node:path";

import {
  createSharpPreview,
  encodeImageWithSharp,
  getSharpImageMetadata,
  IMAGE_OUTPUT_DETAILS,
  prepareSharpAiInput,
} from "@/infrastructure/sharp/image-service";
import { runRealEsrgan } from "@/lib/ai/real-esrgan";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import {
  MAX_AI_IMAGE_INPUT_PIXELS_CPU,
  MAX_AI_IMAGE_INPUT_PIXELS_GPU,
  MAX_AI_IMAGE_OUTPUT_PIXELS,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { runQueuedAiJob } from "@/lib/jobs/ai-queue";
import { runScheduledProcessingJob } from "@/lib/jobs/processing-scheduler";
import { isStrictLosslessProcessingMode } from "@/lib/media/image-types";
import { logger } from "@/shared/logging/logger";
import { createProcessingTimer } from "@/shared/logging/processing-timer";

import { inspectImageMetadata } from "./metadata";

import type { SharpImageMetadata } from "@/infrastructure/sharp/image-service";
import type {
  ImageAiOptions,
  ImageEncoding,
  ImageEnhancementOptions,
  ImageOperation,
  ImageOutputFormat,
  ProcessingMode,
} from "@/lib/media/image-types";
import type { ProcessingSpeedPreset } from "@/lib/processing/types";
import type { ProcessingStatus } from "@/lib/progress/types";

interface ImageProcessOptions {
  inputPath: string;
  directory: string;
  originalName: string;
  mime: string;
  operation: ImageOperation;
  outputFormat: ImageOutputFormat;
  encoding: ImageEncoding;
  quality: number;
  maxDimension?: number | null;
  jpegBackgroundColor?: string;
  processingMode?: ProcessingMode;
  enhancements?: ImageEnhancementOptions;
  ai?: ImageAiOptions;
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string, status?: ProcessingStatus) => void;
  speedPreset?: ProcessingSpeedPreset;
  jobId?: string;
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AppError("画像処理をキャンセルしました。", 499, "CANCELLED");
  }
}

function optimizedName(extension: string) {
  return `generated-image-output${extension}`;
}

function stripJpegSegments(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Invalid JPEG stream");
  }

  const chunks: Buffer[] = [buffer.subarray(0, 2)];
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];

    if (marker === 0xda) {
      chunks.push(buffer.subarray(markerStart));
      break;
    }

    const hasNoLength =
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7);
    if (hasNoLength) {
      chunks.push(buffer.subarray(markerStart, offset + 1));
      offset += 1;
      continue;
    }

    if (offset + 2 >= buffer.length) throw new Error("Truncated JPEG segment");
    const length = buffer.readUInt16BE(offset + 1);
    const end = offset + 1 + length;
    if (length < 2 || end > buffer.length) throw new Error("Invalid JPEG segment");

    const removable = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!removable) chunks.push(buffer.subarray(markerStart, end));
    offset = end;
  }

  return Buffer.concat(chunks);
}

async function processMetadataOnly(
  options: ImageProcessOptions,
  sourceFormat: string,
  orientation: number | undefined,
) {
  const sourceExtension = extname(options.originalName).toLowerCase();

  if (sourceFormat === "jpeg" && (!orientation || orientation === 1)) {
    const extension = sourceExtension === ".jpeg" ? ".jpeg" : ".jpg";
    const outputName = optimizedName(extension);
    const source = await readFile(/*turbopackIgnore: true*/ options.inputPath);
    await writeFile(
      join(/*turbopackIgnore: true*/ options.directory, outputName),
      stripJpegSegments(source),
    );
    return {
      outputName,
      outputMime: "image/jpeg",
      outputFormat: "jpeg" as const,
      encoding: "lossy" as const,
      quality: null,
      warnings: [] as string[],
    };
  }

  const fallbackFormat: ImageOutputFormat | null =
    sourceFormat === "png"
      ? "png"
      : sourceFormat === "jpeg"
        ? "jpeg"
        : sourceFormat === "webp"
          ? "webp"
          : sourceFormat === "avif" || sourceFormat === "heif"
            ? "avif"
            : sourceFormat === "tiff"
              ? "tiff"
              : sourceFormat === "gif"
                ? "gif"
                : null;
  if (!fallbackFormat) {
    throw new AppError(
      "この画像形式ではメタデータだけを安全に削除できません。出力形式を選んで変換してください。",
      422,
      "METADATA_ONLY_UNSUPPORTED",
    );
  }
  return encodeImage({
    ...options,
    outputFormat: fallbackFormat,
    encoding:
      fallbackFormat === "jpeg" || fallbackFormat === "gif" ? "lossy" : "lossless",
    enhancements: undefined,
    ai: undefined,
  });
}

function hasEnhancementChanges(options: ImageEnhancementOptions | undefined) {
  return Boolean(
    options &&
    (options.sharpen ||
      options.denoise > 0 ||
      options.brightness !== 1 ||
      options.contrast !== 1 ||
      options.saturation !== 1 ||
      options.gamma !== 1 ||
      options.normalizeColorSpace === true),
  );
}

function assertModeCompatibility(options: ImageProcessOptions) {
  if (!isStrictLosslessProcessingMode(options.processingMode)) return;
  if (hasEnhancementChanges(options.enhancements) || options.ai?.enabled) {
    throw new AppError(
      "無劣化モードでは画質補正やAI高画質化を使用できません。",
      400,
      "LOSSLESS_SETTINGS_CONFLICT",
    );
  }
  const losslessOutput =
    options.outputFormat === "png" ||
    options.outputFormat === "tiff" ||
    ((options.outputFormat === "webp" || options.outputFormat === "avif") &&
      options.encoding === "lossless");
  if (!losslessOutput) {
    throw new AppError(
      "無劣化モードではPNG・TIFF・WebP lossless・AVIF losslessだけを選択できます。",
      400,
      "LOSSLESS_OUTPUT_REQUIRED",
    );
  }
}

async function assertImageOutputAvailable(format: ImageOutputFormat) {
  const capabilities = await getRuntimeCapabilities();
  if (!capabilities.outputs.image.includes(format)) {
    throw new AppError(
      `${format.toUpperCase()}出力は、このSharp/libvipsでは利用できません。`,
      422,
      "IMAGE_OUTPUT_UNAVAILABLE",
    );
  }
}

async function encodeImage(
  options: ImageProcessOptions,
  knownSourceMetadata?: SharpImageMetadata,
) {
  assertNotCancelled(options.signal);
  options.onProgress?.(22, "出力形式の対応状況を確認中", "analyzing");
  assertModeCompatibility(options);
  await assertImageOutputAvailable(options.outputFormat);
  const output = IMAGE_OUTPUT_DETAILS[options.outputFormat];
  const outputName = optimizedName(output.extension);
  const outputPath = join(/*turbopackIgnore: true*/ options.directory, outputName);
  const sourceMetadata =
    knownSourceMetadata ?? (await getSharpImageMetadata(options.inputPath));
  options.onProgress?.(
    32,
    options.ai?.enabled ? "AI高画質化の準備中" : "画像補正を準備中",
    options.ai?.enabled ? "enhancing" : "processing",
  );
  const hasAlpha = sourceMetadata.hasAlpha === true;
  const warnings: string[] = [];
  const animated = (sourceMetadata.pages ?? 1) > 1;
  if (animated && options.outputFormat !== "gif" && options.outputFormat !== "webp") {
    throw new AppError(
      "アニメーションを保持できる出力としてGIFまたはWebPを選択してください。",
      422,
      "ANIMATED_OUTPUT_UNSUPPORTED",
    );
  }
  if (animated && options.ai?.enabled) {
    throw new AppError(
      "MVPのAI高画質化は静止画だけに対応しています。",
      422,
      "AI_ANIMATION_UNSUPPORTED",
    );
  }

  let aiInputPath: string | undefined;
  let aiOutputPath: string | undefined;
  try {
    if (options.ai?.enabled) {
      const width = sourceMetadata.width ?? 0;
      const height = sourceMetadata.pageHeight ?? sourceMetadata.height ?? 0;
      const capabilities = await getRuntimeCapabilities();
      const inputLimit = capabilities.ai.gpu
        ? MAX_AI_IMAGE_INPUT_PIXELS_GPU
        : MAX_AI_IMAGE_INPUT_PIXELS_CPU;
      if (width * height > inputLimit) {
        throw new AppError(
          `AI画像処理の入力上限（${Math.round(inputLimit / 1_000_000)}MP）を超えています。`,
          413,
          "AI_IMAGE_TOO_LARGE",
        );
      }
      if (
        width * height * options.ai.scale * options.ai.scale >
        MAX_AI_IMAGE_OUTPUT_PIXELS
      ) {
        throw new AppError(
          "AI処理後の予測画素数が上限を超えています。2倍を選ぶか画像を小さくしてください。",
          413,
          "AI_OUTPUT_TOO_LARGE",
        );
      }
      aiInputPath = join(/*turbopackIgnore: true*/ options.directory, "ai-source.png");
      aiOutputPath = join(/*turbopackIgnore: true*/ options.directory, "ai-enhanced.png");
      await prepareSharpAiInput(
        options.inputPath,
        aiInputPath,
        options.enhancements,
        sourceMetadata,
        warnings,
      );
      assertNotCancelled(options.signal);
      options.onProgress?.(44, "AIモデルを読み込み、高画質化しています", "enhancing");
      await runQueuedAiJob(
        () =>
          runRealEsrgan({
            inputPath: aiInputPath as string,
            outputPath: aiOutputPath as string,
            options: options.ai as ImageAiOptions,
            signal: options.signal,
          }),
        options.signal,
      );
      options.onProgress?.(74, "AI高画質化した画像を最適化中", "enhancing");
      warnings.push(
        "AI高画質化では、元画像に存在しない細部が推定・生成される場合があります。",
      );
    }

    assertNotCancelled(options.signal);
    options.onProgress?.(
      options.ai?.enabled ? 78 : 46,
      `${(sourceMetadata.format ?? "画像").toUpperCase()}から${options.outputFormat.toUpperCase()}へ変換しています`,
      "encoding",
    );
    await encodeImageWithSharp({
      inputPath: options.ai?.enabled ? (aiOutputPath as string) : options.inputPath,
      outputPath,
      outputFormat: options.outputFormat,
      encoding: options.encoding,
      quality: options.quality,
      maxDimension: options.maxDimension,
      jpegBackgroundColor: options.jpegBackgroundColor,
      enhancements: options.ai?.enabled ? undefined : options.enhancements,
      warnings,
      sourceMetadata: options.ai?.enabled ? undefined : sourceMetadata,
      speedPreset: options.speedPreset,
    });
    options.onProgress?.(84, "出力画像を生成しました", "finalizing");
  } finally {
    if (aiInputPath) await unlink(aiInputPath).catch(() => undefined);
    if (aiOutputPath) await unlink(aiOutputPath).catch(() => undefined);
  }

  if (sourceMetadata.format === "jpeg" && options.outputFormat === "png") {
    warnings.push("JPEGからPNGへの変換は、ファイルサイズが増える場合があります。");
  }

  const effectiveEncoding: ImageEncoding =
    options.outputFormat === "png" || options.outputFormat === "tiff"
      ? "lossless"
      : options.outputFormat === "jpeg" || options.outputFormat === "gif"
        ? "lossy"
        : options.encoding;
  const usesQuality =
    options.outputFormat === "jpeg" ||
    ((options.outputFormat === "webp" || options.outputFormat === "avif") &&
      effectiveEncoding === "lossy");

  const previewName = `${parse(outputName).name}-preview.webp`;
  assertNotCancelled(options.signal);
  options.onProgress?.(89, "比較用プレビューを生成中", "finalizing");
  await createSharpPreview(
    outputPath,
    join(/*turbopackIgnore: true*/ options.directory, previewName),
  );
  const outputMetadata = await getSharpImageMetadata(outputPath);
  const actualFormat =
    outputMetadata.format === "heif" && options.outputFormat === "avif"
      ? "avif"
      : outputMetadata.format;
  if (actualFormat !== options.outputFormat) {
    throw new AppError(
      "出力画像の内容と選択した形式が一致しないため、ダウンロードを中止しました。",
      422,
      "OUTPUT_FORMAT_MISMATCH",
    );
  }

  return {
    outputName,
    outputMime: output.mime,
    outputFormat: options.outputFormat,
    encoding: effectiveEncoding,
    quality: usesQuality ? options.quality : null,
    hasAlpha,
    warnings,
    previewName,
    before: {
      format: sourceMetadata.format ?? "unknown",
      width: sourceMetadata.width ?? null,
      height: sourceMetadata.pageHeight ?? sourceMetadata.height ?? null,
      pages: sourceMetadata.pages ?? 1,
    },
    after: {
      format: outputMetadata.format ?? options.outputFormat,
      width: outputMetadata.width ?? null,
      height: outputMetadata.pageHeight ?? outputMetadata.height ?? null,
      pages: outputMetadata.pages ?? 1,
    },
  };
}

export async function processImage(options: ImageProcessOptions) {
  const timer = createProcessingTimer({ jobId: options.jobId });
  try {
    assertNotCancelled(options.signal);
    options.onProgress?.(4, "画像ファイルを確認中", "analyzing");
    const metadata = await timer.measure("image-metadata-analysis", () =>
      inspectImageMetadata(options.inputPath),
    );
    options.onProgress?.(13, "EXIF・GPS・XMPを解析しました", "analyzing");
    const sourceMetadata = await timer.measure("image-header-decode", () =>
      getSharpImageMetadata(options.inputPath),
    );
    assertNotCancelled(options.signal);
    if (options.operation === "metadata-only") {
      options.onProgress?.(36, "画像の向きを反映してメタデータを削除中", "processing");
    }
    const processed =
      options.operation === "metadata-only"
        ? await processMetadataOnly(
            options,
            sourceMetadata.format ?? "unknown",
            sourceMetadata.orientation,
          )
        : await timer.measure("image-decode-filter-encode", () =>
            runScheduledProcessingJob(
              "image",
              () => encodeImage(options, sourceMetadata),
              options.signal,
            ),
          );
    options.onProgress?.(87, "出力ファイルを検証中", "finalizing");
    const outputPath = join(
      /*turbopackIgnore: true*/ options.directory,
      processed.outputName,
    );
    const outputMetadata =
      "after" in processed
        ? null
        : await timer.measure("image-output-validation", () =>
            getSharpImageMetadata(outputPath),
          );
    let previewName: string;
    if ("previewName" in processed) {
      previewName = processed.previewName;
    } else {
      previewName = `${parse(processed.outputName).name}-preview.webp`;
      options.onProgress?.(91, "比較用プレビューを生成中", "finalizing");
      await createSharpPreview(
        outputPath,
        join(/*turbopackIgnore: true*/ options.directory, previewName),
      );
    }
    const metadataAfter = await timer.measure("image-output-metadata", () =>
      inspectImageMetadata(outputPath),
    );
    assertNotCancelled(options.signal);
    options.onProgress?.(98, "ダウンロードを準備中", "finalizing");

    return {
      ...processed,
      previewName,
      metadata,
      metadataAfter,
      removedMetadataTypes: metadata.types,
      before:
        "before" in processed
          ? processed.before
          : {
              format: sourceMetadata.format ?? "unknown",
              width: sourceMetadata.width ?? null,
              height: sourceMetadata.pageHeight ?? sourceMetadata.height ?? null,
              pages: sourceMetadata.pages ?? 1,
            },
      after:
        "after" in processed
          ? processed.after
          : {
              format: outputMetadata?.format ?? processed.outputFormat,
              width: outputMetadata?.width ?? null,
              height: outputMetadata?.pageHeight ?? outputMetadata?.height ?? null,
              pages: outputMetadata?.pages ?? 1,
            },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error({
      stage: "image-processing",
      errorCode: "IMAGE_PROCESS_FAILED",
    });
    throw new AppError(
      "画像を変換できませんでした。ファイルが破損していないか、選択した出力形式に対応しているか確認してください。",
      422,
      "IMAGE_PROCESS_FAILED",
    );
  } finally {
    timer.finish("image-total-processing");
  }
}
