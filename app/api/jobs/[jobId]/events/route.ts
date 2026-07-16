import {
  getOrRestoreProcessingJob,
  getProcessingJobEvents,
  subscribeProcessingJob,
} from "@/lib/jobs/job-registry";

import type { ProgressEvent } from "@/lib/progress/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 15_000;

function terminal(event: ProgressEvent) {
  return (
    event.status === "completed" ||
    event.status === "failed" ||
    event.status === "cancelled"
  );
}

function serializeEvent(event: ProgressEvent) {
  return `id: ${event.eventId}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const state = await getOrRestoreProcessingJob(jobId);
  if (!state) {
    return Response.json(
      { error: "処理ジョブが見つかりません。", code: "JOB_NOT_FOUND" },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const lastEventId =
    request.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
  const encoder = new TextEncoder();
  let cancelStream: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let lastSequence = 0;
      let unsubscribe: (() => unknown) | null = null;
      const heartbeat: ReturnType<typeof setInterval> = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`),
          );
        } catch {
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);
      let replaying = true;
      const pendingLiveEvents: ProgressEvent[] = [];

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        request.signal.removeEventListener("abort", abort);
      };
      const close = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          // The client has already disconnected.
        }
      };
      const emit = (event: ProgressEvent) => {
        if (closed || event.sequence <= lastSequence) return;
        try {
          controller.enqueue(encoder.encode(serializeEvent(event)));
          lastSequence = event.sequence;
        } catch {
          cleanup();
          return;
        }
        if (terminal(event)) close();
      };
      const send = (event: ProgressEvent) => {
        if (replaying) pendingLiveEvents.push(event);
        else emit(event);
      };
      const abort = () => cleanup();
      cancelStream = cleanup;

      request.signal.addEventListener("abort", abort, { once: true });
      try {
        controller.enqueue(encoder.encode("retry: 2000\n\n"));
      } catch {
        cleanup();
        return;
      }

      // Subscribe before replaying. The sequence check makes the small overlap
      // idempotent if an update arrives between these two operations.
      unsubscribe = subscribeProcessingJob(jobId, send);
      const replay = getProcessingJobEvents(jobId, lastEventId);
      for (const event of replay) {
        emit(event);
        if (closed) return;
      }
      replaying = false;
      pendingLiveEvents
        .sort((left, right) => left.sequence - right.sequence)
        .forEach(emit);
      if (closed) return;
    },
    cancel() {
      cancelStream();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
