"use client";

import { useCallback, useEffect, useRef } from "react";

import { fetchJobState } from "@/features/upload/media-client";
import { forgetActiveJob } from "@/features/workspace/active-jobs";
import { isTerminalProgressEvent } from "@/features/workspace/progress";

import type { ProgressEvent } from "@/lib/progress/types";

export function progressEventFromMessage(data: string): ProgressEvent | null {
  try {
    const payload = JSON.parse(data) as unknown;
    if (!payload || typeof payload !== "object") return null;
    return "event" in payload
      ? ((payload as { event?: ProgressEvent }).event ?? null)
      : (payload as ProgressEvent);
  } catch {
    return null;
  }
}

export function useJobProgress(
  onProgress: (itemId: string, event: ProgressEvent) => void,
) {
  const eventSources = useRef(new Map<string, EventSource>());
  const watchTokens = useRef(new Map<string, symbol>());

  const stopJobProgress = useCallback((jobId: string) => {
    eventSources.current.get(jobId)?.close();
    eventSources.current.delete(jobId);
    watchTokens.current.delete(jobId);
  }, []);

  const dispatch = useCallback(
    (itemId: string, event: ProgressEvent) => {
      onProgress(itemId, event);
      if (isTerminalProgressEvent(event)) {
        forgetActiveJob(event.jobId);
        stopJobProgress(event.jobId);
      }
    },
    [onProgress, stopJobProgress],
  );

  const connectJobProgress = useCallback(
    (itemId: string, jobId: string) => {
      if (typeof EventSource === "undefined") return;
      stopJobProgress(jobId);
      const token = Symbol(jobId);
      watchTokens.current.set(jobId, token);

      void (async () => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (watchTokens.current.get(jobId) !== token) return;
          try {
            const state = await fetchJobState(jobId);
            if (state.latestEvent) {
              dispatch(itemId, state.latestEvent);
              if (isTerminalProgressEvent(state.latestEvent)) return;
            }
            const source = new EventSource(`/api/jobs/${jobId}/events`);
            eventSources.current.set(jobId, source);
            const receive = (message: MessageEvent<string>) => {
              const event = progressEventFromMessage(message.data);
              if (event?.jobId === jobId) dispatch(itemId, event);
            };
            source.onmessage = receive;
            ["progress", "snapshot", "completed", "failed", "cancelled"].forEach((name) =>
              source.addEventListener(name, receive as EventListener),
            );
            return;
          } catch {
            // The process request may still be uploading; retry registration.
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, Math.min(1_000, 200 + attempt * 40));
          });
        }
      })();
    },
    [dispatch, stopJobProgress],
  );

  useEffect(() => {
    const sources = eventSources.current;
    const tokens = watchTokens.current;
    return () => {
      sources.forEach((source) => source.close());
      sources.clear();
      tokens.clear();
    };
  }, []);

  return { connectJobProgress, stopJobProgress };
}
