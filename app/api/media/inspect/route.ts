import { unlink } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { MAX_REQUEST_BYTES, MAX_VIDEO_BYTES } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { generateVideoPreview } from "@/lib/media/video-preview";
import {
  cleanupExpiredJobs,
  createJob,
  removeJob,
  scheduleJobCleanup,
  writeManifest,
  writeStagedMediaManifest,
  writeUpload,
} from "@/lib/storage/temp-storage";
import { validateUploadedFile } from "@/lib/validation/file-validation";
import { sanitizeDownloadFileName } from "@/shared/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  void cleanupExpiredJobs().catch(() => undefined);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "アップロード上限（250MB）を超えています。", code: "REQUEST_TOO_LARGE" },
      { status: 413 },
    );
  }

  let job: Awaited<ReturnType<typeof createJob>> | undefined;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new AppError("ファイルが選択されていません。", 400, "FILE_REQUIRED");
    }
    if (file.size === 0 || file.size > MAX_VIDEO_BYTES) {
      throw new AppError(
        file.size === 0
          ? "空のファイルは処理できません。"
          : "ファイル上限（250MB）を超えています。",
        file.size === 0 ? 400 : 413,
        file.size === 0 ? "EMPTY_FILE" : "FILE_TOO_LARGE",
      );
    }

    job = await createJob();
    const originalName = sanitizeDownloadFileName(file.name, "upload");
    const inputName = "source.bin";
    const inputPath = join(/*turbopackIgnore: true*/ job.directory, inputName);
    await writeUpload(file, inputPath);
    const detected = await validateUploadedFile(file, inputPath);

    if (detected.kind === "image") {
      const previewName = "source-preview.webp";
      const previewSource = detected.normalizedInputPath ?? inputPath;
      await sharp(previewSource, {
        animated: false,
        failOn: "error",
        limitInputPixels: 40_000_000,
        sequentialRead: true,
      })
        .autoOrient()
        .resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 })
        .toFile(join(/*turbopackIgnore: true*/ job.directory, previewName));
      await writeManifest(job.directory, {
        jobId: job.jobId,
        outputName: previewName,
        outputMime: "image/webp",
        createdAt: new Date().toISOString(),
      });
      await unlink(inputPath).catch(() => undefined);
      if (detected.normalizedInputPath) {
        await unlink(detected.normalizedInputPath).catch(() => undefined);
      }
      scheduleJobCleanup(job.directory);
      const recommendations = [
        ...(detected.imageInfo.hasAlpha
          ? [
              {
                id: "image-alpha-lossless",
                title: "透過をWebP losslessで保持",
                description: "透過画像なのでPNGまたはWebP losslessが適しています。",
              },
            ]
          : []),
        ...(detected.imageInfo.animated
          ? [
              {
                id: "image-animation",
                title: "アニメーションを保持",
                description:
                  "GIFまたはアニメーションWebPを選ぶとフレームを維持できます。",
              },
            ]
          : []),
        ...(Math.max(detected.imageInfo.width, detected.imageInfo.height) < 1280
          ? [
              {
                id: "image-ai-2x",
                title: "AI 2倍アップスケール候補",
                description:
                  "低解像度画像です。AI利用可能時は2倍高画質化を検討できます。",
              },
            ]
          : []),
      ];
      return NextResponse.json({
        uploadId: job.jobId,
        kind: "image",
        originalName,
        size: file.size,
        mime: detected.mime,
        detectedFormat: detected.detectedFormat,
        imageInfo: detected.imageInfo,
        originalPreviewUrl: `/api/files/${job.jobId}?preview=1`,
        recommendations,
      });
    }

    let beforePreviewName: string | undefined;
    if (detected.kind === "video") {
      beforePreviewName = "before-preview.mp4";
      try {
        await generateVideoPreview(
          inputPath,
          join(/*turbopackIgnore: true*/ job.directory, beforePreviewName),
        );
      } catch {
        beforePreviewName = undefined;
      }
    }
    await writeStagedMediaManifest(job.directory, {
      uploadId: job.jobId,
      inputName,
      originalName,
      inputMime: detected.mime,
      detectedFormat: detected.detectedFormat,
      size: file.size,
      createdAt: new Date().toISOString(),
      mediaInfo: detected.mediaInfo,
      beforePreviewName,
    });
    scheduleJobCleanup(job.directory);

    const recommendations =
      detected.kind === "video"
        ? [
            ...(detected.mediaInfo.video && detected.mediaInfo.video.height >= 2160
              ? [
                  {
                    id: "video-1080p",
                    title: "1080pで容量を削減",
                    description: "4K動画です。共有用なら1080pが容量削減候補です。",
                  },
                ]
              : []),
            {
              id: "video-compatible",
              title: "互換性を優先",
              description: "MP4 / H.264 / AACは幅広い端末で再生しやすい設定です。",
            },
            {
              id: "video-small",
              title: "容量を優先",
              description: "対応環境ならH.265、Web向けならVP9/AV1も候補です。",
            },
          ]
        : [
            {
              id: "audio-compatible",
              title: "互換性を優先",
              description: "MP3は幅広いプレーヤーで再生できます。",
            },
            {
              id: "audio-small",
              title: "容量を優先",
              description: "対応環境ならOpusが高圧縮です。",
            },
          ];
    return NextResponse.json({
      uploadId: job.jobId,
      kind: detected.kind,
      originalName,
      size: file.size,
      mime: detected.mime,
      detectedFormat: detected.detectedFormat,
      mediaInfo: detected.mediaInfo,
      previewUrl: beforePreviewName ? `/api/media/preview/${job.jobId}` : null,
      recommendations,
    });
  } catch (error) {
    if (job) await removeJob(job.directory).catch(() => undefined);
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
