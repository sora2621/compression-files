"use client";

import { Lightbulb, MonitorUp } from "lucide-react";
import { useId } from "react";

import type { TargetSizeEstimate } from "@/lib/target-size/types";

export interface TargetSizeRecommendationProps {
  estimate: TargetSizeEstimate | null;
  allowResolutionChange: boolean;
  disabled?: boolean;
  onAllowResolutionChangeChange: (allowed: boolean) => void;
}

export function TargetSizeRecommendation({
  estimate,
  allowResolutionChange,
  disabled = false,
  onAllowResolutionChangeChange,
}: TargetSizeRecommendationProps) {
  const titleId = useId();
  if (!estimate?.resolutionChange || !estimate.recommendedHeight) return null;

  return (
    <aside
      className="rounded-2xl border border-sky-200 bg-sky-50 p-4"
      aria-labelledby={titleId}
    >
      <h3
        id={titleId}
        className="flex items-center gap-2 text-xs font-black text-sky-900"
      >
        <Lightbulb size={15} aria-hidden="true" /> 解像度変更の提案
      </h3>
      <p className="mt-2 text-[10px] font-medium leading-5 text-sky-800">
        目標容量に近づける候補として、{estimate.recommendedHeight}
        pへの縮小を提案します。自動では適用しません。
      </p>
      <label
        className={`mt-3 flex items-start gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2 ${
          allowResolutionChange ? "border-sky-400 bg-white" : "border-sky-200 bg-white/70"
        } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          checked={allowResolutionChange}
          disabled={disabled}
          onChange={(event) => onAllowResolutionChangeChange(event.target.checked)}
          className="mt-0.5 size-4 accent-sky-600"
        />
        <span>
          <span className="flex items-center gap-1.5 text-xs font-black text-slate-900">
            <MonitorUp size={14} aria-hidden="true" /> 解像度変更を許可する
          </span>
          <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
            チェックした場合だけ縮小候補を生成します。元のアスペクト比は維持します。
          </span>
        </span>
      </label>
    </aside>
  );
}
