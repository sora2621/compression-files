"use client";

import { Ban, FileAudio, FileImage, FileVideo, RefreshCw, Square } from "lucide-react";

import { LinearProgress } from "@/components/progress/linear-progress";
import {
  clampProgress,
  fileStatusLabels,
  formatBytes,
} from "@/components/progress/utils";

import type { FileProgressItem } from "@/components/progress/types";

export interface FileProgressCardProps {
  item: FileProgressItem;
  onRetry?: (id: string) => void;
  onCancel?: (id: string) => void;
  className?: string;
}

const mediaIcons = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
};

function progressStatus(item: FileProgressItem) {
  if (item.status === "completed") return "completed" as const;
  if (item.status === "failed") return "failed" as const;
  if (item.status === "cancelled") return "cancelled" as const;
  if (item.status === "pending") return "pending" as const;
  if (item.status === "enhancing") return "enhancing" as const;
  return "processing" as const;
}

export function FileProgressCard({
  item,
  onRetry,
  onCancel,
  className,
}: FileProgressCardProps) {
  const Icon = mediaIcons[item.kind];
  const isActive = !["pending", "completed", "failed", "cancelled"].includes(item.status);
  const progress = clampProgress(item.progress, item.status);

  return (
    <article
      className={`rounded-2xl border border-slate-200 bg-white p-4 ${className ?? ""}`}
      aria-labelledby={`file-progress-${item.id}`}
      aria-busy={isActive}
    >
      <div className="flex items-start gap-3">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-slate-500">
          {item.thumbnail ??
            (item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <Icon size={24} aria-hidden="true" />
            ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3
                id={`file-progress-${item.id}`}
                className="truncate text-sm font-black text-slate-900"
                title={item.fileName}
              >
                {item.fileName}
              </h3>
              <p className="mt-1 text-[11px] font-bold uppercase text-slate-500">
                {item.format ?? item.kind} · {formatBytes(item.originalSize)}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                item.status === "completed"
                  ? "bg-emerald-100 text-emerald-700"
                  : item.status === "failed"
                    ? "bg-rose-100 text-rose-700"
                    : item.status === "cancelled"
                      ? "bg-slate-200 text-slate-700"
                      : isActive
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-slate-100 text-slate-500"
              }`}
            >
              {fileStatusLabels[item.status]}
            </span>
          </div>

          <LinearProgress
            progress={progress}
            status={progressStatus(item)}
            label={item.stage || fileStatusLabels[item.status]}
            compact
            className="mt-4"
          />

          {item.status === "completed" && typeof item.outputSize === "number" && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-600">
              <span>
                処理後{" "}
                <strong className="text-slate-900">{formatBytes(item.outputSize)}</strong>
              </span>
              {typeof item.reductionPercent === "number" && (
                <span
                  className={
                    item.reductionPercent >= 0 ? "text-emerald-700" : "text-amber-700"
                  }
                >
                  {item.reductionPercent >= 0
                    ? `${item.reductionPercent.toFixed(1)}%削減`
                    : `${Math.abs(item.reductionPercent).toFixed(1)}%増加`}
                </span>
              )}
            </div>
          )}

          {item.errorMessage && (
            <p className="mt-3 rounded-lg bg-rose-50 p-2 text-xs font-bold leading-5 text-rose-700">
              {item.errorMessage}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {(item.status === "failed" || item.status === "cancelled") && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8]"
              >
                <RefreshCw size={13} aria-hidden="true" /> 再試行
              </button>
            )}
            {isActive && onCancel && (
              <button
                type="button"
                onClick={() => onCancel(item.id)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <Square size={11} fill="currentColor" aria-hidden="true" /> 個別キャンセル
              </button>
            )}
            {item.status === "cancelled" && !onRetry && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                <Ban size={13} aria-hidden="true" /> キャンセル済み
              </span>
            )}
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {item.fileName}、{fileStatusLabels[item.status]}、進捗{Math.round(progress)}
        パーセント
      </p>
    </article>
  );
}
