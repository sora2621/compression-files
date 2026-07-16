import { extname } from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { cleanupExpiredJobs, getJobFile } from "@/lib/storage/temp-storage";
import { createCompressedFileName, createContentDisposition } from "@/shared/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  void cleanupExpiredJobs().catch(() => undefined);

  try {
    const { jobId } = await params;
    const requestedPreview = new URL(request.url).searchParams.get("preview");
    const preview =
      requestedPreview === "1"
        ? "image"
        : requestedPreview === "original"
          ? "original"
          : requestedPreview === "before" || requestedPreview === "after"
            ? requestedPreview
            : false;
    const inline = preview !== false;
    const jobFile = await getJobFile(jobId, preview);
    const webStream = Readable.toWeb(jobFile.stream) as ReadableStream;
    const downloadName =
      jobFile.manifest.downloadName ??
      createCompressedFileName(
        jobFile.manifest.originalName ?? jobFile.manifest.outputName,
        extname(jobFile.manifest.outputName).slice(1),
      );

    return new NextResponse(webStream, {
      headers: {
        "Content-Type": jobFile.manifest.outputMime,
        "Content-Length": String(jobFile.size),
        "Content-Disposition": createContentDisposition(
          inline ? jobFile.manifest.outputName : downloadName,
          inline ? "inline" : "attachment",
        ),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
