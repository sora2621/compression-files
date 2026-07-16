"use client";

import { Clock3, FileCheck2, FileCog, Hourglass, Square } from "lucide-react";

import { CircularProgress } from "@/components/progress/circular-progress";
import {
  clampProgress,
  formatBytes,
  formatElapsedTime,
  processingStatusLabels,
} from "@/components/progress/utils";

import type { ProgressEvent } from "@/components/progress/types";
import type { ReactNode } from "react";

export interface OverallProgressCardProps {
  event: ProgressEvent;
  fileName: string;
  completedFiles?: number;
  totalFiles?: number;
  savedBytes?: number;
  preview?: ReactNode;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  className?: string;
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export function OverallProgressCard({
  event,
  fileName,
  completedFiles,
  totalFiles,
  savedBytes,
  preview,
  onCancel,
  cancelDisabled = false,
  className,
}: OverallProgressCardProps) {
  const canCancel = Boolean(onCancel) && !terminalStatuses.has(event.status);
  const progress = clampProgress(event.progress, event.status);
  const hasFileCount =
    typeof completedFiles === "number" && typeof totalFiles === "number";
  const eta =
    event.estimatedRemainingSeconds === undefined
      ? event.progress < 3
        ? "推定時間を取得しています"
        : "計算中"
      : `約${formatElapsedTime(event.estimatedRemainingSeconds)}`;

  return (
    <section
      className={`overflow-hidden rounded-3xl border border-slate-200 bg-white soft-shadow ${className ?? ""}`}
      aria-labelledby={`overall-progress-${event.jobId}`}
      aria-busy={!terminalStatuses.has(event.status)}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(330px,0.72fr)]">
        {preview && (
          <div className="min-h-52 border-b border-slate-200 bg-slate-950 lg:border-b-0 lg:border-r">
            {preview}
          </div>
        )}

        <div
          className={`grid gap-6 p-5 sm:p-7 ${preview ? "" : "lg:col-span-2 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center"}`}
        >
          <div className="flex justify-center lg:justify-start">
            <CircularProgress
              progress={progress}
              status={event.status}
              label="全体の処理進捗"
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-black text-[#5865e8]">
                  <FileCog size={15} aria-hidden="true" />
                  {processingStatusLabels[event.status]}
                </p>
                <h2
                  id={`overall-progress-${event.jobId}`}
                  className="mt-2 text-xl font-black tracking-tight text-slate-900 sm:text-2xl"
                >
                  {event.message || event.stage}
                </h2>
                <p
                  className="mt-2 truncate text-sm font-bold text-slate-500"
                  title={fileName}
                >
                  {fileName}
                </p>
              </div>

              {canCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={cancelDisabled}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-xs font-black text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square size={13} fill="currentColor" aria-hidden="true" />
                  処理をキャンセル
                </button>
              )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="flex items-center gap-2 text-[11px] font-black text-slate-500">
                  <Clock3 size={14} aria-hidden="true" /> 経過時間
                </p>
                <p className="mt-1 text-lg font-black tabular-nums text-slate-900">
                  {formatElapsedTime(event.elapsedSeconds)}
                </p>
              </div>
              <div className="rounded-2xl bg-indigo-50 p-4">
                <p className="flex items-center gap-2 text-[11px] font-black text-indigo-600">
                  <Hourglass size={14} aria-hidden="true" /> 推定残り時間
                </p>
                <p className="mt-1 text-sm font-black tabular-nums text-indigo-950">
                  {event.status === "completed"
                    ? "完了"
                    : event.status === "failed" || event.status === "cancelled"
                      ? "--"
                      : eta}
                </p>
                <p className="mt-1 text-[10px] font-medium text-indigo-500">
                  推定値のため前後する場合があります
                </p>
              </div>
            </div>

            {(hasFileCount || typeof savedBytes === "number") && (
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600">
                {hasFileCount && (
                  <span className="flex items-center gap-2">
                    <FileCheck2
                      size={15}
                      className="text-emerald-600"
                      aria-hidden="true"
                    />
                    <strong className="tabular-nums text-slate-900">
                      {completedFiles} / {totalFiles}
                    </strong>
                    ファイル完了
                  </span>
                )}
                {typeof savedBytes === "number" && (
                  <span>
                    現在までに
                    <strong
                      className={savedBytes >= 0 ? "text-emerald-700" : "text-amber-700"}
                    >
                      {formatBytes(Math.abs(savedBytes))}
                      {savedBytes >= 0 ? "削減" : "増加"}
                    </strong>
                  </span>
                )}
              </div>
            )}

            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {processingStatusLabels[event.status]}。{event.message || event.stage}。
              進捗{Math.round(progress)}パーセント。
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
