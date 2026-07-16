"use client";

import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Gauge,
  Trophy,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";
import { CompressionApp } from "@/components/compression-app";
import { EmptyState } from "@/components/ui/empty-state";
import { ProcessingModeCard } from "@/components/workspace/processing-mode-card";
import {
  QualityPresetCard,
  type QualityPreset,
} from "@/components/workspace/quality-preset-card";
import { RecommendationCard } from "@/components/workspace/recommendation-card";
import { BasicSettings } from "@/components/workspace/settings-sections";
import { StickyActionBar } from "@/components/workspace/sticky-action-bar";

import type { ProcessingMode } from "@/lib/media/image-types";

type GuidedMode =
  | "strict-lossless"
  | "high-quality-optimization"
  | "size-priority"
  | "archive"
  | "target-size";

const modes = [
  {
    id: "strict-lossless",
    icon: BadgeCheck,
    title: "完全無劣化",
    description:
      "データを変更せずに削減。検証に成功した結果だけを無劣化として採用します。",
    duration: "標準",
    reduction: "小〜中",
  },
  {
    id: "high-quality-optimization",
    icon: Trophy,
    title: "高画質最適化",
    description: "見た目を維持しながら、品質基準を満たす最小候補を探索します。",
    duration: "長め",
    reduction: "中〜大",
  },
  {
    id: "size-priority",
    icon: Gauge,
    title: "容量優先",
    description: "多少の変化を許容し、共有しやすい容量まで大きく削減します。",
    duration: "標準",
    reduction: "大",
  },
  {
    id: "archive",
    icon: Archive,
    title: "アーカイブ",
    description: "将来の復元性と容量のバランスを重視して保存します。",
    duration: "長め",
    reduction: "形式による",
  },
  {
    id: "target-size",
    icon: Target,
    title: "目標容量を指定",
    description: "1MB以下、元の50%以下など、出力上限を指定して品質を探索します。",
    duration: "長め",
    reduction: "指定値まで",
  },
] as const;

function processingMode(mode: GuidedMode): ProcessingMode {
  return mode;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function OptimizePage() {
  const { files } = useWorkspace();
  const [mode, setMode] = useState<GuidedMode>("high-quality-optimization");
  const [preset, setPreset] = useState<QualityPreset>("balanced");
  const [confirmed, setConfirmed] = useState(false);
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const factor = preset === "quality" ? 0.78 : preset === "small" ? 0.42 : 0.62;
  const estimatedOutput = Math.round(totalSize * factor);

  if (files.length === 0) {
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-5xl px-4 py-12 sm:px-6">
        <EmptyState
          title="最適化するファイルがありません"
          description="トップページで画像・動画・音声を追加してから、最適化方法を選択してください。"
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

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)] pb-28">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black text-[var(--primary)]">
              2 / 3　最適化方法を選択
            </p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--text)] sm:text-4xl">
              どのように最適化しますか？
            </h1>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              {files.length}件を選択中。内容を確認するまで処理は始まりません。
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] px-4 text-xs font-black text-[var(--text)]"
          >
            <ArrowLeft size={15} /> ファイルを変更
          </Link>
        </div>

        {!confirmed ? (
          <>
            <section aria-labelledby="mode-title">
              <h2 id="mode-title" className="text-base font-black text-[var(--text)]">
                処理モード
              </h2>
              <p className="mt-1 text-xs font-medium text-[var(--muted)]">
                迷った場合は「高画質最適化」を選んでください。完全無劣化との違いは結果画面でも確認できます。
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {modes.map((item) => (
                  <ProcessingModeCard
                    key={item.id}
                    {...item}
                    selected={mode === item.id}
                    onSelect={() => setMode(item.id)}
                  />
                ))}
              </div>
            </section>

            <BasicSettings>
              <div className="grid gap-3 sm:grid-cols-3">
                {(["quality", "balanced", "small"] as const).map((value) => (
                  <QualityPresetCard
                    key={value}
                    value={value}
                    selected={preset === value}
                    onSelect={() => setPreset(value)}
                  />
                ))}
              </div>
            </BasicSettings>

            <section className="mt-8" aria-labelledby="recommendation-title">
              <h2
                id="recommendation-title"
                className="mb-3 text-base font-black text-[var(--text)]"
              >
                解析前のおすすめ
              </h2>
              <RecommendationCard
                title="高画質基準を満たす最小候補を探索"
                description="候補を自動適用せず、検証結果と採用理由を処理後に表示します"
                reason={
                  files.some((file) => file.type.startsWith("video/"))
                    ? "動画はVMAFの平均だけでなく低品質区間も確認します。"
                    : "画像は画素一致を検証できた場合だけ無劣化と表示します。"
                }
                applied={recommendationApplied}
                onApply={() => {
                  setMode("high-quality-optimization");
                  setPreset("quality");
                  setRecommendationApplied(true);
                }}
              />
            </section>
          </>
        ) : (
          <section aria-labelledby="workspace-title">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div>
                <h2 id="workspace-title" className="font-black text-[var(--text)]">
                  解析結果と実行設定
                </h2>
                <p className="mt-1 text-xs font-medium text-[var(--muted)]">
                  おすすめ内容を確認し、必要な場合だけ詳細設定を開いてください。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmed(false)}
                className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-xs font-black text-[var(--text)]"
              >
                モードを変更
              </button>
            </div>
            <CompressionApp
              key={`${mode}:${preset}`}
              initialFiles={files}
              embedded
              initialMode={processingMode(mode)}
              initialPreset={preset}
            />
          </section>
        )}
      </div>

      {!confirmed && (
        <StickyActionBar
          fileCount={files.length}
          inputSize={formatBytes(totalSize)}
          estimatedOutputSize={`約${formatBytes(estimatedOutput)}`}
          estimatedSavedSize={`約${formatBytes(Math.max(0, totalSize - estimatedOutput))}`}
          action={
            <button
              type="button"
              onClick={() => setConfirmed(true)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
            >
              この設定を確認 <ArrowRight size={16} />
            </button>
          }
        />
      )}
    </main>
  );
}
