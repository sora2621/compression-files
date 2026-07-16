import { Check, X } from "lucide-react";

import { clampProgress } from "@/components/progress/utils";

import type { ProcessingStatus } from "@/components/progress/types";

export interface CircularProgressProps {
  progress: number;
  status?: ProcessingStatus;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

const strokeColors: Record<ProcessingStatus, string> = {
  "validating-settings": "#0ea5e9",
  "creating-job": "#0ea5e9",
  uploading: "#06b6d4",
  "analyzing-media": "#5865e8",
  "estimating-output": "#6366f1",
  queued: "#94a3b8",
  pending: "#94a3b8",
  analyzing: "#5865e8",
  processing: "#5865e8",
  enhancing: "#7c3aed",
  encoding: "#f97316",
  finalizing: "#5865e8",
  completed: "#059669",
  failed: "#e11d48",
  cancelled: "#64748b",
};

export function CircularProgress({
  progress,
  status = "processing",
  size = 136,
  strokeWidth = 10,
  label = "全体の進捗",
  className,
}: CircularProgressProps) {
  const value = clampProgress(progress, status);
  const center = size / 2;
  const radius = Math.max(0, center - strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div
      className={`relative inline-grid shrink-0 place-items-center ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={`${Math.round(value)}%`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColors[status]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">
        {status === "completed" ? (
          <span className="grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={26} strokeWidth={3} aria-hidden="true" />
            <span className="sr-only">完了</span>
          </span>
        ) : status === "failed" ? (
          <span className="grid size-12 place-items-center rounded-full bg-rose-50 text-rose-600">
            <X size={26} strokeWidth={3} aria-hidden="true" />
            <span className="sr-only">エラー</span>
          </span>
        ) : (
          <span>
            <span className="block text-2xl font-black tabular-nums text-slate-900">
              {Math.round(value)}%
            </span>
            <span className="mt-0.5 block text-[9px] font-black tracking-wider text-slate-400">
              PROGRESS
            </span>
          </span>
        )}
      </span>
    </div>
  );
}
