import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import {
  findMaximumImageQuality,
  type ImageQualityEvaluation,
} from "@/features/target-size/domain/image-quality-search";
import { AppError } from "@/lib/errors";
import { normalizeProcessingSpeedPreset } from "@/lib/processing/types";

import {
  createTargetSizeResult,
  resolveRequestedTargetBytes,
  targetNeedsReduction,
} from "./calculations";
import { TARGET_SIZE_LIMITS } from "./config";

import type {
  TargetSizeOptions,
  TargetSizeRecommendationData,
  TargetSizeResult,
} from "./types";

export type TargetImageFormat = "png" | "jpeg" | "webp" | "avif";
export type TargetImageEncoding = "original" | "lossless" | "lossy";

export interface TargetImageAttempt {
  id: string;
  attempt: number;
  format: TargetImageFormat;
  encoding: TargetImageEncoding;
  quality: number | null;
  size: number;
  decoded: boolean;
  withinTarget: boolean;
  smallerThanOriginal: boolean;
  selected: boolean;
  reason: string;
}

export interface TargetImageCandidate extends TargetImageAttempt {
  kind: "original" | "lossless" | "quality-search";
}

export interface ImageTargetProgressDetails {
  attempt: number;
  maximumAttempts: number;
  format?: TargetImageFormat;
  quality?: number | null;
  bytes?: number;
}

export interface OptimizeImageToTargetSizeInput {
  inputPath: string;
  directory: string;
  originalName?: string;
  options: TargetSizeOptions;
  outputFormat?: TargetImageFormat;
  signal?: AbortSignal;
  onProgress?: (
    progress: number,
    stage: string,
    details: ImageTargetProgressDetails,
  ) => void;
}

export interface OptimizeImageToTargetSizeResult {
  selectedOutputPath: string;
  outputName: string;
  report: TargetSizeResult;
  attempts: TargetImageAttempt[];
  candidates: TargetImageCandidate[];
}

interface CandidateArtifact {
  path: string;
  candidate: TargetImageCandidate;
  width: number;
  height: number;
}

interface CandidateQualityEvaluation extends ImageQualityEvaluation {
  artifact: CandidateArtifact;
}

const FORMAT_EXTENSION: Record<TargetImageFormat, string> = {
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  avif: ".avif",
};

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AppError("目標容量への画像処理をキャンセルしました。", 499, "CANCELLED");
  }
}

function safeMaximumAttempts(speedPreset: TargetSizeOptions["speedPreset"]) {
  const configured = TARGET_SIZE_LIMITS.imageMaxAttempts;
  const maximum = Number.isFinite(configured)
    ? Math.min(20, Math.max(1, Math.floor(configured)))
    : 8;
  const speed = normalizeProcessingSpeedPreset(speedPreset);
  return speed === "fast" ? Math.min(5, maximum) : maximum;
}

function safeToleranceRatio() {
  const configured = TARGET_SIZE_LIMITS.imageToleranceRatio;
  return Number.isFinite(configured) ? Math.min(0.25, Math.max(0, configured)) : 0.02;
}

function qualityFloor(
  format: Exclude<TargetImageFormat, "png">,
  options: TargetSizeOptions,
) {
  return Math.min(100, Math.max(1, options.minimumQuality[format]));
}

async function verifyDecodedImage(buffer: Buffer) {
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Decoded image dimensions are missing");
  }
  await sharp(buffer, { failOn: "error", sequentialRead: true })
    .ensureAlpha()
    .raw()
    .toBuffer();
  return { width: metadata.width, height: metadata.height };
}

async function encodeCandidate(options: {
  source: Buffer;
  format: TargetImageFormat;
  encoding: Exclude<TargetImageEncoding, "original">;
  quality: number | null;
  background: string | null;
  hasAlpha: boolean;
  speedPreset?: TargetSizeOptions["speedPreset"];
}) {
  const speed = normalizeProcessingSpeedPreset(options.speedPreset);
  let pipeline = sharp(options.source, { failOn: "error", sequentialRead: true })
    .autoOrient()
    .keepIccProfile();
  if (options.format === "jpeg") {
    if (options.hasAlpha) {
      if (!options.background || !/^#[0-9a-f]{6}$/i.test(options.background)) {
        throw new AppError(
          "透過画像をJPEGにするには有効な背景色を指定してください。",
          400,
          "JPEG_BACKGROUND_REQUIRED",
        );
      }
      pipeline = pipeline.flatten({ background: options.background });
    }
    return pipeline
      .jpeg({
        quality: options.quality ?? 100,
        mozjpeg: speed !== "fast",
        chromaSubsampling: (options.quality ?? 100) >= 90 ? "4:4:4" : "4:2:0",
      })
      .toBuffer();
  }
  if (options.format === "webp") {
    return pipeline
      .webp(
        options.encoding === "lossless"
          ? { lossless: true, effort: speed === "fast" ? 3 : 6 }
          : {
              lossless: false,
              quality: options.quality ?? 100,
              effort: speed === "fast" ? 3 : 6,
            },
      )
      .toBuffer();
  }
  if (options.format === "avif") {
    return pipeline
      .avif(
        options.encoding === "lossless"
          ? {
              lossless: true,
              effort: speed === "fast" ? 3 : speed === "maximum-compression" ? 8 : 7,
            }
          : {
              lossless: false,
              quality: options.quality ?? 100,
              effort: speed === "fast" ? 3 : speed === "maximum-compression" ? 8 : 6,
            },
      )
      .toBuffer();
  }
  return pipeline
    .png({
      compressionLevel: speed === "fast" ? 6 : 9,
      adaptiveFiltering: true,
      palette: false,
    })
    .toBuffer();
}

function lossySearchFormat(
  requested: TargetImageFormat | undefined,
  sourceFormat: string,
) {
  if (requested && requested !== "png") return requested;
  if (sourceFormat === "jpeg" || sourceFormat === "webp" || sourceFormat === "avif") {
    return sourceFormat;
  }
  return "webp";
}

function recommendation(options: {
  minimumBytes: number;
  selectedFormat: TargetImageFormat;
  allowResolutionChange: boolean;
  pngLossyDisabled: boolean;
}): TargetSizeRecommendationData {
  const alternatives: TargetSizeRecommendationData["alternatives"] = [
    "keep-best-quality",
    "change-target",
  ];
  if (!options.pngLossyDisabled) alternatives.unshift("lower-quality-floor");
  if (options.allowResolutionChange) alternatives.unshift("lower-resolution");
  return {
    minimumAchievableBytes: options.minimumBytes,
    recommendedHeight: null,
    recommendedCodec: options.selectedFormat,
    recommendedAudioKbps: null,
    impact: options.pngLossyDisabled
      ? "PNGの非可逆圧縮が無効なため、現在の可逆候補では目標容量に届きません。"
      : "現在の品質下限では目標容量に届きません。品質下限・解像度・目標値を見直してください。",
    alternatives,
  };
}

export async function optimizeImageToTargetSize(
  input: OptimizeImageToTargetSizeInput,
): Promise<OptimizeImageToTargetSizeResult> {
  assertNotCancelled(input.signal);
  const originalDetails = await stat(input.inputPath);
  if (originalDetails.size === 0) {
    throw new AppError("空の画像は処理できません。", 400, "EMPTY_FILE");
  }
  const targetBytes = resolveRequestedTargetBytes(input.options, originalDetails.size);
  const source = await readFile(/*turbopackIgnore: true*/ input.inputPath);
  const sourceMetadata = await sharp(source, {
    animated: true,
    failOn: "error",
  }).metadata();
  if ((sourceMetadata.pages ?? 1) > 1) {
    throw new AppError(
      "目標容量指定は現在、静止画像に対応しています。",
      422,
      "TARGET_SIZE_ANIMATION_UNSUPPORTED",
    );
  }
  const sourceFormat = sourceMetadata.format ?? "unknown";
  const originalFormat: TargetImageFormat =
    sourceFormat === "jpeg" ||
    sourceFormat === "webp" ||
    sourceFormat === "avif" ||
    sourceFormat === "png"
      ? sourceFormat
      : "png";
  const originalCandidate: TargetImageCandidate = {
    id: "original",
    attempt: 0,
    kind: "original",
    format: originalFormat,
    encoding: "original",
    quality: null,
    size: originalDetails.size,
    decoded: true,
    withinTarget: originalDetails.size <= targetBytes,
    smallerThanOriginal: false,
    selected: false,
    reason: "元ファイルを再エンコードせず保持します。",
  };
  const attempts: TargetImageAttempt[] = [];
  const candidates: TargetImageCandidate[] = [originalCandidate];
  const artifacts: CandidateArtifact[] = [];
  const temporaryPaths = new Set<string>();
  const maximumAttempts = safeMaximumAttempts(input.options.speedPreset);
  const toleranceBytes = Math.max(1, Math.floor(targetBytes * safeToleranceRatio()));
  const reportProgress = (
    stage: string,
    format?: TargetImageFormat,
    quality?: number | null,
    bytes?: number,
  ) => {
    input.onProgress?.(
      Math.min(96, 8 + (attempts.length / maximumAttempts) * 84),
      stage,
      {
        attempt: attempts.length,
        maximumAttempts,
        format,
        quality,
        bytes,
      },
    );
  };
  const addCandidate = async (configuration: {
    format: TargetImageFormat;
    encoding: Exclude<TargetImageEncoding, "original">;
    quality: number | null;
    kind: Exclude<TargetImageCandidate["kind"], "original">;
  }) => {
    if (attempts.length >= maximumAttempts) return null;
    assertNotCancelled(input.signal);
    reportProgress(
      `${configuration.format.toUpperCase()}候補を生成中`,
      configuration.format,
      configuration.quality,
    );
    const attemptNumber = attempts.length + 1;
    const outputPath = join(
      /*turbopackIgnore: true*/ input.directory,
      `target-image-${attemptNumber}${FORMAT_EXTENSION[configuration.format]}`,
    );
    temporaryPaths.add(outputPath);
    const buffer = await encodeCandidate({
      source,
      format: configuration.format,
      encoding: configuration.encoding,
      quality: configuration.quality,
      background: input.options.jpegBackground,
      hasAlpha: sourceMetadata.hasAlpha === true,
      speedPreset: input.options.speedPreset,
    });
    const decoded = await verifyDecodedImage(buffer);
    await writeFile(outputPath, buffer);
    const withinTarget = buffer.length <= targetBytes;
    const smallerThanOriginal = buffer.length < originalDetails.size;
    const candidate: TargetImageCandidate = {
      id: `attempt-${attemptNumber}`,
      attempt: attemptNumber,
      kind: configuration.kind,
      format: configuration.format,
      encoding: configuration.encoding,
      quality: configuration.quality,
      size: buffer.length,
      decoded: true,
      withinTarget,
      smallerThanOriginal,
      selected: false,
      reason: !smallerThanOriginal
        ? "元ファイル以上の容量になるため採用しません。"
        : withinTarget
          ? "デコード検証に成功し、目標容量以下です。"
          : "デコード検証には成功しましたが、目標容量を超えています。",
    };
    attempts.push(candidate);
    candidates.push(candidate);
    const artifact = {
      path: outputPath,
      candidate,
      width: decoded.width,
      height: decoded.height,
    };
    artifacts.push(artifact);
    reportProgress(
      withinTarget ? "目標容量以下の候補を確認" : "候補容量を確認",
      configuration.format,
      configuration.quality,
      buffer.length,
    );
    return artifact;
  };

  const finishResult = async (selected: CandidateArtifact | null, reason: string) => {
    const selectedPath = selected?.path ?? input.inputPath;
    const selectedCandidate = selected?.candidate ?? originalCandidate;
    selectedCandidate.selected = true;
    const actualBytes = selectedCandidate.size;
    const achieved = actualBytes <= targetBytes;
    const validGenerated = artifacts.filter(
      (artifact) => artifact.candidate.decoded && artifact.candidate.smallerThanOriginal,
    );
    const minimumBytes = Math.min(
      originalDetails.size,
      ...validGenerated.map((artifact) => artifact.candidate.size),
    );
    const imageRecommendation = achieved
      ? undefined
      : recommendation({
          minimumBytes,
          selectedFormat: selectedCandidate.format,
          allowResolutionChange: input.options.allowResolutionChange,
          pngLossyDisabled: sourceFormat === "png" && !input.options.allowLossyForPng,
        });
    const selectedResolution = selected
      ? `${selected.width}x${selected.height}`
      : `${sourceMetadata.width ?? 0}x${sourceMetadata.height ?? 0}`;
    const report = createTargetSizeResult({
      requestedBytes: targetBytes,
      actualBytes,
      originalBytes: originalDetails.size,
      attempts: attempts.length,
      selectedQuality: selectedCandidate.quality,
      selectedResolution,
      selectedCodec: selectedCandidate.format,
      reason,
      recommendation: imageRecommendation,
    });
    const stem = "target-image";
    const outputName = `${stem}-target${FORMAT_EXTENSION[selectedCandidate.format]}`;
    await Promise.allSettled(
      [...temporaryPaths]
        .filter((path) => path !== selectedPath)
        .map((path) => unlink(path)),
    );
    reportProgress(achieved ? "目標容量を達成しました" : "最小候補を確認しました");
    return {
      selectedOutputPath: selectedPath,
      outputName,
      report,
      attempts,
      candidates,
    } satisfies OptimizeImageToTargetSizeResult;
  };

  try {
    if (!targetNeedsReduction(originalDetails.size, targetBytes)) {
      return await finishResult(null, "目標容量は元ファイル以上のため、圧縮は不要です。");
    }
    if (
      input.outputFormat === "jpeg" &&
      sourceMetadata.hasAlpha === true &&
      (!input.options.jpegBackground ||
        !/^#[0-9a-f]{6}$/i.test(input.options.jpegBackground))
    ) {
      throw new AppError(
        "透過画像をJPEGにするには有効な背景色を指定してください。",
        400,
        "JPEG_BACKGROUND_REQUIRED",
      );
    }

    if (sourceFormat === "png") {
      const losslessFormats: TargetImageFormat[] = ["png", "webp", "avif"];
      for (const format of losslessFormats) {
        const candidate = await addCandidate({
          format,
          encoding: "lossless",
          quality: null,
          kind: "lossless",
        });
        if (
          candidate?.candidate.withinTarget &&
          candidate.candidate.smallerThanOriginal
        ) {
          return await finishResult(
            candidate,
            `${format.toUpperCase()}可逆圧縮で目標容量を達成しました。`,
          );
        }
      }
      if (!input.options.allowLossyForPng) {
        const smallestLossless = artifacts
          .filter((artifact) => artifact.candidate.smallerThanOriginal)
          .sort((left, right) => left.candidate.size - right.candidate.size)[0];
        return await finishResult(
          smallestLossless ?? null,
          "可逆圧縮だけでは目標容量を達成できませんでした。非可逆圧縮を許可するか、目標容量を変更してください。",
        );
      }
    } else if (input.outputFormat === "png") {
      const lossless = await addCandidate({
        format: "png",
        encoding: "lossless",
        quality: null,
        kind: "lossless",
      });
      if (lossless?.candidate.withinTarget && lossless.candidate.smallerThanOriginal) {
        return await finishResult(lossless, "PNG可逆圧縮で目標容量を達成しました。");
      }
    }

    const format = lossySearchFormat(input.outputFormat, sourceFormat);
    if (
      format === "jpeg" &&
      sourceMetadata.hasAlpha === true &&
      (!input.options.jpegBackground ||
        !/^#[0-9a-f]{6}$/i.test(input.options.jpegBackground))
    ) {
      throw new AppError(
        "透過画像をJPEGにするには有効な背景色を指定してください。",
        400,
        "JPEG_BACKGROUND_REQUIRED",
      );
    }
    const minimumQuality = qualityFloor(format, input.options);
    const minimum = await addCandidate({
      format,
      encoding: "lossy",
      quality: minimumQuality,
      kind: "quality-search",
    });
    if (!minimum) {
      return await finishResult(
        null,
        "試行回数の上限に達したため、元ファイルを保持しました。",
      );
    }
    if (!minimum.candidate.withinTarget) {
      return await finishResult(
        minimum.candidate.smallerThanOriginal ? minimum : null,
        `最低品質${minimumQuality}でも目標容量を達成できませんでした。成功扱いにはしていません。`,
      );
    }

    let best = minimum;
    if (attempts.length < maximumAttempts) {
      const maximum = await addCandidate({
        format,
        encoding: "lossy",
        quality: 100,
        kind: "quality-search",
      });
      if (maximum?.candidate.withinTarget && maximum.candidate.smallerThanOriginal) {
        return await finishResult(maximum, "品質100で目標容量を達成しました。");
      }
    }
    const initialEvaluation: CandidateQualityEvaluation = {
      quality: minimumQuality,
      outputBytes: minimum.candidate.size,
      isWithinTarget: minimum.candidate.withinTarget,
      isSmallerThanOriginal: minimum.candidate.smallerThanOriginal,
      artifact: minimum,
    };
    const search = await findMaximumImageQuality({
      minimumQuality: minimumQuality + 1,
      maximumQuality: 99,
      maximumAttempts: maximumAttempts - attempts.length,
      targetSizeBytes: targetBytes,
      toleranceBytes,
      initialBest: initialEvaluation,
      evaluateQuality: async (quality) => {
        assertNotCancelled(input.signal);
        const candidate = await addCandidate({
          format,
          encoding: "lossy",
          quality,
          kind: "quality-search",
        });
        return candidate
          ? {
              quality,
              outputBytes: candidate.candidate.size,
              isWithinTarget: candidate.candidate.withinTarget,
              isSmallerThanOriginal: candidate.candidate.smallerThanOriginal,
              artifact: candidate,
            }
          : null;
      },
    });
    best = search.bestEvaluation.artifact;
    return await finishResult(
      best,
      `目標容量以下で確認できた最高品質${best.candidate.quality}を採用しました。`,
    );
  } catch (error) {
    await Promise.allSettled([...temporaryPaths].map((path) => unlink(path)));
    throw error;
  }
}
