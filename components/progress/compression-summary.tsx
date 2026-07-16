"use client";

import {
  ArrowRight,
  Download,
  RefreshCw,
  ScanSearch,
  Scale,
  SlidersHorizontal,
} from "lucide-react";
import { useId } from "react";

import {
  calculateReduction,
  formatBytes,
  formatElapsedTime,
} from "@/components/progress/utils";

export interface CompressionSummaryProps {
  originalSize: number;
  outputSize: number;
  elapsedSeconds?: number;
  originalResolution?: string;
  outputResolution?: string;
  outputFormat?: string;
  outputCodec?: string;
  removedMetadata?: string[];
  downloadUrl?: string;
  downloadName?: string;
  onCompare?: () => void;
  onReprocess?: () => void;
  className?: string;
}

export function CompressionSummary({
  originalSize,
  outputSize,
  elapsedSeconds,
  originalResolution,
  outputResolution,
  outputFormat,
  outputCodec,
  removedMetadata = [],
  downloadUrl,
  downloadName,
  onCompare,
  onReprocess,
  className,
}: CompressionSummaryProps) {
  const titleId = useId();
  const reduction = calculateReduction(originalSize, outputSize);
  const savedBytes = originalSize - outputSize;
  const reduced = savedBytes >= 0;
  const outputWidth =
    originalSize > 0 ? Math.max(3, Math.min(100, (outputSize / originalSize) * 100)) : 0;

  return (
    <section
      className={`overflow-hidden rounded-3xl border border-slate-200 bg-white soft-shadow ${className ?? ""}`}
      aria-labelledby={titleId}
    >
      <div className="border-b border-emerald-200 bg-emerald-50 p-5 sm:p-7">
        <p className="text-xs font-black text-emerald-700">処理が完了しました</p>
        <h2 id={titleId} className="mt-1 text-2xl font-black text-emerald-950">
          ファイルをダウンロードできます
        </h2>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)]">
        <div>
          <div className={`rounded-2xl p-5 ${reduced ? "bg-emerald-50" : "bg-amber-50"}`}>
            <p
              className={`text-xs font-black ${reduced ? "text-emerald-700" : "text-amber-700"}`}
            >
              {reduced ? "削減率" : "容量が増加しました"}
            </p>
            <p
              className={`mt-1 text-4xl font-black tracking-tight tabular-nums ${
                reduced ? "text-emerald-700" : "text-amber-700"
              }`}
            >
              {reduction === null
                ? "計算不可"
                : `${reduction > 0 ? "−" : reduction < 0 ? "+" : ""}${Math.abs(reduction).toFixed(1)}%`}
            </p>
            <p className="mt-2 text-xs font-bold text-slate-600">
              {formatBytes(Math.abs(savedBytes))} {reduced ? "削減" : "増加"}
            </p>
          </div>

          <div className="mt-5 space-y-4" aria-label="処理前後の容量比較">
            <div>
              <div className="mb-1.5 flex justify-between gap-3 text-xs font-bold text-slate-500">
                <span>処理前</span>
                <span>{formatBytes(originalSize)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full w-full rounded-full bg-slate-300" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex justify-between gap-3 text-xs font-bold text-slate-700">
                <span>処理後</span>
                <span>{formatBytes(outputSize)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${reduced ? "bg-[#5865e8]" : "bg-amber-500"}`}
                  style={{ width: `${outputWidth}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <dl className="grid content-start gap-2 sm:grid-cols-2 lg:grid-cols-1">
          {originalResolution && outputResolution && (
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="flex items-center gap-2 text-[10px] font-black text-slate-500">
                <Scale size={13} aria-hidden="true" /> 解像度
              </dt>
              <dd className="mt-1 flex items-center gap-2 text-xs font-black text-slate-900">
                {originalResolution}
                <ArrowRight size={12} aria-hidden="true" />
                {outputResolution}
              </dd>
            </div>
          )}
          {(outputFormat || outputCodec) && (
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-[10px] font-black text-slate-500">出力</dt>
              <dd className="mt-1 text-xs font-black uppercase text-slate-900">
                {[outputFormat, outputCodec].filter(Boolean).join(" · ")}
              </dd>
            </div>
          )}
          {elapsedSeconds !== undefined && (
            <div className="rounded-xl bg-slate-50 p-3">
              <dt className="text-[10px] font-black text-slate-500">処理時間</dt>
              <dd className="mt-1 text-xs font-black tabular-nums text-slate-900">
                {formatElapsedTime(elapsedSeconds)}
              </dd>
            </div>
          )}
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="flex items-center gap-2 text-[10px] font-black text-slate-500">
              <ScanSearch size={13} aria-hidden="true" /> 削除したメタデータ
            </dt>
            <dd className="mt-1 text-xs font-black text-slate-900">
              {removedMetadata.length > 0 ? removedMetadata.join(" / ") : "なし"}
            </dd>
          </div>
        </dl>
      </div>

      {(downloadUrl || onCompare || onReprocess) && (
        <div className="flex flex-col gap-2 border-t border-slate-200 p-5 sm:flex-row sm:flex-wrap sm:items-center sm:p-7">
          {downloadUrl && (
            <div className="flex min-w-0 flex-col gap-1.5 sm:mr-2">
              <a
                href={downloadUrl}
                download={downloadName}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#5865e8] px-5 text-sm font-black text-white hover:bg-[#424dc5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8] focus-visible:ring-offset-2"
              >
                <Download size={16} aria-hidden="true" /> ダウンロード
              </a>
              {downloadName && (
                <p
                  className="max-w-72 truncate text-[10px] font-bold text-slate-500"
                  title={downloadName}
                >
                  保存名: {downloadName}
                </p>
              )}
            </div>
          )}
          {onCompare && (
            <button
              type="button"
              onClick={onCompare}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8]"
            >
              <SlidersHorizontal size={16} aria-hidden="true" /> 処理前後を比較
            </button>
          )}
          {onReprocess && (
            <button
              type="button"
              onClick={onReprocess}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8]"
            >
              <RefreshCw size={16} aria-hidden="true" /> 別設定で再処理
            </button>
          )}
        </div>
      )}
    </section>
  );
}
