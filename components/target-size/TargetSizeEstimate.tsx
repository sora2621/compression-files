import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import type {
  TargetSizeEstimate as TargetSizeEstimateData,
  TargetSizeFeasibility,
} from "@/lib/target-size/types";

export interface TargetSizeEstimateProps {
  estimate: TargetSizeEstimateData | null;
  className?: string;
}

const feasibilityStyles: Record<
  TargetSizeFeasibility,
  { label: string; style: string; icon: typeof CheckCircle2 }
> = {
  achievable: {
    label: "達成できる見込み",
    style: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: CheckCircle2,
  },
  "settings-recommended": {
    label: "設定変更をおすすめ",
    style: "border-sky-200 bg-sky-50 text-sky-800",
    icon: SlidersHorizontal,
  },
  "quality-risk": {
    label: "画質低下の可能性",
    style: "border-amber-200 bg-amber-50 text-amber-800",
    icon: AlertTriangle,
  },
  difficult: {
    label: "達成が難しい",
    style: "border-rose-200 bg-rose-50 text-rose-800",
    icon: XCircle,
  },
};

const qualityLabels: Record<TargetSizeEstimateData["qualityImpact"], string> = {
  none: "ほぼなし",
  small: "小さい",
  moderate: "中程度",
  large: "大きい",
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "計算中";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "計算中";
  if (seconds < 60) return `約${Math.ceil(seconds)}秒`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.ceil(seconds % 60);
  return `約${minutes}分${remaining > 0 ? `${remaining}秒` : ""}`;
}

export function TargetSizeEstimate({ estimate, className }: TargetSizeEstimateProps) {
  if (!estimate) {
    return (
      <section
        className={`rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 ${className ?? ""}`}
        aria-live="polite"
      >
        <p className="flex items-center gap-2 text-xs font-black text-slate-600">
          <Gauge size={15} aria-hidden="true" /> リアルタイム推定を準備しています
        </p>
        <p className="mt-2 text-[10px] font-medium leading-5 text-slate-500">
          ファイル解析が終わると、容量・処理時間・品質への影響を表示します。
        </p>
      </section>
    );
  }

  const feasibility = feasibilityStyles[estimate.feasibility];
  const FeasibilityIcon = feasibility.icon;
  const outputDescription = [estimate.outputFormat, estimate.codec]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${className ?? ""}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-black text-slate-800">
            <Gauge size={15} className="text-[#5865e8]" aria-hidden="true" />{" "}
            リアルタイム推定
          </p>
          <p className="mt-1 text-[10px] font-medium text-slate-500">
            実際の結果はファイル内容により前後します。
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black ${feasibility.style}`}
        >
          <FeasibilityIcon size={13} aria-hidden="true" /> {feasibility.label}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["元の容量", formatBytes(estimate.originalBytes)],
          ["目標容量", formatBytes(estimate.targetBytes)],
          ["約出力容量", formatBytes(estimate.estimatedOutputBytes)],
          ["約削減率", `${estimate.estimatedReductionPercent.toFixed(1)}%`],
          ["約処理時間", formatDuration(estimate.estimatedProcessingSeconds)],
          ["画質への影響", qualityLabels[estimate.qualityImpact]],
          [
            "解像度",
            estimate.resolutionChange && estimate.recommendedHeight
              ? `${estimate.recommendedHeight}pを提案`
              : "元のまま",
          ],
          ["形式・コーデック", outputDescription || "元形式を優先"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 p-3">
            <dt className="text-[9px] font-black text-slate-500">{label}</dt>
            <dd className="mt-1 break-words text-xs font-black tabular-nums text-slate-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 flex items-start gap-2 rounded-xl bg-indigo-50 p-3 text-[10px] font-bold leading-5 text-indigo-800">
        <Clock3 size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {estimate.message}
      </p>
    </section>
  );
}
