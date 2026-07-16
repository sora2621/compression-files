import { stat, unlink } from "node:fs/promises";

import { NextResponse } from "next/server";

import { errorResponse, AppError } from "@/lib/errors";
import { probeVideo, processVideoCompression } from "@/lib/media/video";
import {
  isVideoCompressionOptions,
  selectedVideoHeight,
  type VideoCompressionOptions,
} from "@/lib/media/video-types";
import {
  getStagedVideo,
  prepareDownloadOutput,
  removeJob,
  removeStagedVideoManifest,
  scheduleJobCleanup,
  writeManifest,
} from "@/lib/storage/temp-storage";
import { logger } from "@/shared/logging/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;

interface ProcessRequest {
  uploadId?: unknown;
  options?: unknown;
}

export async function POST(request: Request) {
  let body: ProcessRequest;
  try {
    body = (await request.json()) as ProcessRequest;
  } catch {
    return NextResponse.json(
      { error: "動画圧縮設定を読み取れませんでした。", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  if (typeof body.uploadId !== "string") {
    return NextResponse.json(
      { error: "動画アップロードIDがありません。", code: "UPLOAD_ID_REQUIRED" },
      { status: 400 },
    );
  }
  if (!isVideoCompressionOptions(body.options)) {
    return NextResponse.json(
      { error: "動画圧縮設定が無効です。", code: "INVALID_VIDEO_OPTIONS" },
      { status: 400 },
    );
  }

  let staged: Awaited<ReturnType<typeof getStagedVideo>>;
  try {
    staged = await getStagedVideo(body.uploadId);
    const targetHeight = selectedVideoHeight(body.options);
    if (
      body.options.resolution !== "custom" &&
      targetHeight !== null &&
      targetHeight > staged.manifest.mediaInfo.height
    ) {
      throw new AppError(
        "元動画より高いプリセット解像度は選択できません。",
        400,
        "UPSCALE_NOT_ALLOWED",
      );
    }
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }

  const encoder = new TextEncoder();
  let streamOpen = true;
  const send = (controller: ReadableStreamDefaultController, payload: unknown) => {
    if (!streamOpen) return false;
    try {
      controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      return true;
    } catch {
      streamOpen = false;
      logger.warn({
        jobId: staged.manifest.uploadId,
        stage: "progress-stream-disconnected",
        errorCode: "PROGRESS_STREAM_DISCONNECTED",
      });
      return false;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        try {
          const options = body.options as VideoCompressionOptions;
          const targetHeight = selectedVideoHeight(options);
          const warnings: string[] = [];
          if (
            options.resolution === "custom" &&
            targetHeight !== null &&
            targetHeight > staged.manifest.mediaInfo.height
          ) {
            warnings.push(
              "元動画より高い解像度への変換はアップスケールになり、画質は改善しません。",
            );
          }
          if (options.mode === "compress" || targetHeight !== null) {
            warnings.push(
              "解像度変更またはCRF圧縮のため再エンコードしました。完全な無劣化ではありません。",
            );
          }

          const processed = await processVideoCompression({
            inputPath: staged.inputPath,
            directory: staged.directory,
            originalName: staged.manifest.originalName,
            compression: options,
            sourceInfo: staged.manifest.mediaInfo,
            onProgress: (progress) => send(controller, { type: "progress", progress }),
          });
          const preparedOutput = await prepareDownloadOutput(
            staged.directory,
            processed.outputPath,
            staged.manifest.originalName,
          );
          const outputDetails = await stat(preparedOutput.internalPath);
          const outputInfo = await probeVideo(preparedOutput.internalPath);
          const savedBytes = staged.manifest.size - outputDetails.size;
          const reductionPercent = Number(
            ((savedBytes / staged.manifest.size) * 100).toFixed(1),
          );

          await writeManifest(staged.directory, {
            jobId: staged.manifest.uploadId,
            outputName: preparedOutput.internalName,
            originalName: staged.manifest.originalName,
            downloadName: preparedOutput.downloadName,
            outputMime: processed.outputMime,
            createdAt: new Date().toISOString(),
          });
          await unlink(staged.inputPath).catch(() => undefined);
          await removeStagedVideoManifest(staged.directory);
          scheduleJobCleanup(staged.directory);

          send(controller, {
            type: "complete",
            result: {
              jobId: staged.manifest.uploadId,
              kind: "video",
              originalName: staged.manifest.originalName,
              outputName: preparedOutput.downloadName,
              originalSize: staged.manifest.size,
              outputSize: outputDetails.size,
              savedBytes,
              reductionPercent,
              outputMime: processed.outputMime,
              outputFormat: preparedOutput.internalName.split(".").pop()?.toLowerCase(),
              encoding: null,
              quality: null,
              warnings,
              downloadUrl: `/api/files/${staged.manifest.uploadId}`,
              previewUrl: null,
              metadata: processed.metadata,
              removedMetadataTypes: processed.removedMetadataTypes,
              expiresInMinutes: 30,
              processing: processed.shouldReencode ? "ffmpeg" : "stream-copy",
              video: {
                before: staged.manifest.mediaInfo,
                after: outputInfo,
                options,
                crf: processed.crf,
              },
            },
          });
        } catch (error) {
          await removeJob(staged.directory).catch(() => undefined);
          const response = errorResponse(error);
          send(controller, { type: "error", ...response.body });
        } finally {
          if (streamOpen) {
            try {
              controller.close();
            } catch {
              streamOpen = false;
            }
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
