import { clampProgress } from "@/components/progress/utils";

import type { ProcessingStatus } from "@/components/progress/types";

export interface LinearProgressProps {
  progress: number;
  status?: ProcessingStatus;
  label?: string;
  showValue?: boolean;
  compact?: boolean;
  className?: string;
}

const barColors: Record<ProcessingStatus, string> = {
  "validating-settings": "bg-sky-500",
  "creating-job": "bg-sky-500",
  uploading: "bg-cyan-500",
  "analyzing-media": "bg-[#5865e8]",
  "estimating-output": "bg-indigo-500",
  queued: "bg-slate-400",
  pending: "bg-slate-400",
  analyzing: "bg-[#5865e8]",
  processing: "bg-[#5865e8]",
  enhancing: "bg-violet-600",
  encoding: "bg-orange-500",
  finalizing: "bg-[#5865e8]",
  completed: "bg-emerald-600",
  failed: "bg-rose-600",
  cancelled: "bg-slate-500",
};

export function LinearProgress({
  progress,
  status = "processing",
  label = "処理の進捗",
  showValue = true,
  compact = false,
  className,
}: LinearProgressProps) {
  const value = clampProgress(progress, status);

  return (
    <div className={className}>
      {(showValue || !compact) && (
        <div className="mb-2 flex items-center justify-between gap-3 text-xs font-bold">
          <span className="truncate text-slate-600">{label}</span>
          {showValue && (
            <span className="shrink-0 tabular-nums text-slate-900">
              {Math.round(value)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${Math.round(value)}%`}
        className={`${compact ? "h-1.5" : "h-2.5"} overflow-hidden rounded-full bg-slate-200`}
      >
        <div
          className={`h-full rounded-full ${barColors[status]} transition-[width] duration-300 ease-out motion-reduce:transition-none`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
