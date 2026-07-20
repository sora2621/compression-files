"use client";

import { ArrowLeft, Settings2, Sparkles } from "lucide-react";

import type { ResolvedUseCasePreset } from "@/features/use-case-presets/types";

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

interface UseCaseConfirmationProps {
  preset: ResolvedUseCasePreset;
  originalBytes: number;
  onBack: () => void;
  onEdit: () => void;
  onStart: () => void;
}

export function UseCaseConfirmation({
  preset,
  originalBytes,
  onBack,
  onEdit,
  onStart,
}: UseCaseConfirmationProps) {
  return (
    <section className="mx-auto max-w-3xl" aria-labelledby="preset-confirm-title">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-10 items-center gap-2 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={15} /> 用途を選び直す
      </button>

      <div className="mt-3 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="border-b border-[var(--border)] bg-indigo-50/70 p-6 dark:bg-indigo-950/30 sm:p-8">
          <p className="flex items-center gap-2 text-xs font-black text-[var(--primary)]">
            <Sparkles size={16} /> 自動解析による提案
          </p>
          <h1
            id="preset-confirm-title"
            className="mt-3 text-2xl font-black tracking-tight text-[var(--text)] sm:text-3xl"
          >
            {preset.label}向けのおすすめ設定
          </h1>
          <p className="mt-2 text-sm font-medium text-[var(--muted)]">
            {preset.description}
          </p>
        </div>

        <div className="p-6 sm:p-8">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {preset.summaryRows.map((row) => (
              <div key={row.label} className="border-b border-[var(--border)] pb-3">
                <dt className="text-[10px] font-black uppercase tracking-wide text-[var(--muted)]">
                  {row.label}
                </dt>
                <dd className="mt-1 text-sm font-black text-[var(--text)]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 rounded-2xl bg-emerald-50 p-5 dark:bg-emerald-950/30">
            <p className="text-xs font-black text-emerald-800 dark:text-emerald-200">
              予想容量
            </p>
            <p className="mt-2 text-xl font-black text-emerald-900 dark:text-emerald-100">
              {formatBytes(originalBytes)} → 約{formatBytes(preset.estimatedOutputBytes)}
            </p>
            <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              予想削減率：約{preset.estimatedReductionPercent}%
            </p>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-black text-[var(--text)]">
              この設定をおすすめする理由
            </h2>
            <ul className="mt-3 space-y-2 text-xs font-medium leading-5 text-[var(--muted)]">
              {preset.reasons.map((reason) => (
                <li key={reason}>・{reason}</li>
              ))}
            </ul>
          </div>

          <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            まだ処理は始まっていません。下のボタンを押すと、表示中の設定で開始します。
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onStart}
              className="flex min-h-13 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white hover:bg-[var(--primary-strong)]"
            >
              <Sparkles size={17} /> この設定で開始
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="flex min-h-13 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 text-sm font-black text-[var(--text)] hover:border-[var(--primary)]"
            >
              <Settings2 size={17} /> 設定を変更
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
