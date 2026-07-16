import { join } from "node:path";

import { NextResponse } from "next/server";

import { MAX_REQUEST_BYTES, MAX_VIDEO_BYTES } from "@/lib/config";
import { AppError, errorResponse } from "@/lib/errors";
import { probeVideo } from "@/lib/media/video";
import {
  cleanupExpiredJobs,
  createJob,
  removeJob,
  scheduleJobCleanup,
  writeStagedVideoManifest,
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
      { error: "動画の上限（250MB）を超えています。", code: "REQUEST_TOO_LARGE" },
      { status: 413 },
    );
  }

  let job: Awaited<ReturnType<typeof createJob>> | undefined;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new AppError("動画が選択されていません。", 400, "FILE_REQUIRED");
    }
    if (file.size === 0 || file.size > MAX_VIDEO_BYTES) {
      throw new AppError(
        file.size === 0
          ? "空の動画は処理できません。"
          : "動画の上限（250MB）を超えています。",
        file.size === 0 ? 400 : 413,
        file.size === 0 ? "EMPTY_FILE" : "FILE_TOO_LARGE",
      );
    }

    job = await createJob();
    const originalName = sanitizeDownloadFileName(file.name, "upload");
    const inputName = "source.bin";
    const inputPath = join(job.directory, inputName);
    await writeUpload(file, inputPath);
    const detected = await validateUploadedFile(file, inputPath);
    if (detected.kind !== "video") {
      throw new AppError(
        "動画ファイルではありません。FFmpegで解析可能な映像ファイルを選択してください。",
        415,
        "VIDEO_REQUIRED",
      );
    }

    const mediaInfo = await probeVideo(inputPath);
    await writeStagedVideoManifest(job.directory, {
      uploadId: job.jobId,
      inputName,
      originalName,
      inputMime: detected.mime,
      size: file.size,
      createdAt: new Date().toISOString(),
      mediaInfo,
    });
    scheduleJobCleanup(job.directory);

    return NextResponse.json({
      uploadId: job.jobId,
      originalName,
      size: file.size,
      mediaInfo,
    });
  } catch (error) {
    if (job) await removeJob(job.directory).catch(() => undefined);
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
