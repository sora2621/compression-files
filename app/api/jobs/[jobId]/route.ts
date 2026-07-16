import { NextResponse } from "next/server";

import { cancelProcessingJob, getOrRestoreProcessingJob } from "@/lib/jobs/job-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const state = await getOrRestoreProcessingJob(jobId);
  if (!state) {
    return NextResponse.json(
      { error: "処理ジョブが見つかりません。", code: "JOB_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  await getOrRestoreProcessingJob(jobId);
  if (!cancelProcessingJob(jobId)) {
    return NextResponse.json(
      { error: "処理ジョブが見つかりません。", code: "JOB_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ cancelled: true });
}
