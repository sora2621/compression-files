import { copyFile, rename, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";

import { after, NextResponse } from "next/server";

import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { errorResponse, AppError } from "@/lib/errors";
import {
  finishProcessingJob,
  registerProcessingJob,
  updateProcessingJob,
} from "@/lib/jobs/job-registry";
import { runScheduledProcessingJob } from "@/lib/jobs/processing-scheduler";
import { processAudio } from "@/lib/media/audio";
import {
  AUDIO_OUTPUT_FORMATS,
  isAudioProcessingOptions,
  type AudioOutputFormat,
  type AudioProcessingOptions,
} from "@/lib/media/audio-types";
import {
  assertAudioOutputMatches,
  assertVideoOutputMatches,
} from "@/lib/media/output-validation";
import { probeAudio, probeVideo, processVideoCompression } from "@/lib/media/video";
import { processVideoAiSuperResolution } from "@/lib/media/video-ai";
import { generateVideoPreview } from "@/lib/media/video-preview";
import {
  isVideoCompressionOptions,
  selectedVideoHeight,
  type VideoCompressionOptions,
  type VideoMediaInfo,
} from "@/lib/media/video-types";
import { videoOptimizationProbeFromInspection } from "@/lib/optimization/inspection-probe";
import {
  DEFAULT_VIDEO_QUALITY_SEARCH,
  DEFAULT_VIDEO_STREAM_SELECTION,
  isAdvancedOptimizationMode,
  isVideoQualitySearchOptions,
  isVideoStreamSelectionOptions,
  type AdvancedOptimizationMode,
  type OptimizationReport,
  type VideoQualitySearchOptions,
  type VideoStreamSelectionOptions,
} from "@/lib/optimization/types";
import { optimizeVideoQuality } from "@/lib/optimization/video-quality";
import { withVideoOutputValidation } from "@/lib/performance/video-performance";
import { normalizeRetentionMinutes } from "@/lib/retention";
import {
  cleanupFailedJobArtifacts,
  getStagedMedia,
  prepareDownloadOutput,
  removeStagedMediaManifest,
  scheduleJobCleanup,
  writeManifest,
  writeProcessResult,
} from "@/lib/storage/temp-storage";
import { targetProbeFromInspection } from "@/lib/target-size/inspection-probe";
import {
  isTargetSizeOptions,
  resolveTargetBytes,
  type TargetSizeOptions,
  type TargetSizeResult,
} from "@/lib/target-size/types";
import {
  optimizeAudioToTargetSize,
  optimizeVideoToTargetSize,
} from "@/lib/target-size/video-target";
import { logger } from "@/shared/logging/logger";

import type { ProcessResult } from "@/features/workspace/types";
import type { FfmpegProgressMetrics, ProgressEventUpdate } from "@/lib/progress/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

interface ProcessRequest {
  uploadId?: unknown;
  options?: unknown;
  retentionMinutes?: unknown;
  optimizationMode?: unknown;
  streamSelection?: unknown;
  qualitySearch?: unknown;
  targetSizeOptions?: unknown;
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  let body: ProcessRequest;
  try {
    body = (await request.json()) as ProcessRequest;
  } catch {
    return NextResponse.json(
      { error: "処理設定を読み取れませんでした。", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (typeof body.uploadId !== "string") {
    return NextResponse.json(
      { error: "アップロードIDがありません。", code: "UPLOAD_ID_REQUIRED" },
      { status: 400 },
    );
  }
  const retentionMinutes = normalizeRetentionMinutes(body.retentionMinutes);
  let optimizationMode: AdvancedOptimizationMode | undefined;
  let streamSelection: VideoStreamSelectionOptions = DEFAULT_VIDEO_STREAM_SELECTION;
  let qualitySearch: VideoQualitySearchOptions = DEFAULT_VIDEO_QUALITY_SEARCH;
  let targetSizeOptions: TargetSizeOptions | undefined;
  try {
    if (body.optimizationMode !== undefined) {
      if (!isAdvancedOptimizationMode(body.optimizationMode)) {
        throw new AppError(
          "高度な最適化モードが無効です。",
          400,
          "INVALID_OPTIMIZATION_MODE",
        );
      }
      optimizationMode = body.optimizationMode;
    }
    if (body.streamSelection !== undefined) {
      if (!isVideoStreamSelectionOptions(body.streamSelection)) {
        throw new AppError(
          "動画ストリームの選択設定が無効です。",
          400,
          "INVALID_STREAM_SELECTION",
        );
      }
      streamSelection = body.streamSelection;
    }
    if (body.qualitySearch !== undefined) {
      if (!isVideoQualitySearchOptions(body.qualitySearch)) {
        throw new AppError(
          "動画の品質探索設定が無効です。",
          400,
          "INVALID_QUALITY_SEARCH",
        );
      }
      qualitySearch = body.qualitySearch;
    }
    if (body.targetSizeOptions !== undefined) {
      if (!isTargetSizeOptions(body.targetSizeOptions)) {
        throw new AppError(
          "目標容量の設定が無効です。",
          400,
          "INVALID_TARGET_SIZE_OPTIONS",
        );
      }
      targetSizeOptions = body.targetSizeOptions;
    }
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }

  let staged: Awaited<ReturnType<typeof getStagedMedia>>;
  try {
    staged = await getStagedMedia(body.uploadId);
    if (staged.manifest.mediaInfo.kind === "video") {
      if (!isVideoCompressionOptions(body.options)) {
        throw new AppError("動画処理設定が無効です。", 400, "INVALID_VIDEO_OPTIONS");
      }
    } else if (!isAudioProcessingOptions(body.options)) {
      throw new AppError("音声処理設定が無効です。", 400, "INVALID_AUDIO_OPTIONS");
    }
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }

  const jobId = staged.manifest.uploadId;
  const requestedVideoOptions = body.options as VideoCompressionOptions;
  const registeredSource = staged.manifest.mediaInfo;
  const registeredTargetHeight =
    registeredSource.kind === "video" ? selectedVideoHeight(requestedVideoOptions) : null;
  const registeredOutputWidth =
    registeredSource.video && registeredTargetHeight
      ? Math.max(
          2,
          Math.round(
            (registeredSource.video.width * registeredTargetHeight) /
              registeredSource.video.height /
              2,
          ) * 2,
        )
      : registeredSource.video?.width;
  const signal = registerProcessingJob(
    jobId,
    registeredSource.kind === "video" && requestedVideoOptions.upscaleMode === "ai"
      ? "ai-video"
      : registeredSource.kind,
    staged.directory,
    {
      fileId: jobId,
      fileName: staged.manifest.originalName,
      originalSize: staged.manifest.size,
      totalDuration: registeredSource.duration,
      totalFrames:
        registeredSource.video &&
        registeredSource.video.fps !== null &&
        registeredSource.video.fps > 0
          ? Math.round(registeredSource.duration * registeredSource.video.fps)
          : undefined,
      media: {
        originalWidth: registeredSource.video?.width,
        originalHeight: registeredSource.video?.height,
        outputWidth: registeredOutputWidth,
        outputHeight: registeredTargetHeight ?? registeredSource.video?.height,
        originalCodec: registeredSource.video?.codec ?? registeredSource.audio?.codec,
        outputCodec:
          registeredSource.kind === "video"
            ? requestedVideoOptions.codec
            : (body.options as AudioProcessingOptions).outputFormat,
        inputFormat: registeredSource.formatName,
        outputFormat:
          registeredSource.kind === "video"
            ? requestedVideoOptions.outputContainer
            : (body.options as AudioProcessingOptions).outputFormat,
        metadataRemoved: Boolean(
          (body.options as { removeMetadata?: boolean }).removeMetadata,
        ),
      },
    },
  );
  const progress = (value: number, stage: string, details: ProgressEventUpdate = {}) => {
    updateProcessingJob(jobId, {
      ...details,
      progress: value,
      stage,
    });
  };
  const ffmpegDetails = (metrics?: FfmpegProgressMetrics): ProgressEventUpdate => ({
    currentFrame: metrics?.frame,
    processedTime: metrics?.outTimeSeconds,
    fps: metrics?.fps,
    bitrate: metrics?.bitrate,
    speed: metrics?.speed,
    speedMultiplier: metrics?.speedMultiplier,
    currentOutputSize: metrics?.totalSize,
  });

  const runJob = async () => {
    const jobStartedAt = Date.now();
    try {
      const source = staged.manifest.mediaInfo;
      const cachedTargetProbe = targetProbeFromInspection(source, staged.manifest.size);
      progress(2, "ファイル情報を解析しています", {
        status: "analyzing-media",
        stageIndex: 1,
        message: "アップロード時に解析したファイル情報を再利用しています。",
      });
      if (source.kind === "video" && source.video) {
        const options = body.options as VideoCompressionOptions;
        const sourceInfo: VideoMediaInfo = {
          formatName: source.formatName,
          width: source.video.width,
          height: source.video.height,
          duration: source.duration,
          bitrate: source.bitrate,
          fps: source.video.fps,
          videoCodec: source.video.codec,
          audioCodec: source.audio?.codec ?? null,
          audioBitrate: source.audio?.bitrate ?? null,
          audioTrackCount: source.audioTrackCount,
        };
        const targetHeight = selectedVideoHeight(options);
        const warnings: string[] = [];
        if (options.upscaleMode === "ai") {
          progress(3, "AI処理環境を確認しています", {
            status: "analyzing-media",
          });
          const capabilityStartedAt = Date.now();
          const runtimeCapabilities = await getRuntimeCapabilities();
          logger.info({
            jobId,
            stage: "ai-capabilities-ready",
            elapsedMs: Date.now() - capabilityStartedAt,
          });
          if (!runtimeCapabilities.ai.gpu) {
            warnings.push(
              "GPUを検出できないためCPUでAI動画処理します。処理時間を抑えるため10秒までに制限されます。",
            );
          }
        }
        if (targetHeight !== null && targetHeight > sourceInfo.height) {
          warnings.push(
            options.upscaleMode === "ai"
              ? "Real-ESRGANが各フレームの細部を推定・生成するため、元動画にない情報が加わる場合があります。"
              : "単純拡大は画素を増やしますが、新しい画質情報は増えません。",
          );
        }
        if (options.mode === "compress" || targetHeight !== null) {
          warnings.push(
            "解像度変更・画質補正・CRF圧縮では再エンコードされるため、完全な無劣化ではありません。",
          );
        }
        let optimizationReport: OptimizationReport | undefined;
        let targetSizeResult: TargetSizeResult | undefined;
        const advancedVideoMode = optimizationMode
          ? optimizationMode === "strict-lossless" || optimizationMode === "archive"
            ? "strict-lossless"
            : "high-quality-optimization"
          : null;
        if (targetSizeOptions?.enabled) {
          progress(4, "出力容量を予測しています", {
            status: "estimating-output",
          });
        } else if (advancedVideoMode) {
          progress(4, "高画質候補の生成を準備しています", {
            status: "processing",
          });
        } else {
          progress(4, "動画の圧縮処理を開始しています", {
            status: "processing",
          });
        }
        const processed = targetSizeOptions?.enabled
          ? await (async () => {
              const requestedBytes = resolveTargetBytes(
                targetSizeOptions,
                staged.manifest.size,
              );
              const targeted = await runScheduledProcessingJob(
                "videoCpu",
                () =>
                  optimizeVideoToTargetSize({
                    inputPath: staged.inputPath,
                    outputDirectory: staged.directory,
                    jobId,
                    targetBytes: requestedBytes,
                    audioMode: targetSizeOptions.audioMode,
                    minimumAudioKbps: targetSizeOptions.minimumQuality.audioKbps,
                    codec:
                      options.codec === "h265" || options.codec === "av1"
                        ? options.codec
                        : "h264",
                    allowResolutionChange: targetSizeOptions.allowResolutionChange,
                    minimumVideoHeight: targetSizeOptions.minimumQuality.videoHeight,
                    preset: "slow",
                    speedPreset: targetSizeOptions.speedPreset,
                    runSampleEstimate: false,
                    probe: cachedTargetProbe,
                    signal,
                    onProgress: (value, stage, attempt) =>
                      progress(value, stage, {
                        attempt: attempt.attempt,
                        maxAttempts: attempt.maxAttempts,
                        message: stage,
                      }),
                  }),
                signal,
              );
              targetSizeResult = targeted.result;
              if (!targeted.result.achieved) warnings.push(targeted.result.reason);
              const keptOriginal = targeted.selectedOutputPath === staged.inputPath;
              const sourceExtension = extname(staged.manifest.originalName).toLowerCase();
              const selectedExtension = keptOriginal
                ? [
                    ".mp4",
                    ".mov",
                    ".mkv",
                    ".webm",
                    ".avi",
                    ".ts",
                    ".m2ts",
                    ".ogv",
                  ].includes(sourceExtension)
                  ? sourceExtension
                  : ".mkv"
                : ".mp4";
              const outputName = `target-video-output${selectedExtension}`;
              const outputPath = join(
                /*turbopackIgnore: true*/ staged.directory,
                outputName,
              );
              if (targeted.selectedOutputPath !== outputPath) {
                if (targeted.selectedOutputPath === staged.inputPath) {
                  await copyFile(targeted.selectedOutputPath, outputPath);
                } else {
                  await rename(targeted.selectedOutputPath, outputPath);
                }
              }
              return {
                outputName,
                outputPath,
                outputMime:
                  selectedExtension === ".webm"
                    ? "video/webm"
                    : selectedExtension === ".mkv"
                      ? "video/x-matroska"
                      : selectedExtension === ".mov"
                        ? "video/quicktime"
                        : "video/mp4",
                shouldReencode: !keptOriginal,
                crf: null,
                metadata: {
                  detected: !keptOriginal,
                  types: !keptOriginal ? ["コンテナメタデータ"] : [],
                  fields: [],
                },
                removedMetadataTypes: !keptOriginal ? ["コンテナメタデータ"] : [],
              };
            })()
          : advancedVideoMode
            ? await (async () => {
                let completedCandidates = 0;
                const optimized = await runScheduledProcessingJob(
                  "videoCpu",
                  () =>
                    optimizeVideoQuality({
                      inputPath: staged.inputPath,
                      outputDirectory: staged.directory,
                      mode: advancedVideoMode,
                      streamSelection,
                      qualitySearch:
                        optimizationMode === "archive"
                          ? {
                              ...qualitySearch,
                              preset: "slower",
                              vmafThreshold: Math.max(97, qualitySearch.vmafThreshold),
                            }
                          : qualitySearch,
                      probe: videoOptimizationProbeFromInspection(
                        source,
                        staged.manifest.size,
                      ),
                      signal,
                      onProgress: (stage) =>
                        progress(Math.min(90, 6 + completedCandidates * 7), stage, {
                          status: /解析|能力/.test(stage)
                            ? "analyzing-media"
                            : "processing",
                        }),
                      onCandidate: (candidate) => {
                        completedCandidates += 1;
                        progress(
                          Math.min(92, 14 + completedCandidates * 7),
                          candidate.status === "unavailable"
                            ? `${candidate.label}はこの環境で利用できません`
                            : `${candidate.label}を生成・検証しました`,
                        );
                      },
                    }),
                  signal,
                );
                optimizationReport = {
                  ...optimized.report,
                  mode: optimizationMode!,
                };
                const selectedExtension = (() => {
                  const selected = optimized.report.selectedFormat.toLowerCase();
                  if (selected.includes("matroska") || selected === "mkv") return ".mkv";
                  if (selected.includes("webm")) return ".webm";
                  if (selected.includes("quicktime") || selected === "mov") return ".mov";
                  if (selected.includes("mp4") || selected.includes("mov")) return ".mp4";
                  const sourceExtension = extname(
                    staged.manifest.originalName,
                  ).toLowerCase();
                  return [
                    ".mp4",
                    ".mov",
                    ".mkv",
                    ".webm",
                    ".avi",
                    ".ts",
                    ".m2ts",
                    ".ogv",
                  ].includes(sourceExtension)
                    ? sourceExtension
                    : ".mkv";
                })();
                const outputName = `advanced-video-output${selectedExtension}`;
                const outputPath = join(
                  /*turbopackIgnore: true*/ staged.directory,
                  outputName,
                );
                if (optimized.selectedOutputPath !== outputPath) {
                  if (optimized.selectedOutputPath === staged.inputPath) {
                    await copyFile(optimized.selectedOutputPath, outputPath);
                  } else {
                    await rename(optimized.selectedOutputPath, outputPath);
                  }
                }
                const removedMetadataTypes = [
                  ...(streamSelection.keepPrimaryAudioOnly ? ["追加音声トラック"] : []),
                  ...(streamSelection.removeSubtitles ? ["字幕トラック"] : []),
                  ...(streamSelection.removeAttachments ? ["添付ファイル"] : []),
                  ...(streamSelection.removeChapters ? ["チャプター"] : []),
                  ...(streamSelection.stripPrivacyMetadata
                    ? ["プライバシーメタデータ"]
                    : []),
                ];
                return {
                  outputName,
                  outputPath,
                  outputMime:
                    selectedExtension === ".webm"
                      ? "video/webm"
                      : selectedExtension === ".mkv"
                        ? "video/x-matroska"
                        : selectedExtension === ".mov"
                          ? "video/quicktime"
                          : "video/mp4",
                  shouldReencode: advancedVideoMode !== "strict-lossless",
                  crf: null,
                  metadata: {
                    detected: removedMetadataTypes.length > 0,
                    types: removedMetadataTypes,
                    fields: [],
                  },
                  removedMetadataTypes,
                };
              })()
            : options.upscaleMode === "ai"
              ? await runScheduledProcessingJob(
                  "ai",
                  () =>
                    processVideoAiSuperResolution({
                      inputPath: staged.inputPath,
                      directory: staged.directory,
                      originalName: staged.manifest.originalName,
                      compression: options,
                      sourceInfo,
                      signal,
                      onProgress: progress,
                    }),
                  signal,
                )
              : await processVideoCompression({
                  inputPath: staged.inputPath,
                  directory: staged.directory,
                  originalName: staged.manifest.originalName,
                  compression: options,
                  sourceInfo,
                  jobId,
                  signal,
                  onProgress: (value, metrics) =>
                    progress(
                      value,
                      options.mode === "compress"
                        ? `${sourceInfo.videoCodec.toUpperCase()}から${options.codec.toUpperCase()}へ再エンコードしています`
                        : `${sourceInfo.formatName.split(",")[0].toUpperCase()}から${(options.outputContainer ?? "source").toUpperCase()}へ変換しています`,
                      ffmpegDetails(metrics),
                    ),
                  onEncoderSelected: (encoder, hardware) =>
                    progress(
                      5,
                      hardware
                        ? `${encoder}ハードウェアエンコーダーを使用しています`
                        : `${encoder}ソフトウェアエンコーダーを使用しています`,
                      {
                        media: { encoder },
                        message: hardware
                          ? "利用可能なGPUエンコーダーを使用しています。"
                          : "CPUエンコーダーを使用しています。",
                      },
                    ),
                });
        progress(99, "出力動画を検証中", {
          status: "finalizing",
          stageIndex: 7,
        });
        const preparedOutput = await prepareDownloadOutput(
          staged.directory,
          processed.outputPath,
          staged.manifest.originalName,
        );
        const outputDetails = await stat(preparedOutput.internalPath);
        if (outputDetails.size <= 0) {
          throw new AppError(
            "出力動画が0バイトのため、ダウンロードを中止しました。",
            422,
            "EMPTY_OUTPUT",
          );
        }
        const outputValidationStartedAt = performance.now();
        const outputInfo = await probeVideo(preparedOutput.internalPath);
        const outputContainer = extname(preparedOutput.internalName).slice(1);
        if (!["mp4", "webm", "mkv", "mov"].includes(outputContainer)) {
          throw new AppError(
            "出力動画形式を検証できません。",
            422,
            "OUTPUT_FORMAT_MISMATCH",
          );
        }
        assertVideoOutputMatches(
          outputContainer as "mp4" | "webm" | "mkv" | "mov",
          processed.shouldReencode ? options.codec : null,
          outputInfo,
        );
        const outputValidationMilliseconds =
          performance.now() - outputValidationStartedAt;
        if ("performanceMetrics" in processed && processed.performanceMetrics) {
          logger.info({
            stage: "video-performance",
            ...withVideoOutputValidation(
              processed.performanceMetrics,
              outputValidationMilliseconds,
            ),
          });
        }
        let afterPreviewName: string | undefined;
        if (staged.manifest.beforePreviewName) {
          afterPreviewName = "after-preview.mp4";
          try {
            await generateVideoPreview(
              preparedOutput.internalPath,
              join(/*turbopackIgnore: true*/ staged.directory, afterPreviewName),
            );
          } catch {
            afterPreviewName = undefined;
          }
        }
        const savedBytes = staged.manifest.size - outputDetails.size;
        const reductionPercent = Number(
          ((savedBytes / staged.manifest.size) * 100).toFixed(1),
        );
        const result: ProcessResult = {
          jobId: staged.manifest.uploadId,
          kind: "video",
          originalName: staged.manifest.originalName,
          outputName: preparedOutput.downloadName,
          originalSize: staged.manifest.size,
          outputSize: outputDetails.size,
          savedBytes,
          reductionPercent,
          outputMime: processed.outputMime,
          outputFormat:
            preparedOutput.internalName.split(".").pop()?.toLowerCase() ?? "mp4",
          encoding: null,
          quality: null,
          warnings,
          downloadUrl: `/api/files/${staged.manifest.uploadId}`,
          previewUrl: null,
          previewUrls:
            staged.manifest.beforePreviewName && afterPreviewName
              ? {
                  before: `/api/files/${staged.manifest.uploadId}?preview=before`,
                  after: `/api/files/${staged.manifest.uploadId}?preview=after`,
                }
              : null,
          metadata: processed.metadata,
          removedMetadataTypes: processed.removedMetadataTypes,
          expiresInMinutes: retentionMinutes,
          processing: processed.shouldReencode ? "ffmpeg" : "stream-copy",
          optimizationReport,
          targetSizeResult,
          video: {
            before: sourceInfo,
            after: outputInfo,
            options,
            crf: processed.crf,
          },
        };
        await writeManifest(staged.directory, {
          jobId: staged.manifest.uploadId,
          outputName: preparedOutput.internalName,
          originalName: staged.manifest.originalName,
          downloadName: preparedOutput.downloadName,
          outputMime: processed.outputMime,
          beforePreviewName: staged.manifest.beforePreviewName,
          afterPreviewName,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + retentionMinutes * 60_000).toISOString(),
          optimizationReport,
          targetSizeResult,
        });
        await writeProcessResult(staged.directory, result);
        await unlink(staged.inputPath).catch(() => undefined);
        await removeStagedMediaManifest(staged.directory);
        scheduleJobCleanup(staged.directory, retentionMinutes * 60_000);
        updateProcessingJob(jobId, {
          progress: 99,
          status: "finalizing",
          stage: "ダウンロード準備",
          stageIndex: 8,
          currentOutputSize: outputDetails.size,
          estimatedOutputSize: outputDetails.size,
          media: {
            outputWidth: outputInfo.width,
            outputHeight: outputInfo.height,
            outputCodec: outputInfo.videoCodec,
            outputFormat: processed.outputName.split(".").pop()?.toLowerCase(),
            metadataRemoved: processed.removedMetadataTypes.length > 0,
          },
          message: "出力ファイルを確認し、ダウンロードを準備しています。",
        });
        finishProcessingJob(jobId, "complete");
      } else if (source.audio) {
        const options = body.options as AudioProcessingOptions;
        const sourceInfo = {
          formatName: source.formatName,
          duration: source.duration,
          bitrate: source.bitrate,
          audioCodec: source.audio.codec,
          audioBitrate: source.audio.bitrate,
          sampleRate: source.audio.sampleRate,
          channels: source.audio.channels,
        };
        let targetSizeResult: TargetSizeResult | undefined;
        progress(
          4,
          targetSizeOptions?.enabled
            ? "出力容量を予測しています"
            : "音声の処理を開始しています",
          {
            status: targetSizeOptions?.enabled ? "estimating-output" : "processing",
          },
        );
        const processed = targetSizeOptions?.enabled
          ? await (async () => {
              const targeted = await optimizeAudioToTargetSize({
                inputPath: staged.inputPath,
                outputDirectory: staged.directory,
                jobId,
                targetBytes: resolveTargetBytes(targetSizeOptions, staged.manifest.size),
                audioMode: targetSizeOptions.audioMode,
                minimumAudioKbps: targetSizeOptions.minimumQuality.audioKbps,
                probe: cachedTargetProbe,
                signal,
                onProgress: (value, stage, attempt) =>
                  progress(value, stage, {
                    attempt: attempt.attempt,
                    maxAttempts: attempt.maxAttempts,
                    message: stage,
                  }),
              });
              targetSizeResult = targeted.result;
              const keptOriginal = targeted.selectedOutputPath === staged.inputPath;
              const originalExtension = extname(
                staged.manifest.originalName,
              ).toLowerCase();
              const selectedExtension = keptOriginal
                ? [
                    ".mp3",
                    ".aac",
                    ".m4a",
                    ".wav",
                    ".flac",
                    ".opus",
                    ".ogg",
                    ".wma",
                    ".aiff",
                  ].includes(originalExtension)
                  ? originalExtension
                  : ".m4a"
                : ".m4a";
              const outputName = `target-audio-output${selectedExtension}`;
              const outputPath = join(
                /*turbopackIgnore: true*/ staged.directory,
                outputName,
              );
              if (targeted.selectedOutputPath !== outputPath) {
                if (targeted.selectedOutputPath === staged.inputPath) {
                  await copyFile(targeted.selectedOutputPath, outputPath);
                } else {
                  await rename(targeted.selectedOutputPath, outputPath);
                }
              }
              const outputFormat = keptOriginal
                ? selectedExtension.slice(1) || "aac"
                : "aac";
              const outputMime =
                selectedExtension === ".mp3"
                  ? "audio/mpeg"
                  : selectedExtension === ".wav"
                    ? "audio/wav"
                    : selectedExtension === ".flac"
                      ? "audio/flac"
                      : selectedExtension === ".opus" || selectedExtension === ".ogg"
                        ? "audio/ogg"
                        : "audio/mp4";
              return {
                outputName,
                outputPath,
                outputMime,
                outputFormat,
                copy: keptOriginal,
                bitrate: targeted.result.selectedAudioKbps
                  ? `${targeted.result.selectedAudioKbps}k`
                  : null,
                metadata: {
                  detected: !keptOriginal,
                  types: !keptOriginal ? ["コンテナメタデータ"] : [],
                  fields: [],
                },
                removedMetadataTypes: !keptOriginal ? ["コンテナメタデータ"] : [],
              };
            })()
          : await processAudio({
              inputPath: staged.inputPath,
              directory: staged.directory,
              originalName: staged.manifest.originalName,
              sourceInfo,
              options,
              signal,
              onProgress: (value, metrics) =>
                progress(
                  value,
                  `${sourceInfo.formatName.split(",")[0].toUpperCase()}から${options.outputFormat.toUpperCase()}へ変換しています`,
                  ffmpegDetails(metrics),
                ),
            });
        progress(99, "出力音声を検証中", {
          status: "finalizing",
          stageIndex: 5,
        });
        const preparedOutput = await prepareDownloadOutput(
          staged.directory,
          processed.outputPath,
          staged.manifest.originalName,
        );
        const outputDetails = await stat(preparedOutput.internalPath);
        if (outputDetails.size <= 0) {
          throw new AppError(
            "出力音声が0バイトのため、ダウンロードを中止しました。",
            422,
            "EMPTY_OUTPUT",
          );
        }
        const outputInfo = await probeAudio(preparedOutput.internalPath);
        if (!processed.copy) {
          if (
            !AUDIO_OUTPUT_FORMATS.includes(processed.outputFormat as AudioOutputFormat)
          ) {
            throw new AppError(
              "出力音声形式を検証できません。",
              422,
              "OUTPUT_FORMAT_MISMATCH",
            );
          }
          assertAudioOutputMatches(
            processed.outputFormat as AudioOutputFormat,
            outputInfo,
          );
        }
        const savedBytes = staged.manifest.size - outputDetails.size;
        const reductionPercent = Number(
          ((savedBytes / staged.manifest.size) * 100).toFixed(1),
        );
        const result: ProcessResult = {
          jobId: staged.manifest.uploadId,
          kind: "audio",
          originalName: staged.manifest.originalName,
          outputName: preparedOutput.downloadName,
          originalSize: staged.manifest.size,
          outputSize: outputDetails.size,
          savedBytes,
          reductionPercent,
          outputMime: processed.outputMime,
          outputFormat: processed.outputFormat,
          encoding: processed.copy ? "lossless" : null,
          quality: null,
          warnings:
            targetSizeResult && !targetSizeResult.achieved
              ? [targetSizeResult.reason]
              : [],
          downloadUrl: `/api/files/${staged.manifest.uploadId}`,
          previewUrl: null,
          metadata: processed.metadata,
          removedMetadataTypes: processed.removedMetadataTypes,
          expiresInMinutes: retentionMinutes,
          processing: processed.copy ? "stream-copy" : "ffmpeg",
          targetSizeResult,
          audio: { before: sourceInfo, after: outputInfo, options },
        };
        await writeManifest(staged.directory, {
          jobId: staged.manifest.uploadId,
          outputName: preparedOutput.internalName,
          originalName: staged.manifest.originalName,
          downloadName: preparedOutput.downloadName,
          outputMime: processed.outputMime,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + retentionMinutes * 60_000).toISOString(),
          targetSizeResult,
        });
        await writeProcessResult(staged.directory, result);
        await unlink(staged.inputPath).catch(() => undefined);
        await removeStagedMediaManifest(staged.directory);
        scheduleJobCleanup(staged.directory, retentionMinutes * 60_000);
        updateProcessingJob(jobId, {
          progress: 99,
          status: "finalizing",
          stage: "ダウンロード準備",
          stageIndex: 6,
          currentOutputSize: outputDetails.size,
          estimatedOutputSize: outputDetails.size,
          media: {
            outputCodec: outputInfo.audioCodec,
            outputFormat: processed.outputFormat,
            metadataRemoved: processed.removedMetadataTypes.length > 0,
          },
          message: "出力ファイルを確認し、ダウンロードを準備しています。",
        });
        finishProcessingJob(jobId, "complete");
      } else {
        throw new AppError("処理可能なストリームがありません。", 422, "STREAM_REQUIRED");
      }
      logger.info({
        jobId,
        stage: "media-job-completed",
        elapsedMs: Date.now() - jobStartedAt,
      });
    } catch (error) {
      const response = errorResponse(error);
      finishProcessingJob(
        jobId,
        error instanceof AppError && error.code === "CANCELLED" ? "cancelled" : "error",
        typeof response.body.error === "string" ? response.body.error : undefined,
      );
      await cleanupFailedJobArtifacts(staged.directory);
      scheduleJobCleanup(staged.directory, Math.min(retentionMinutes, 10) * 60_000);
      logger.error({
        jobId,
        stage: "media-job-failed",
        errorCode: error instanceof AppError ? error.code : "MEDIA_PROCESSING_FAILED",
      });
    }
  };

  logger.info({
    jobId,
    stage: "job-created",
    elapsedMs: Date.now() - requestStartedAt,
  });
  after(runJob);

  return NextResponse.json(
    {
      jobId,
      status: "queued",
      statusUrl: `/api/jobs/${jobId}`,
      eventsUrl: `/api/jobs/${jobId}/events`,
      resultUrl: `/api/results/${jobId}?full=1`,
    },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}
