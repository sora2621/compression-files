import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  Ban,
  CheckCircle2,
  FileCheck2,
  Gauge,
  Info,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type {
  AdvancedOptimizationMode,
  CandidateStatus,
  OptimizationCandidateReport,
  OptimizationReport,
  QualitySegment,
} from "@/lib/optimization/types";

export interface OptimizationReportCardProps {
  report: OptimizationReport;
  className?: string;
}

const modeLabels: Record<AdvancedOptimizationMode, string> = {
  "strict-lossless": "完全無劣化",
  "high-quality-optimization": "高画質最適化",
  "size-priority": "容量優先",
  archive: "アーカイブ",
};

const candidateStatusLabels: Record<CandidateStatus, string> = {
  selected: "採用",
  qualified: "基準通過・不採用",
  rejected: "基準未達",
  unavailable: "利用不可",
};

function formatBytes(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "計測できませんでした";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${Math.round(absolute)} B`;
  if (absolute < 1024 ** 2) return `${(absolute / 1024).toFixed(1)} KB`;
  if (absolute < 1024 ** 3) return `${(absolute / 1024 ** 2).toFixed(2)} MB`;
  return `${(absolute / 1024 ** 3).toFixed(2)} GB`;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "--:--";
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function QualitySegments({ segments }: { segments: QualitySegment[] }) {
  if (segments.length === 0) {
    return (
      <p className="mt-2 text-[10px] font-bold text-emerald-700">
        低品質区間は検出されませんでした。
      </p>
    );
  }

  return (
    <details className="mt-3 rounded-xl border border-amber-200 bg-white/70">
      <summary className="min-h-10 cursor-pointer px-3 py-2.5 text-[10px] font-black text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500">
        しきい値を下回った区間（{segments.length}件）
      </summary>
      <ul className="space-y-1 border-t border-amber-200 p-3 text-[10px] font-bold text-slate-700">
        {segments.map((segment, index) => (
          <li
            key={`${segment.startSeconds}-${segment.endSeconds}-${index}`}
            className="flex flex-wrap justify-between gap-2"
          >
            <span>
              {formatTime(segment.startSeconds)}〜{formatTime(segment.endSeconds)}
            </span>
            <span className="tabular-nums text-amber-700">
              VMAF {segment.score.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CandidateRow({ candidate }: { candidate: OptimizationCandidateReport }) {
  const statusColor =
    candidate.status === "qualified"
      ? "bg-sky-100 text-sky-700"
      : candidate.status === "rejected"
        ? "bg-rose-100 text-rose-700"
        : candidate.status === "unavailable"
          ? "bg-slate-200 text-slate-600"
          : "bg-emerald-100 text-emerald-700";

  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black text-slate-900">{candidate.label}</p>
          <p className="mt-1 text-[10px] font-bold uppercase text-slate-500">
            {[candidate.format, candidate.codec, candidate.method]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${statusColor}`}>
          {candidateStatusLabels[candidate.status]}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-600">
        <span>
          容量: <strong className="text-slate-900">{formatBytes(candidate.size)}</strong>
        </span>
        {candidate.vmafMean !== undefined && (
          <span>
            平均VMAF: <strong>{candidate.vmafMean.toFixed(1)}</strong>
          </span>
        )}
        {candidate.vmafMin !== undefined && (
          <span>
            最低VMAF: <strong>{candidate.vmafMin.toFixed(1)}</strong>
          </span>
        )}
        {candidate.losslessVerified !== undefined && (
          <span>
            無劣化検証: <strong>{candidate.losslessVerified ? "成功" : "不一致"}</strong>
          </span>
        )}
      </div>
      <p className="mt-2 text-[10px] font-medium leading-5 text-slate-600">
        {candidate.reason}
      </p>
      {candidate.verificationMethod && (
        <p className="mt-1 text-[9px] font-bold text-slate-400">
          検証方法: {candidate.verificationMethod}
        </p>
      )}
    </li>
  );
}

export function OptimizationReportCard({
  report,
  className,
}: OptimizationReportCardProps) {
  const savedBytes = report.originalSize - report.outputSize;
  const reduced = savedBytes >= 0;
  const unselectedCandidates = report.candidates.filter(
    (candidate) => candidate.id !== report.selectedCandidateId,
  );
  const lossless = report.losslessVerification;
  const losslessStyle =
    lossless.status === "passed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : lossless.status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-slate-200 bg-slate-50 text-slate-700";
  const LosslessIcon =
    lossless.status === "passed"
      ? CheckCircle2
      : lossless.status === "failed"
        ? XCircle
        : Info;

  return (
    <section
      aria-label="高度な最適化レポート"
      className={`overflow-hidden rounded-3xl border border-slate-200 bg-white soft-shadow ${className ?? ""}`}
    >
      <header className="border-b border-slate-200 bg-slate-50 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[10px] font-black tracking-wider text-[#5865e8]">
              <FileCheck2 size={14} aria-hidden="true" /> OPTIMIZATION REPORT
            </p>
            <h2 className="mt-2 text-xl font-black text-slate-900 sm:text-2xl">
              最適化結果
            </h2>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {modeLabels[report.mode]}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-black ${reduced ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
          >
            {reduced
              ? `${Math.abs(report.reductionPercent).toFixed(1)}%削減`
              : `容量が${Math.abs(report.reductionPercent).toFixed(1)}%増加`}
          </span>
        </div>
      </header>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div className={`rounded-2xl p-5 ${reduced ? "bg-emerald-50" : "bg-amber-50"}`}>
            <p
              className={`text-xs font-black ${reduced ? "text-emerald-700" : "text-amber-700"}`}
            >
              {reduced ? "削減できた容量" : "容量が増加しました"}
            </p>
            <p
              className={`mt-1 text-3xl font-black tabular-nums ${reduced ? "text-emerald-800" : "text-amber-800"}`}
            >
              {formatBytes(Math.abs(savedBytes))}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="font-bold text-slate-500">元の容量</dt>
                <dd className="mt-1 font-black text-slate-900">
                  {formatBytes(report.originalSize)}
                </dd>
              </div>
              <div className="rounded-xl bg-white/70 p-3">
                <dt className="font-bold text-slate-500">出力容量</dt>
                <dd className="mt-1 font-black text-slate-900">
                  {formatBytes(report.outputSize)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="text-[10px] font-black text-slate-500">採用した候補</p>
            <p className="mt-1 text-sm font-black text-slate-900">
              {report.selectedMethod}
            </p>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-slate-500">出力形式</dt>
                <dd className="font-black uppercase text-slate-900">
                  {report.selectedFormat}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-bold text-slate-500">コーデック</dt>
                <dd className="font-black uppercase text-slate-900">
                  {report.selectedCodec ?? "形式に準拠"}
                </dd>
              </div>
            </dl>
            <p className="mt-3 rounded-xl bg-indigo-50 p-3 text-[10px] font-bold leading-5 text-indigo-800">
              選定理由: {report.decisionReason}
            </p>
          </div>

          {report.keptOriginal && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-900">
              <p className="flex items-center gap-2 text-xs font-black">
                <Archive size={15} aria-hidden="true" /> 元ファイルを維持しました
              </p>
              <p className="mt-2 text-[10px] font-bold leading-5">
                維持した理由: {report.decisionReason}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className={`rounded-2xl border p-4 ${losslessStyle}`}>
            <p className="flex items-center gap-2 text-xs font-black">
              <LosslessIcon size={16} aria-hidden="true" />
              無劣化検証:{" "}
              {lossless.status === "passed"
                ? "成功"
                : lossless.status === "failed"
                  ? "失敗"
                  : "対象外"}
            </p>
            <p className="mt-2 text-[10px] font-bold">検証方法: {lossless.method}</p>
            <p className="mt-1 text-[10px] font-medium leading-5">{lossless.details}</p>
            {lossless.status === "passed" && (
              <p className="mt-2 flex items-start gap-1.5 text-[9px] font-black">
                <ShieldCheck size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                検証成功時のみ無劣化として表示しています。
              </p>
            )}
          </div>

          {report.qualityAssessment && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-2 text-xs font-black text-amber-900">
                <Gauge size={16} aria-hidden="true" /> 高画質基準を満たした候補
              </p>
              <p className="mt-2 text-[10px] font-medium leading-5 text-amber-800">
                VMAFは完全な画質保証ではありません。比較プレビューでも確認してください。
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {[
                  ["平均VMAF", report.qualityAssessment.vmafMean.toFixed(1)],
                  ["最低VMAF", report.qualityAssessment.vmafMin.toFixed(1)],
                  ["平均基準", report.qualityAssessment.threshold.toFixed(1)],
                  [
                    "フレーム基準",
                    report.qualityAssessment.minimumFrameThreshold.toFixed(1),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/70 p-2.5">
                    <dt className="text-[9px] font-bold text-slate-500">{label}</dt>
                    <dd className="mt-1 font-black tabular-nums text-slate-900">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <QualitySegments segments={report.qualityAssessment.lowQualitySegments} />
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 text-xs font-black text-slate-900">
              {unselectedCandidates.length > 0 ? (
                <Ban size={15} className="text-slate-500" aria-hidden="true" />
              ) : (
                <BadgeCheck size={15} className="text-emerald-600" aria-hidden="true" />
              )}
              不採用候補
            </h3>
            {unselectedCandidates.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {unselectedCandidates.map((candidate) => (
                  <CandidateRow key={candidate.id} candidate={candidate} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[10px] font-medium text-slate-500">
                比較対象となる別候補はありません。
              </p>
            )}
          </div>

          {report.candidates.some((candidate) => candidate.status === "unavailable") && (
            <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] font-medium leading-5 text-slate-600">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              利用不可の候補は、現在の実行環境に必要なエンコーダーや検証機能がないため生成していません。
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
