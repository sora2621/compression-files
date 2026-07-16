import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Lightbulb,
  RefreshCw,
  XCircle,
} from "lucide-react";

import type {
  TargetSizeRecommendationData,
  TargetSizeResult,
} from "@/lib/target-size/types";

export interface TargetSizeResultCardProps {
  result: TargetSizeResult;
  className?: string;
}

const alternativeLabels: Record<
  TargetSizeRecommendationData["alternatives"][number],
  string
> = {
  "keep-best-quality": "目標を超えても最良画質の候補を使う",
  "lower-quality-floor": "品質下限を下げて再試行する",
  "lower-resolution": "解像度の縮小を許可する",
  "lower-audio-quality": "音声ビットレートを下げる、または音声を削除する",
  "change-target": "目標容量を大きくする",
};

function formatBytes(bytes: number) {
  const absolute = Math.abs(bytes);
  if (!Number.isFinite(bytes)) return "不明";
  if (absolute < 1024) return `${Math.round(absolute)} B`;
  if (absolute < 1024 ** 2) return `${(absolute / 1024).toFixed(1)} KB`;
  if (absolute < 1024 ** 3) return `${(absolute / 1024 ** 2).toFixed(2)} MB`;
  return `${(absolute / 1024 ** 3).toFixed(2)} GB`;
}

export function TargetSizeResultCard({ result, className }: TargetSizeResultCardProps) {
  const StatusIcon = result.achieved ? CheckCircle2 : XCircle;
  const exceeded = !result.achieved && result.differenceBytes > 0;
  const saved = result.savedBytes >= 0;

  return (
    <section
      aria-label="目標容量の処理結果"
      aria-live="polite"
      className={`overflow-hidden rounded-3xl border bg-white soft-shadow ${
        result.achieved ? "border-emerald-200" : "border-amber-200"
      } ${className ?? ""}`}
    >
      <header
        className={`p-5 sm:p-7 ${result.achieved ? "bg-emerald-50" : "bg-amber-50"}`}
      >
        <div className="flex items-start gap-3">
          <StatusIcon
            size={24}
            className={`shrink-0 ${result.achieved ? "text-emerald-700" : "text-amber-700"}`}
            aria-hidden="true"
          />
          <div>
            <p
              className={`text-xs font-black ${result.achieved ? "text-emerald-700" : "text-amber-800"}`}
            >
              {result.achieved
                ? "目標容量を達成しました"
                : "目標容量を達成できませんでした"}
            </p>
            <h2 className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">
              {formatBytes(result.actualBytes)}
            </h2>
            <p className="mt-1 text-[10px] font-bold text-slate-600">
              目標 {formatBytes(result.requestedBytes)}
              {exceeded
                ? `・${formatBytes(result.differenceBytes)}超過`
                : `・${formatBytes(Math.abs(result.differenceBytes))}の余裕`}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <dl className="grid grid-cols-2 gap-2">
            {[
              ["元の容量", formatBytes(result.originalBytes)],
              ["実際の容量", formatBytes(result.actualBytes)],
              [saved ? "削減容量" : "増加容量", formatBytes(Math.abs(result.savedBytes))],
              [
                saved ? "削減率" : "増加率",
                `${Math.abs(result.reductionPercent).toFixed(1)}%`,
              ],
              ["探索回数", `${result.attempts}回`],
              [
                "選択品質",
                result.selectedQuality === null
                  ? "該当なし"
                  : String(result.selectedQuality),
              ],
              ["選択解像度", result.selectedResolution ?? "元のまま"],
              ["選択コーデック", result.selectedCodec ?? "元形式を維持"],
              [
                "音声",
                result.selectedAudioKbps === null
                  ? "元のまま・なし"
                  : `${result.selectedAudioKbps}kbps`,
              ],
              [
                "目標との差",
                `${result.differenceBytes > 0 ? "+" : "−"}${formatBytes(Math.abs(result.differenceBytes))}`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[9px] font-black text-slate-500">{label}</dt>
                <dd className="mt-1 break-words text-xs font-black tabular-nums text-slate-900">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 rounded-xl border border-slate-200 p-4">
            <p className="flex items-center gap-2 text-xs font-black text-slate-900">
              <Gauge size={15} className="text-[#5865e8]" aria-hidden="true" />{" "}
              処理結果の理由
            </p>
            <p className="mt-2 text-[10px] font-medium leading-5 text-slate-600">
              {result.reason}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {!result.achieved && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-4"
            >
              <p className="flex items-center gap-2 text-xs font-black text-amber-900">
                <AlertTriangle size={15} aria-hidden="true" /> 超過した理由
              </p>
              <p className="mt-2 text-[10px] font-bold leading-5 text-amber-800">
                {result.reason}
              </p>
              {result.recommendation && (
                <p className="mt-2 text-[10px] font-medium leading-5 text-amber-800">
                  現在の品質下限での推定最小容量は{" "}
                  {formatBytes(result.recommendation.minimumAchievableBytes)} です。
                </p>
              )}
            </div>
          )}

          {result.recommendation && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <h3 className="flex items-center gap-2 text-xs font-black text-sky-900">
                <Lightbulb size={15} aria-hidden="true" /> 代替選択肢
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                <div className="rounded-xl bg-white/70 p-2.5">
                  <dt className="font-bold text-slate-500">推奨解像度</dt>
                  <dd className="mt-1 font-black text-slate-900">
                    {result.recommendation.recommendedHeight
                      ? `${result.recommendation.recommendedHeight}p`
                      : "変更なし"}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/70 p-2.5">
                  <dt className="font-bold text-slate-500">推奨コーデック</dt>
                  <dd className="mt-1 font-black uppercase text-slate-900">
                    {result.recommendation.recommendedCodec ?? "変更なし"}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/70 p-2.5">
                  <dt className="font-bold text-slate-500">推奨音声</dt>
                  <dd className="mt-1 font-black text-slate-900">
                    {result.recommendation.recommendedAudioKbps
                      ? `${result.recommendation.recommendedAudioKbps}kbps`
                      : "変更なし"}
                  </dd>
                </div>
                <div className="rounded-xl bg-white/70 p-2.5">
                  <dt className="font-bold text-slate-500">影響</dt>
                  <dd className="mt-1 font-black text-slate-900">
                    {result.recommendation.impact}
                  </dd>
                </div>
              </dl>
              {result.recommendation.alternatives.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {result.recommendation.alternatives.map((alternative) => (
                    <li
                      key={alternative}
                      className="flex items-start gap-2 rounded-xl bg-white/70 p-3 text-[10px] font-bold leading-5 text-sky-900"
                    >
                      <RefreshCw size={12} className="mt-1 shrink-0" aria-hidden="true" />
                      {alternativeLabels[alternative]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
