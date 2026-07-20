"use client";

import {
  Archive,
  ArrowLeft,
  BadgeCheck,
  Gauge,
  LoaderCircle,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";
import { CompressionApp } from "@/components/compression-app";
import { EmptyState } from "@/components/ui/empty-state";
import { UseCaseConfirmation } from "@/components/use-case-presets/use-case-confirmation";
import { UseCaseSelector } from "@/components/use-case-presets/use-case-selector";
import { ProcessingModeCard } from "@/components/workspace/processing-mode-card";
import {
  QualityPresetCard,
  type QualityPreset,
} from "@/components/workspace/quality-preset-card";
import { RecommendationCard } from "@/components/workspace/recommendation-card";
import { analyzeFiles } from "@/features/use-case-presets/analyze-files";
import {
  recommendUseCase,
  resolveAllPresets,
} from "@/features/use-case-presets/resolve-preset";

import type {
  FileAnalysisSummary,
  ResolvedUseCasePreset,
  UseCaseId,
} from "@/features/use-case-presets/types";

type Stage = "select" | "confirm" | "manual" | "processing";
type GuidedMode =
  "strict-lossless" | "high-quality-optimization" | "size-priority" | "archive";

const guidedModes = [
  {
    id: "strict-lossless",
    icon: BadgeCheck,
    title: "完全無劣化",
    description: "データを変更せず、検証に成功した結果だけを採用します。",
    duration: "標準",
    reduction: "小〜中",
  },
  {
    id: "high-quality-optimization",
    icon: Trophy,
    title: "高画質最適化",
    description: "見た目を維持しながら品質基準を満たす候補を探索します。",
    duration: "長め",
    reduction: "中〜大",
  },
  {
    id: "size-priority",
    icon: Gauge,
    title: "容量優先",
    description: "多少の変化を許容し、共有しやすい容量まで削減します。",
    duration: "標準",
    reduction: "大",
  },
  {
    id: "archive",
    icon: Archive,
    title: "アーカイブ",
    description: "将来の復元性と容量のバランスを重視します。",
    duration: "長め",
    reduction: "形式による",
  },
] as const;

export function OptimizePage() {
  const { files } = useWorkspace();
  const [analysis, setAnalysis] = useState<FileAnalysisSummary | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<UseCaseId | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [legacyMode, setLegacyMode] = useState<GuidedMode>("high-quality-optimization");
  const [legacyPreset, setLegacyPreset] = useState<QualityPreset>("balanced");
  const [legacyRecommendationApplied, setLegacyRecommendationApplied] = useState(false);

  useEffect(() => {
    if (files.length === 0) return;
    let active = true;
    void analyzeFiles(files)
      .then((result) => {
        if (active) setAnalysis(result);
      })
      .catch((error: unknown) => {
        if (active)
          setAnalysisError(
            error instanceof Error ? error.message : "ファイルを解析できませんでした。",
          );
      });
    return () => {
      active = false;
    };
  }, [files]);

  const presets = useMemo(
    () => (analysis ? resolveAllPresets(analysis) : []),
    [analysis],
  );
  const selectedPreset = useMemo<ResolvedUseCasePreset | null>(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId],
  );

  if (files.length === 0) {
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-5xl px-4 py-12 sm:px-6">
        <EmptyState
          title="最適化するファイルがありません"
          description="トップページで画像・動画・音声を追加してから、用途を選択してください。"
          action={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white"
            >
              <ArrowLeft size={16} /> ファイルを追加
            </Link>
          }
        />
      </main>
    );
  }

  if (!analysis) {
    return (
      <main className="grid min-h-[calc(100vh-4rem)] place-items-center bg-[var(--page)] px-4">
        <div className="text-center" role="status" aria-live="polite">
          <LoaderCircle
            className="mx-auto animate-spin text-[var(--primary)]"
            size={36}
          />
          <h1 className="mt-5 text-xl font-black text-[var(--text)]">
            ファイルを解析しています
          </h1>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">
            種類・容量・解像度・透過・再生時間を確認中です。
          </p>
          {analysisError && (
            <p className="mt-3 text-xs font-bold text-rose-600">{analysisError}</p>
          )}
        </div>
      </main>
    );
  }

  if (stage === "manual" || stage === "processing") {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)] pb-16">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-[var(--primary)]">
                {stage === "processing" ? "3 / 3　処理を実行" : "詳細設定"}
              </p>
              <h1 className="mt-1 text-2xl font-black text-[var(--text)]">
                {stage === "processing"
                  ? `${selectedPreset?.label ?? "カスタム"}設定で処理します`
                  : "設定を確認・変更してください"}
              </h1>
            </div>
            {stage === "manual" && (
              <button
                type="button"
                onClick={() => setStage(selectedPreset ? "confirm" : "select")}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-xs font-black text-[var(--text)]"
              >
                <ArrowLeft size={15} /> 用途選択へ戻る
              </button>
            )}
          </div>
          <CompressionApp
            key={`${stage}:${selectedId ?? "custom"}`}
            initialFiles={files}
            embedded
            initialMode={legacyMode}
            initialPreset={legacyPreset}
            initialSettings={selectedPreset?.settings}
            autoStart={stage === "processing"}
            openDetails={stage === "manual"}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)] pb-20">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-7 flex justify-end">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-xs font-black text-[var(--text)]"
          >
            <ArrowLeft size={15} /> ファイルを変更
          </Link>
        </div>
        {stage === "select" ? (
          <>
            <UseCaseSelector
              presets={presets}
              selectedId={selectedId}
              recommendedId={recommendUseCase(analysis)}
              onSelect={(id) => {
                setSelectedId(id);
                setStage(id === "custom" ? "manual" : "confirm");
              }}
            />
            <details className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <summary className="cursor-pointer text-sm font-black text-[var(--text)]">
                従来の最適化モードから選ぶ
                <span className="ml-2 text-[10px] font-bold text-[var(--muted)]">
                  完全無劣化・画質・容量を手動指定
                </span>
              </summary>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {guidedModes.map((mode) => (
                  <ProcessingModeCard
                    key={mode.id}
                    {...mode}
                    selected={legacyMode === mode.id}
                    onSelect={() => setLegacyMode(mode.id)}
                  />
                ))}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {(["quality", "balanced", "small"] as const).map((value) => (
                  <QualityPresetCard
                    key={value}
                    value={value}
                    selected={legacyPreset === value}
                    onSelect={() => setLegacyPreset(value)}
                  />
                ))}
              </div>
              <div className="mt-5">
                <RecommendationCard
                  title="高画質基準を満たす最小候補を探索"
                  description="解析結果を確認してから、従来の詳細設定へ進めます"
                  reason="画像は画素一致、動画は品質区間を含めて検証します。"
                  applied={legacyRecommendationApplied}
                  onApply={() => {
                    setLegacyMode("high-quality-optimization");
                    setLegacyPreset("quality");
                    setLegacyRecommendationApplied(true);
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId("custom");
                  setStage("manual");
                }}
                className="mt-5 min-h-11 rounded-xl bg-[var(--primary)] px-5 text-xs font-black text-white"
              >
                この手動モードで詳細設定へ
              </button>
            </details>
          </>
        ) : selectedPreset ? (
          <UseCaseConfirmation
            preset={selectedPreset}
            originalBytes={analysis.totalBytes}
            onBack={() => setStage("select")}
            onEdit={() => setStage("manual")}
            onStart={() => setStage("processing")}
          />
        ) : null}
      </div>
    </main>
  );
}
