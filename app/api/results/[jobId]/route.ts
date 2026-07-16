import { extname } from "node:path";

import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { getOrRestoreProcessingJob } from "@/lib/jobs/job-registry";
import { getJobFile, getProcessResult } from "@/lib/storage/temp-storage";
import { createCompressedFileName } from "@/shared/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  try {
    if (new URL(request.url).searchParams.get("full") === "1") {
      return NextResponse.json(await getProcessResult(jobId), {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const [file, state] = await Promise.all([
      getJobFile(jobId),
      getOrRestoreProcessingJob(jobId),
    ]);
    file.stream.destroy();
    const event = state?.latestEvent;
    const originalName =
      event?.fileName ?? file.manifest.originalName ?? file.manifest.outputName;
    const downloadName =
      file.manifest.downloadName ??
      createCompressedFileName(originalName, extname(file.manifest.outputName).slice(1));
    const originalSize = event?.originalSize ?? file.size;
    const savedBytes = originalSize - file.size;
    const reductionPercent =
      originalSize > 0 ? Number(((savedBytes / originalSize) * 100).toFixed(1)) : null;
    const previewUrls = {
      image: file.manifest.previewName ? `/api/files/${jobId}?preview=1` : null,
      original: file.manifest.originalPreviewName
        ? `/api/files/${jobId}?preview=original`
        : null,
      before: file.manifest.beforePreviewName
        ? `/api/files/${jobId}?preview=before`
        : null,
      after: file.manifest.afterPreviewName ? `/api/files/${jobId}?preview=after` : null,
    };
    return NextResponse.json(
      {
        jobId,
        kind: event?.kind ?? "image",
        fileName: originalName,
        outputName: downloadName,
        outputMime: file.manifest.outputMime,
        outputFormat:
          event?.media?.outputFormat ??
          extname(file.manifest.outputName).slice(1).toLowerCase(),
        originalSize,
        outputSize: file.size,
        savedBytes,
        reductionPercent,
        elapsedSeconds: event?.elapsedSeconds,
        inputFormat: event?.media?.inputFormat,
        originalWidth: event?.media?.originalWidth,
        originalHeight: event?.media?.originalHeight,
        outputWidth: event?.media?.outputWidth,
        outputHeight: event?.media?.outputHeight,
        originalCodec: event?.media?.originalCodec,
        outputCodec: event?.media?.outputCodec,
        metadataRemoved: event?.media?.metadataRemoved ?? false,
        downloadUrl: `/api/files/${jobId}`,
        previewUrls,
        createdAt: file.manifest.createdAt,
        expiresAt: file.manifest.expiresAt,
        optimizationReport: file.manifest.optimizationReport,
        targetSizeResult: file.manifest.targetSizeResult,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
