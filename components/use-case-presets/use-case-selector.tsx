"use client";

import {
  Archive,
  Check,
  Globe2,
  Mail,
  MoreHorizontal,
  Presentation,
  Printer,
  Share2,
  Smartphone,
} from "lucide-react";

import type { ResolvedUseCasePreset, UseCaseId } from "@/features/use-case-presets/types";

const icons = {
  web: Globe2,
  email: Mail,
  social: Share2,
  smartphone: Smartphone,
  print: Printer,
  archive: Archive,
  presentation: Presentation,
  custom: MoreHorizontal,
} as const;

function timeLabel(seconds: number) {
  if (seconds < 60) return `約${seconds}秒`;
  return `約${Math.ceil(seconds / 60)}分`;
}

interface UseCaseSelectorProps {
  presets: ResolvedUseCasePreset[];
  selectedId: UseCaseId | null;
  recommendedId: UseCaseId;
  onSelect: (id: UseCaseId) => void;
}

export function UseCaseSelector({
  presets,
  selectedId,
  recommendedId,
  onSelect,
}: UseCaseSelectorProps) {
  const cards = [
    ...presets,
    {
      id: "custom" as const,
      label: "カスタム設定",
      description: "形式、品質、容量を自由に指定します",
      optimization: "すべての項目を手動で調整",
      estimatedReductionPercent: 0,
      estimatedSeconds: 0,
    },
  ];

  return (
    <section aria-labelledby="use-case-title">
      <div className="max-w-2xl">
        <p className="text-xs font-black text-[var(--primary)]">
          ファイル解析が完了しました
        </p>
        <h1
          id="use-case-title"
          className="mt-2 text-3xl font-black tracking-tight text-[var(--text)] sm:text-4xl"
        >
          どこで使いますか？
        </h1>
        <p className="mt-3 text-sm font-medium leading-6 text-[var(--muted)]">
          用途に合わせて形式・品質・解像度・コーデック・容量を提案します。選ぶだけでは処理を開始しません。
        </p>
      </div>

      <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = icons[card.id];
          const selected = selectedId === card.id;
          const recommended = recommendedId === card.id;
          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(card.id)}
              className={`relative flex min-h-64 flex-col rounded-3xl border p-5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
                selected
                  ? "border-[var(--primary)] bg-[var(--surface)] shadow-lg ring-1 ring-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-md"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-2xl bg-indigo-50 text-[var(--primary)] dark:bg-indigo-950/50">
                  <Icon size={21} aria-hidden="true" />
                </span>
                {selected ? (
                  <span
                    className="grid size-6 place-items-center rounded-full bg-[var(--primary)] text-white"
                    aria-label="選択中"
                  >
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : recommended ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[9px] font-black text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                    おすすめ候補
                  </span>
                ) : null}
              </div>
              <h2 className="mt-4 text-base font-black text-[var(--text)]">
                {card.label}
              </h2>
              <p className="mt-2 min-h-10 text-xs font-medium leading-5 text-[var(--muted)]">
                {card.description}
              </p>
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <p className="text-[10px] font-black uppercase tracking-wide text-[var(--muted)]">
                  主な最適化方針
                </p>
                <p className="mt-1 text-[11px] font-bold leading-5 text-[var(--text)]">
                  {card.optimization}
                </p>
              </div>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-4 text-[10px] font-bold text-[var(--muted)]">
                <span>
                  推定削減率
                  <strong className="mt-0.5 block text-xs text-emerald-700">
                    {card.id === "custom"
                      ? "設定後に算出"
                      : `約${card.estimatedReductionPercent}%`}
                  </strong>
                </span>
                <span>
                  推定処理時間
                  <strong className="mt-0.5 block text-xs text-[var(--text)]">
                    {card.id === "custom"
                      ? "設定による"
                      : timeLabel(card.estimatedSeconds)}
                  </strong>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
