"use client";

import { ArrowLeft, CheckCircle2, Clock3, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";
import { MobileImageDownloadButton } from "@/components/files/mobile-image-download-button";
import { OptimizationReportCard } from "@/components/optimization-report-card";
import { CompressionSummary, ErrorCard } from "@/components/progress";
import { TargetSizeResultCard } from "@/components/target-size/TargetSizeResultCard";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import {
  BeforeAfterImage,
  BeforeAfterVideo,
  CompressionComparison,
} from "@/components/workspace/before-after";
import { userFriendlyError } from "@/lib/ui/error-messages";

import type { OptimizationReport } from "@/lib/optimization/types";
import type { TargetSizeResult } from "@/lib/target-size/types";

interface ResultData {
  jobId: string;
  kind: "image" | "video" | "audio" | "ai-image" | "ai-video";
  fileName: string;
  outputName: string;
  outputMime: string;
  outputFormat: string;
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  reductionPercent: number | null;
  elapsedSeconds?: number;
  inputFormat?: string;
  originalWidth?: number;
  originalHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  originalCodec?: string;
  outputCodec?: string;
  metadataRemoved: boolean;
  downloadUrl: string;
  previewUrls: {
    image: string | null;
    original: string | null;
    before: string | null;
    after: string | null;
  };
  createdAt: string;
  expiresAt?: string;
  optimizationReport?: OptimizationReport;
  targetSizeResult?: TargetSizeResult;
}

function displayKind(kind: ResultData["kind"]): "image" | "video" | "audio" {
  if (kind === "ai-image") return "image";
  if (kind === "ai-video") return "video";
  return kind;
}

export function ResultPage({ jobId }: { jobId: string }) {
  const { addHistory } = useWorkspace();
  const [result, setResult] = useState<ResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/results/${jobId}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as
          ResultData | { error?: string; code?: string };
        if (!response.ok || !("outputName" in payload))
          throw new Error(
            "error" in payload
              ? userFriendlyError(payload.code, payload.error)
              : "処理結果を取得できませんでした。",
          );
        if (!active) return;
        setResult(payload);
        const kind = displayKind(payload.kind);
        addHistory({
          jobId: payload.jobId,
          kind,
          originalName: payload.fileName,
          outputName: payload.outputName,
          originalSize: payload.originalSize,
          outputSize: payload.outputSize,
          reductionPercent: payload.reductionPercent ?? 0,
          outputFormat: payload.outputFormat,
          downloadUrl: payload.downloadUrl,
          createdAt: payload.createdAt,
          expiresAt:
            payload.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      })
      .catch(
        (reason: unknown) =>
          active &&
          setError(
            reason instanceof Error ? reason.message : "処理結果を取得できませんでした。",
          ),
      );
    return () => {
      active = false;
    };
  }, [addHistory, jobId]);

  if (!result && !error)
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-10 sm:px-6">
        <LoadingSkeleton rows={5} />
      </main>
    );
  if (!result)
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-4xl px-4 py-12 sm:px-6">
        <ErrorCard
          message={error ?? "結果が見つかりません。"}
          onRetry={() => window.location.reload()}
          onChangeSettings={() => window.location.assign("/optimize")}
        />
      </main>
    );

  const kind = displayKind(result.kind);
  const isImageResult = kind === "image";
  const beforeResolution =
    result.originalWidth && result.originalHeight
      ? `${result.originalWidth}×${result.originalHeight}`
      : undefined;
  const afterResolution =
    result.outputWidth && result.outputHeight
      ? `${result.outputWidth}×${result.outputHeight}`
      : undefined;
  const expiresLabel = result.expiresAt
    ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(
        new Date(result.expiresAt),
      )
    : "約30分後";

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)]">
      <div
        className={`mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 ${
          isImageResult ? "pb-52 md:pb-12" : ""
        }`}
      >
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-black text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={16} /> 3 / 3　最適化完了
            </p>
            <h1 className="mt-2 text-2xl font-black text-[var(--text)] sm:text-4xl">
              ファイルの準備ができました
            </h1>
          </div>
          <p className="flex items-center gap-2 rounded-xl bg-[var(--surface-subtle)] px-3 py-2 text-xs font-bold text-[var(--muted)]">
            <Clock3 size={14} /> {expiresLabel}ごろ自動削除
          </p>
        </div>

        <CompressionSummary
          originalSize={result.originalSize}
          outputSize={result.outputSize}
          elapsedSeconds={result.elapsedSeconds}
          originalResolution={beforeResolution}
          outputResolution={afterResolution}
          outputFormat={result.outputFormat}
          outputCodec={result.outputCodec}
          removedMetadata={result.metadataRemoved ? ["メタデータ"] : []}
          downloadUrl={result.downloadUrl}
          downloadName={result.outputName}
          hideDownloadOnMobile={isImageResult}
          onCompare={() =>
            document.getElementById("comparison")?.scrollIntoView({ behavior: "smooth" })
          }
          onReprocess={() => window.location.assign("/optimize")}
        />

        {result.optimizationReport && (
          <OptimizationReportCard report={result.optimizationReport} className="mt-6" />
        )}
        {result.targetSizeResult && (
          <TargetSizeResultCard result={result.targetSizeResult} className="mt-6" />
        )}

        <section
          id="comparison"
          className="mt-6 scroll-mt-20 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6"
          aria-labelledby="comparison-title"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="comparison-title" className="text-lg font-black text-[var(--text)]">
                処理前後を比較
              </h2>
              <p className="mt-1 text-xs font-medium text-[var(--muted)]">
                容量・解像度・形式の変化を確認できます。
              </p>
            </div>
            <a
              href={result.downloadUrl}
              download={result.outputName}
              className="hidden min-h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-xs font-black text-white sm:inline-flex"
            >
              <Download size={15} /> ダウンロード
            </a>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
            <div>
              {kind === "image" &&
              result.previewUrls.original &&
              result.previewUrls.image ? (
                <BeforeAfterImage
                  beforeUrl={result.previewUrls.original}
                  afterUrl={result.previewUrls.image}
                />
              ) : kind === "video" &&
                result.previewUrls.before &&
                result.previewUrls.after ? (
                <BeforeAfterVideo
                  beforeUrl={result.previewUrls.before}
                  afterUrl={result.previewUrls.after}
                />
              ) : result.previewUrls.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.previewUrls.image}
                  alt="処理後のプレビュー"
                  className="max-h-[560px] w-full rounded-2xl bg-slate-950 object-contain"
                />
              ) : (
                <div className="grid min-h-64 place-items-center rounded-2xl bg-[var(--surface-subtle)] text-sm font-bold text-[var(--muted)]">
                  プレビューはありません
                </div>
              )}
            </div>
            <div className="space-y-4">
              <CompressionComparison
                originalSize={result.originalSize}
                outputSize={result.outputSize}
              />
              <dl className="grid gap-2 text-xs">
                {[
                  ["形式", `${result.inputFormat ?? "不明"} → ${result.outputFormat}`],
                  [
                    "解像度",
                    `${beforeResolution ?? "不明"} → ${afterResolution ?? "不明"}`,
                  ],
                  [
                    "コーデック",
                    `${result.originalCodec ?? "不明"} → ${result.outputCodec ?? "不明"}`,
                  ],
                  ["メタデータ", result.metadataRemoved ? "削除済み" : "変更なし"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex justify-between gap-4 rounded-xl bg-[var(--surface-subtle)] p-3"
                  >
                    <dt className="font-bold text-[var(--muted)]">{label}</dt>
                    <dd className="text-right font-black text-[var(--text)]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-xs font-black text-[var(--text)]"
          >
            <ArrowLeft size={15} /> 別のファイルを追加
          </Link>
        </div>
      </div>
      {isImageResult && (
        <MobileImageDownloadButton
          downloadUrl={result.downloadUrl}
          originalFileName={result.fileName}
          outputExtension={result.outputFormat}
          outputMimeType={result.outputMime}
        />
      )}
    </main>
  );
}
