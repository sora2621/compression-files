import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/errors";
import { getStagedVideo, removeJob } from "@/lib/storage/temp-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const { uploadId } = await params;
    const staged = await getStagedVideo(uploadId);
    await removeJob(staged.directory);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
