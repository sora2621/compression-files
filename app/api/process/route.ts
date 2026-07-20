import { copyFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { MAX_REQUEST_BYTES, MAX_VIDEO_BYTES } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import {
  finishProcessingJob,
  registerProcessingJob,
  updateProcessingJob,
} from "@/lib/jobs/job-registry";
import { runScheduledProcessingJob } from "@/lib/jobs/processing-scheduler";
import { processImage } from "@/lib/media/image";
import {
  DEFAULT_IMAGE_AI_OPTIONS,
  DEFAULT_IMAGE_ENHANCEMENTS,
  DEFAULT_IMAGE_OUTPUT_SETTINGS,
  type ImageOperation,
  isImageAiOptions,
  isImageEncoding,
  isImageEnhancementOptions,
  isImageOutputFormat,
  isProcessingMode,
  normalizeImageQuality,
} from "@/lib/media/image-types";
import { inspectImageMetadata } from "@/lib/media/metadata";
import { optimizeLosslessImage } from "@/lib/optimization/image-lossless";
import {
  DEFAULT_LOSSLESS_IMAGE_OPTIONS,
  isLosslessImageOptions,
  type OptimizationReport,
} from "@/lib/optimization/types";
import {
  isProcessingSpeedPreset,
  type ProcessingSpeedPreset,
} from "@/lib/processing/types";
import { normalizeRetentionMinutes } from "@/lib/retention";
import {
  cleanupExpiredJobs,
  createJob,
  prepareDownloadOutput,
  removeJob,
  scheduleJobCleanup,
  writeManifest,
  writeUpload,
} from "@/lib/storage/temp-storage";
import { optimizeImageToTargetSize } from "@/lib/target-size/image-target";
import { isTargetSizeOptions, type TargetSizeResult } from "@/lib/target-size/types";
import { validateUploadedFile } from "@/lib/validation/file-validation";
import { normalizeOutputExtension, sanitizeDownloadFileName } from "@/shared/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const operations = new Set<ImageOperation>(["convert", "metadata-only"]);

export async function POST(request: Request) {
  void cleanupExpiredJobs().catch(() => undefined);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: "アップロード全体の上限（250MB）を超えています。",
        code: "REQUEST_TOO_LARGE",
      },
      { status: 413 },
    );
  }

  let job: Awaited<ReturnType<typeof createJob>> | undefined;
  let inputPath: string | undefined;
  let normalizedInputPath: string | undefined;
  let originalPreviewName: string | undefined;
  let processingJobId: string | undefined;

  try {
    const formData = await request.formData();
    const retentionMinutes = normalizeRetentionMinutes(formData.get("retentionMinutes"));
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new AppError("ファイルが選択されていません。", 400, "FILE_REQUIRED");
    }
    if (file.size === 0) {
      throw new AppError("空のファイルは処理できません。", 400, "EMPTY_FILE");
    }
    if (file.size > MAX_VIDEO_BYTES) {
      throw new AppError("ファイル上限（250MB）を超えています。", 413, "FILE_TOO_LARGE");
    }

    const requestedMode = formData.get("processingMode");
    if (requestedMode !== null && !isProcessingMode(requestedMode)) {
      throw new AppError("処理モードが無効です。", 400, "INVALID_PROCESSING_MODE");
    }
    const requestedOperation = formData.get("operation");
    let operation =
      requestedOperation === "webp"
        ? "convert"
        : operations.has(requestedOperation as ImageOperation)
          ? (requestedOperation as ImageOperation)
          : "convert";
    const processingMode =
      requestedMode ?? (operation === "metadata-only" ? "metadata-only" : "reduce-size");
    if (processingMode === "metadata-only") operation = "metadata-only";
    const requestedSpeedPreset = formData.get("speedPreset");
    if (requestedSpeedPreset !== null && !isProcessingSpeedPreset(requestedSpeedPreset)) {
      throw new AppError("速度設定が無効です。", 400, "INVALID_SPEED_PRESET");
    }
    const speedPreset: ProcessingSpeedPreset = requestedSpeedPreset ?? "balanced";

    const parseJsonSetting = (name: string) => {
      const raw = formData.get(name);
      if (raw === null) return null;
      if (typeof raw !== "string") {
        throw new AppError(`${name}設定が無効です。`, 400, "INVALID_SETTINGS");
      }
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new AppError(`${name}設定を読み取れません。`, 400, "INVALID_SETTINGS");
      }
    };
    const requestedEnhancements = parseJsonSetting("enhancements");
    if (
      requestedEnhancements !== null &&
      !isImageEnhancementOptions(requestedEnhancements)
    ) {
      throw new AppError("画像補正設定が無効です。", 400, "INVALID_ENHANCEMENTS");
    }
    const enhancements =
      processingMode === "convert-only" || processingMode === "metadata-only"
        ? { ...DEFAULT_IMAGE_ENHANCEMENTS, normalizeColorSpace: false }
        : (requestedEnhancements ?? DEFAULT_IMAGE_ENHANCEMENTS);
    const requestedAi = parseJsonSetting("ai");
    const normalizedAi =
      requestedAi && typeof requestedAi === "object"
        ? { ...DEFAULT_IMAGE_AI_OPTIONS, ...requestedAi }
        : requestedAi;
    if (normalizedAi !== null && !isImageAiOptions(normalizedAi)) {
      throw new AppError("AI高画質化設定が無効です。", 400, "INVALID_AI_OPTIONS");
    }
    const ai =
      processingMode === "convert-only" || processingMode === "metadata-only"
        ? { ...DEFAULT_IMAGE_AI_OPTIONS, enabled: false }
        : (normalizedAi ?? DEFAULT_IMAGE_AI_OPTIONS);
    const requestedLosslessOptions = parseJsonSetting("losslessOptions");
    if (
      requestedLosslessOptions !== null &&
      !isLosslessImageOptions(requestedLosslessOptions)
    ) {
      throw new AppError(
        "完全無劣化の候補設定が無効です。",
        400,
        "INVALID_LOSSLESS_OPTIONS",
      );
    }
    const losslessOptions = requestedLosslessOptions ?? DEFAULT_LOSSLESS_IMAGE_OPTIONS;
    const requestedTargetSizeOptions = parseJsonSetting("targetSizeOptions");
    if (
      requestedTargetSizeOptions !== null &&
      !isTargetSizeOptions(requestedTargetSizeOptions)
    ) {
      throw new AppError(
        "目標容量の設定が無効です。",
        400,
        "INVALID_TARGET_SIZE_OPTIONS",
      );
    }
    if (
      processingMode === "target-size" &&
      (!requestedTargetSizeOptions || !requestedTargetSizeOptions.enabled)
    ) {
      throw new AppError(
        "目標容量モードの容量を指定してください。",
        400,
        "TARGET_SIZE_REQUIRED",
      );
    }

    const requestedFormat = formData.get("outputFormat");
    if (requestedFormat !== null && !isImageOutputFormat(requestedFormat)) {
      throw new AppError(
        "出力形式が無効です。実行環境で利用可能な画像形式から選択してください。",
        400,
        "INVALID_OUTPUT_FORMAT",
      );
    }
    const outputFormat =
      requestedFormat === null ? DEFAULT_IMAGE_OUTPUT_SETTINGS.format : requestedFormat;

    const requestedEncoding = formData.get("encoding");
    if (requestedEncoding !== null && !isImageEncoding(requestedEncoding)) {
      throw new AppError(
        "圧縮方式が無効です。losslessまたはlossyを選択してください。",
        400,
        "INVALID_ENCODING",
      );
    }
    const encoding =
      requestedEncoding === null
        ? DEFAULT_IMAGE_OUTPUT_SETTINGS.encoding
        : requestedEncoding;

    const requestedQuality = formData.get("quality");
    const quality =
      requestedQuality === null
        ? DEFAULT_IMAGE_OUTPUT_SETTINGS.quality
        : normalizeImageQuality(requestedQuality);
    if (quality === null) {
      throw new AppError(
        "品質は1〜100の整数で指定してください。",
        400,
        "INVALID_QUALITY",
      );
    }
    const requestedImageMaxDimension = formData.get("imageMaxDimension");
    const imageMaxDimension =
      requestedImageMaxDimension === null ? null : Number(requestedImageMaxDimension);
    if (
      imageMaxDimension !== null &&
      (!Number.isInteger(imageMaxDimension) ||
        imageMaxDimension < 320 ||
        imageMaxDimension > 10_000)
    ) {
      throw new AppError(
        "画像の長辺は320〜10000pxで指定してください。",
        400,
        "INVALID_IMAGE_RESOLUTION",
      );
    }
    const requestedBackgroundColor = formData.get("jpegBackgroundColor");
    const jpegBackgroundColor =
      requestedBackgroundColor === null
        ? (DEFAULT_IMAGE_OUTPUT_SETTINGS.jpegBackgroundColor ?? "#ffffff")
        : requestedBackgroundColor;
    if (
      typeof jpegBackgroundColor !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(jpegBackgroundColor)
    ) {
      throw new AppError(
        "JPEG背景色は#RRGGBB形式で指定してください。",
        400,
        "INVALID_JPEG_BACKGROUND",
      );
    }

    const requestedJobId = formData.get("jobId");
    if (requestedJobId !== null && typeof requestedJobId !== "string") {
      throw new AppError("処理ジョブIDが無効です。", 400, "INVALID_JOB_ID");
    }
    const originalName = sanitizeDownloadFileName(file.name, "upload");
    job = await createJob(requestedJobId ?? undefined);
    processingJobId = job.jobId;
    const signal = registerProcessingJob(
      job.jobId,
      ai.enabled ? "ai-image" : "image",
      job.directory,
      {
        fileId: requestedJobId ?? job.jobId,
        fileName: originalName,
        originalSize: file.size,
        media: {
          outputFormat,
          aiScale: ai.enabled ? ai.scale : undefined,
          metadataRemoved: true,
        },
      },
    );
    updateProcessingJob(job.jobId, {
      progress: 1,
      stage: "アップロードした画像を確認中",
    });
    inputPath = join(/*turbopackIgnore: true*/ job.directory, "source.bin");
    await writeUpload(file, inputPath);
    updateProcessingJob(job.jobId, {
      progress: 3,
      stage: "ファイル内容と形式を確認中",
    });
    const detected = await validateUploadedFile(file, inputPath);
    if (detected.kind !== "image") {
      throw new AppError(
        "画像ファイルではありません。動画・音声はメディア解析から処理してください。",
        415,
        "IMAGE_REQUIRED",
      );
    }
    normalizedInputPath = detected.normalizedInputPath ?? undefined;
    const wasNormalizedByFfmpeg = Boolean(normalizedInputPath);
    try {
      originalPreviewName = "original-preview.webp";
      await sharp(normalizedInputPath ?? inputPath, {
        animated: false,
        failOn: "error",
        limitInputPixels: 40_000_000,
      })
        .autoOrient()
        .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toFile(join(/*turbopackIgnore: true*/ job.directory, originalPreviewName));
    } catch {
      originalPreviewName = undefined;
    }
    updateProcessingJob(job.jobId, {
      progress: 10,
      stage: "画像形式と解像度を確認しました",
      status: "analyzing",
      media: {
        inputFormat: detected.detectedFormat,
        originalWidth: detected.imageInfo.width,
        originalHeight: detected.imageInfo.height,
        outputWidth: detected.imageInfo.width * (ai.enabled ? ai.scale : 1),
        outputHeight: detected.imageInfo.height * (ai.enabled ? ai.scale : 1),
      },
    });

    let optimizationReport: OptimizationReport | undefined;
    let targetSizeResult: TargetSizeResult | undefined;
    let processed: Awaited<ReturnType<typeof processImage>>;
    const advancedLossless =
      processingMode === "strict-lossless" || processingMode === "archive";
    if (processingMode === "target-size" && requestedTargetSizeOptions) {
      const targeted = await runScheduledProcessingJob(
        "image",
        () =>
          optimizeImageToTargetSize({
            inputPath: inputPath!,
            directory: job!.directory,
            originalName,
            options: requestedTargetSizeOptions,
            outputFormat:
              outputFormat === "png" ||
              outputFormat === "jpeg" ||
              outputFormat === "webp" ||
              outputFormat === "avif"
                ? outputFormat
                : "webp",
            maxDimension: imageMaxDimension,
            signal,
            onProgress: (progress, stage, details) => {
              updateProcessingJob(job!.jobId, {
                progress,
                stage: `試行 ${details.attempt}/${details.maximumAttempts} · ${stage}`,
                attempt: details.attempt,
                maxAttempts: details.maximumAttempts,
                currentOutputSize: details.bytes,
                message: stage,
              });
            },
          }),
        signal,
      );
      targetSizeResult = targeted.report;
      const outputPathForTarget = join(
        /*turbopackIgnore: true*/ job.directory,
        targeted.outputName,
      );
      if (targeted.selectedOutputPath !== outputPathForTarget) {
        if (targeted.selectedOutputPath === inputPath) {
          await copyFile(targeted.selectedOutputPath, outputPathForTarget);
        } else {
          await rename(targeted.selectedOutputPath, outputPathForTarget);
        }
      }
      const [before, after, metadata, metadataAfter] = await Promise.all([
        sharp(inputPath).metadata(),
        sharp(outputPathForTarget).metadata(),
        inspectImageMetadata(inputPath),
        inspectImageMetadata(outputPathForTarget),
      ]);
      const targetFormat =
        after.format === "jpeg" ||
        after.format === "png" ||
        after.format === "webp" ||
        after.format === "avif"
          ? after.format
          : "webp";
      const previewName = "preview.webp";
      await sharp(outputPathForTarget, { animated: false, failOn: "error" })
        .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toFile(join(/*turbopackIgnore: true*/ job.directory, previewName));
      processed = {
        outputName: targeted.outputName,
        outputMime: targetFormat === "jpeg" ? "image/jpeg" : `image/${targetFormat}`,
        outputFormat: targetFormat,
        encoding: targeted.report.selectedQuality === null ? "lossless" : "lossy",
        quality: targeted.report.selectedQuality,
        warnings: targeted.report.achieved ? [] : [targeted.report.reason],
        previewName,
        metadata,
        metadataAfter,
        removedMetadataTypes: metadata.types.filter(
          (type) => !metadataAfter.types.includes(type),
        ),
        hasAlpha: after.hasAlpha === true,
        before: {
          format: before.format ?? detected.detectedFormat,
          width: before.width ?? null,
          height: before.height ?? null,
          pages: before.pages ?? 1,
        },
        after: {
          format: after.format ?? targetFormat,
          width: after.width ?? null,
          height: after.height ?? null,
          pages: after.pages ?? 1,
        },
      };
    } else if (
      advancedLossless &&
      (detected.detectedFormat === "png" || detected.detectedFormat === "jpeg")
    ) {
      updateProcessingJob(job.jobId, {
        progress: 18,
        stage: "無劣化候補を生成して画素を検証中",
      });
      const optimized = await runScheduledProcessingJob(
        "image",
        () =>
          optimizeLosslessImage({
            inputPath: inputPath!,
            directory: job!.directory,
            originalName,
            mode: processingMode,
            options: losslessOptions,
            signal,
          }),
        signal,
      );
      optimizationReport = optimized.report;
      const outputPathForAdvanced = join(
        /*turbopackIgnore: true*/ job.directory,
        optimized.selectedOutputName,
      );
      if (optimized.selectedOutputPath !== outputPathForAdvanced) {
        if (optimized.selectedOutputPath === inputPath) {
          await copyFile(optimized.selectedOutputPath, outputPathForAdvanced);
        } else {
          await rename(optimized.selectedOutputPath, outputPathForAdvanced);
        }
      }
      const [before, after, metadata, metadataAfter] = await Promise.all([
        sharp(inputPath).metadata(),
        sharp(outputPathForAdvanced).metadata(),
        inspectImageMetadata(inputPath),
        inspectImageMetadata(outputPathForAdvanced),
      ]);
      let previewName = "preview.webp";
      try {
        await sharp(outputPathForAdvanced, { animated: false, failOn: "error" })
          .autoOrient()
          .resize({
            width: 1_600,
            height: 1_600,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 88, effort: 4 })
          .toFile(join(/*turbopackIgnore: true*/ job.directory, previewName));
      } catch (error) {
        if (originalPreviewName) previewName = originalPreviewName;
        else throw error;
      }
      const normalizedFormat =
        optimizationReport.selectedFormat.toLowerCase() === "jpg"
          ? "jpeg"
          : optimizationReport.selectedFormat.toLowerCase();
      const outputMimeForAdvanced =
        normalizedFormat === "jpeg"
          ? "image/jpeg"
          : normalizedFormat === "jxl"
            ? "image/jxl"
            : `image/${normalizedFormat}`;
      processed = {
        outputName: optimized.selectedOutputName,
        outputMime: outputMimeForAdvanced,
        outputFormat: normalizedFormat as typeof outputFormat,
        encoding: "lossless",
        quality: null,
        warnings: optimized.report.keptOriginal ? [optimized.report.decisionReason] : [],
        previewName,
        metadata,
        metadataAfter,
        removedMetadataTypes: metadata.types.filter(
          (type) => !metadataAfter.types.includes(type),
        ),
        hasAlpha: before.hasAlpha === true,
        before: {
          format: before.format ?? detected.detectedFormat,
          width: before.width ?? null,
          height: before.height ?? null,
          pages: before.pages ?? 1,
        },
        after: {
          format: after.format ?? normalizedFormat,
          width: after.width ?? null,
          height: after.height ?? null,
          pages: after.pages ?? 1,
        },
      };
    } else if (advancedLossless) {
      const outputNameForOriginal = `generated-original-output.${normalizeOutputExtension(
        detected.detectedFormat,
      )}`;
      const outputPathForOriginal = join(
        /*turbopackIgnore: true*/ job.directory,
        outputNameForOriginal,
      );
      await copyFile(inputPath, outputPathForOriginal);
      const [sourceInfo, metadata] = await Promise.all([
        sharp(inputPath).metadata(),
        inspectImageMetadata(inputPath),
      ]);
      optimizationReport = {
        mode: processingMode,
        originalSize: file.size,
        outputSize: file.size,
        reductionPercent: 0,
        selectedCandidateId: "original",
        selectedMethod: "元ファイルを保持",
        selectedFormat: detected.detectedFormat,
        keptOriginal: true,
        decisionReason:
          "この形式には検証可能な追加の可逆最適化方式がないため、元ファイルを保持しました。",
        losslessVerification: {
          status: "passed",
          method: "入力ファイルのバイト列をそのまま複製",
          details: "画素やストリームを変更していません。",
        },
        candidates: [
          {
            id: "original",
            label: "元ファイル",
            method: "original byte copy",
            format: detected.detectedFormat,
            size: file.size,
            status: "selected",
            losslessVerified: true,
            verificationMethod: "バイト列を変更しないコピー",
            reason: "元ファイルより小さい検証済み候補がありません。",
          },
          {
            id: "format-specific-optimizer",
            label: "形式専用の可逆最適化",
            method: "runtime capability check",
            format: detected.detectedFormat,
            size: null,
            status: "unavailable",
            reason: "PNG・JPEG以外は現在の実行環境で追加の可逆候補を検証できません。",
          },
        ],
      };
      processed = {
        outputName: outputNameForOriginal,
        outputMime: detected.mime,
        outputFormat: detected.detectedFormat as typeof outputFormat,
        encoding: "lossless",
        quality: null,
        warnings: [optimizationReport.decisionReason],
        previewName: originalPreviewName ?? "original-preview.webp",
        metadata,
        metadataAfter: metadata,
        removedMetadataTypes: [],
        hasAlpha: sourceInfo.hasAlpha === true,
        before: {
          format: sourceInfo.format ?? detected.detectedFormat,
          width: sourceInfo.width ?? null,
          height: sourceInfo.height ?? null,
          pages: sourceInfo.pages ?? 1,
        },
        after: {
          format: sourceInfo.format ?? detected.detectedFormat,
          width: sourceInfo.width ?? null,
          height: sourceInfo.height ?? null,
          pages: sourceInfo.pages ?? 1,
        },
      };
    } else {
      processed = await processImage({
        inputPath: normalizedInputPath ?? inputPath,
        directory: job.directory,
        originalName,
        mime: detected.mime,
        operation,
        outputFormat,
        encoding,
        quality,
        maxDimension: imageMaxDimension,
        jpegBackgroundColor,
        processingMode,
        enhancements,
        ai,
        speedPreset,
        jobId: job.jobId,
        signal,
        onProgress: (progress, stage, status) => {
          updateProcessingJob(job!.jobId, {
            progress,
            stage,
            status,
            message: stage,
          });
        },
      });
    }

    const generatedOutputPath = join(
      /*turbopackIgnore: true*/ job.directory,
      processed.outputName,
    );
    const preparedOutput = await prepareDownloadOutput(
      job.directory,
      generatedOutputPath,
      originalName,
    );
    const outputDetails = await stat(preparedOutput.internalPath);
    updateProcessingJob(job.jobId, {
      progress: 99,
      stage: "出力ファイルを検証し、ダウンロードを準備中",
      media: {
        outputFormat: processed.outputFormat,
        metadataRemoved: processed.removedMetadataTypes.length > 0,
      },
    });
    const savedBytes = file.size - outputDetails.size;
    const reductionPercent = Number(((savedBytes / file.size) * 100).toFixed(1));

    await writeManifest(job.directory, {
      jobId: job.jobId,
      outputName: preparedOutput.internalName,
      originalName,
      downloadName: preparedOutput.downloadName,
      outputMime: processed.outputMime,
      previewName: processed.previewName,
      previewMime: "image/webp",
      originalPreviewName,
      originalPreviewMime: originalPreviewName ? "image/webp" : undefined,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + retentionMinutes * 60_000).toISOString(),
      optimizationReport,
      targetSizeResult,
    });

    await unlink(inputPath).catch(() => undefined);
    inputPath = undefined;
    if (normalizedInputPath) {
      await unlink(normalizedInputPath).catch(() => undefined);
      normalizedInputPath = undefined;
    }
    scheduleJobCleanup(job.directory, retentionMinutes * 60_000);

    finishProcessingJob(job.jobId, "complete");

    return NextResponse.json({
      jobId: job.jobId,
      kind: "image",
      originalName,
      outputName: preparedOutput.downloadName,
      originalSize: file.size,
      outputSize: outputDetails.size,
      savedBytes,
      reductionPercent,
      outputMime: processed.outputMime,
      outputFormat: processed.outputFormat,
      encoding: "encoding" in processed ? processed.encoding : null,
      quality: "quality" in processed ? processed.quality : null,
      warnings: [
        ...("warnings" in processed ? processed.warnings : []),
        ...(wasNormalizedByFfmpeg
          ? [
              "Sharpで直接読めない入力だったため、FFmpegで安全なPNGへ正規化してから処理しました。",
            ]
          : []),
      ],
      downloadUrl: `/api/files/${job.jobId}`,
      previewUrl: `/api/files/${job.jobId}?preview=1`,
      metadata: processed.metadata,
      metadataAfter: processed.metadataAfter,
      removedMetadataTypes: processed.removedMetadataTypes,
      expiresInMinutes: retentionMinutes,
      processing: ai.enabled ? "real-esrgan" : "sharp",
      optimizationReport,
      targetSizeResult,
      image: {
        before: processed.before,
        after: processed.after,
        processingMode,
      },
    });
  } catch (error) {
    if (inputPath) await unlink(inputPath).catch(() => undefined);
    if (normalizedInputPath) {
      await unlink(normalizedInputPath).catch(() => undefined);
    }
    if (job) await removeJob(job.directory).catch(() => undefined);
    if (processingJobId) {
      finishProcessingJob(
        processingJobId,
        error instanceof AppError && error.code === "CANCELLED" ? "cancelled" : "error",
      );
    }
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
