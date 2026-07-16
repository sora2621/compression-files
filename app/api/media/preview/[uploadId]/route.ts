import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { AppError, errorResponse } from "@/lib/errors";
import { getStagedMedia } from "@/lib/storage/temp-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const { uploadId } = await params;
    const staged = await getStagedMedia(uploadId);
    const name = staged.manifest.beforePreviewName;
    if (!name) {
      throw new AppError("動画プレビューはありません。", 404, "PREVIEW_NOT_FOUND");
    }
    const path = join(staged.directory, name);
    const details = await stat(path);
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(details.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
