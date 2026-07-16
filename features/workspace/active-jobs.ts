import { MAX_FILES } from "@/features/workspace/constants";

import type { StoredActiveJob } from "@/features/workspace/types";

const ACTIVE_JOBS_STORAGE_KEY = "compression-files:active-jobs:v1";

function isStoredActiveJob(entry: unknown): entry is StoredActiveJob {
  if (typeof entry !== "object" || entry === null) return false;
  const candidate = entry as Partial<StoredActiveJob>;
  return (
    typeof candidate.itemId === "string" &&
    typeof candidate.jobId === "string" &&
    typeof candidate.fileName === "string" &&
    (candidate.kind === "image" ||
      candidate.kind === "video" ||
      candidate.kind === "audio")
  );
}

export function readStoredActiveJobs(): StoredActiveJob[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(
      window.localStorage.getItem(ACTIVE_JOBS_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value) ? value.filter(isStoredActiveJob) : [];
  } catch {
    return [];
  }
}

export function storeActiveJob(job: StoredActiveJob) {
  if (typeof window === "undefined") return;
  const jobs = readStoredActiveJobs().filter((entry) => entry.jobId !== job.jobId);
  window.localStorage.setItem(
    ACTIVE_JOBS_STORAGE_KEY,
    JSON.stringify([...jobs, job].slice(-MAX_FILES)),
  );
}

export function forgetActiveJob(jobId: string) {
  if (typeof window === "undefined") return;
  const jobs = readStoredActiveJobs().filter((entry) => entry.jobId !== jobId);
  if (jobs.length === 0) {
    window.localStorage.removeItem(ACTIVE_JOBS_STORAGE_KEY);
  } else {
    window.localStorage.setItem(ACTIVE_JOBS_STORAGE_KEY, JSON.stringify(jobs));
  }
}
