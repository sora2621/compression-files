import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

import type { TargetSizeFeasibility } from "@/lib/target-size/types";

export interface TargetSizeWarningProps {
  enabled: boolean;
  originalBytes: number;
  targetBytes: number;
  feasibility?: TargetSizeFeasibility;
  className?: string;
}

export function TargetSizeWarning({
  enabled,
  originalBytes,
  targetBytes,
  feasibility,
  className,
}: TargetSizeWarningProps) {
  if (!enabled) return null;
  const compressionUnnecessary = targetBytes >= originalBytes && originalBytes > 0;

  return (
    <div className={`space-y-2 ${className ?? ""}`} aria-live="polite">
      {compressionUnnecessary && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-[10px] font-bold leading-5 text-sky-800"
        >
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          目標容量が元ファイル以上のため圧縮は不要です。元ファイルのまま保存できます。
        </p>
      )}
      {!compressionUnnecessary && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          目標容量モードは完全無劣化モードとは別です。指定容量へ近づけるため再エンコードし、画質・解像度・音声品質が変わる場合があります。
        </p>
      )}
      {(feasibility === "quality-risk" || feasibility === "difficult") && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold leading-5 text-rose-800"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {feasibility === "difficult"
            ? "現在の品質下限では目標達成が難しい見込みです。目標容量または許可する変更を見直してください。"
            : "目標達成には見た目の変化が大きくなる可能性があります。処理前後を必ず比較してください。"}
        </p>
      )}
    </div>
  );
}
