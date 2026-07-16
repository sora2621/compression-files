"use client";

import {
  Archive,
  ArrowRightLeft,
  BadgeCheck,
  Gem,
  Minimize2,
  ShieldCheck,
  Sparkles,
  Trophy,
  Target,
  WandSparkles,
} from "lucide-react";

import type { ProcessingMode } from "@/lib/media/image-types";
import type { ComponentType } from "react";

export interface ProcessingModeSelectorProps {
  value: ProcessingMode;
  onChange: (mode: ProcessingMode) => void;
  disabled?: boolean;
  unavailableModes?: Partial<Record<ProcessingMode, string>>;
}

interface ModeDefinition {
  id: ProcessingMode;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  accent: string;
}

const modes: ModeDefinition[] = [
  {
    id: "target-size",
    label: "目標容量を指定",
    description: "容量上限を指定し、品質下限を守りながら最適な設定を探索",
    icon: Target,
    accent: "text-sky-700 bg-sky-50",
  },
  {
    id: "strict-lossless",
    label: "完全無劣化",
    description: "データを変更せずに削減。検証に成功した候補だけを無劣化として採用",
    icon: BadgeCheck,
    accent: "text-emerald-700 bg-emerald-50",
  },
  {
    id: "high-quality-optimization",
    label: "高画質最適化",
    description: "見た目を維持しながら、品質基準を満たす最小候補を探索",
    icon: Trophy,
    accent: "text-violet-700 bg-violet-50",
  },
  {
    id: "size-priority",
    label: "容量優先",
    description: "多少の変化を許容し、共有しやすい容量まで大幅に削減",
    icon: Minimize2,
    accent: "text-indigo-700 bg-indigo-50",
  },
  {
    id: "archive",
    label: "アーカイブ",
    description: "将来の復元性と容量のバランスを重視して保存",
    icon: Archive,
    accent: "text-amber-700 bg-amber-50",
  },
  {
    id: "reduce-size",
    label: "容量を小さくする",
    description: "見た目を保ちながら、保存容量を優先して最適化",
    icon: Minimize2,
    accent: "text-indigo-600 bg-indigo-50",
  },
  {
    id: "improve-quality",
    label: "画質をよくする",
    description: "補正やAI高画質化を使い、見やすさと精細感を改善",
    icon: Sparkles,
    accent: "text-violet-600 bg-violet-50",
  },
  {
    id: "improve-and-reduce",
    label: "画質改善＋容量削減",
    description: "画質を整えたあと、効率のよい形式と設定で圧縮",
    icon: WandSparkles,
    accent: "text-fuchsia-600 bg-fuchsia-50",
  },
  {
    id: "convert-only",
    label: "形式だけ変換する",
    description: "補正を加えず、選択した出力形式へ変換",
    icon: ArrowRightLeft,
    accent: "text-sky-600 bg-sky-50",
  },
  {
    id: "metadata-only",
    label: "メタデータだけ削除",
    description: "EXIF・GPS・XMPなどの付加情報を取り除く",
    icon: ShieldCheck,
    accent: "text-emerald-600 bg-emerald-50",
  },
  {
    id: "lossless",
    label: "無劣化で処理する",
    description: "画素やストリームを変えず、可能な処理だけを実行",
    icon: Gem,
    accent: "text-amber-600 bg-amber-50",
  },
];

export function ProcessingModeSelector({
  value,
  onChange,
  disabled = false,
  unavailableModes = {},
}: ProcessingModeSelectorProps) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="mb-5">
        <p className="text-sm font-black text-slate-900">処理モード</p>
        <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
          目的に合わせて処理方法を選択してください。おすすめ設定は確認後に変更できます。
        </p>
      </div>

      <fieldset disabled={disabled}>
        <legend className="sr-only">処理モードを選択</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const unavailableReason = unavailableModes[mode.id];
            const isUnavailable = Boolean(unavailableReason);
            const selected = value === mode.id;

            return (
              <label
                key={mode.id}
                className={`relative flex min-h-28 gap-3 rounded-2xl border p-3.5 transition sm:p-4 ${
                  selected
                    ? "border-indigo-400 bg-indigo-50/45 ring-2 ring-indigo-100"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70"
                } ${disabled || isUnavailable ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
              >
                <input
                  type="radio"
                  name="processing-mode"
                  value={mode.id}
                  checked={selected}
                  disabled={disabled || isUnavailable}
                  onChange={() => onChange(mode.id)}
                  className="sr-only"
                />
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${mode.accent}`}
                  aria-hidden="true"
                >
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-black leading-5 text-slate-900">
                    {mode.label}
                  </span>
                  <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                    {mode.description}
                  </span>
                  {unavailableReason && (
                    <span className="mt-2 block text-[10px] font-bold leading-4 text-rose-600">
                      {unavailableReason}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className={`absolute right-3 top-3 size-2 rounded-full ${
                    selected ? "bg-indigo-500" : "bg-slate-200"
                  }`}
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      {(value === "lossless" || value === "strict-lossless") && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800">
          <Gem className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
          無劣化モードでは、リサイズ・画質補正・非可逆圧縮など再エンコードが必要な設定は選択できません。
        </div>
      )}
      {value === "target-size" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-[10px] font-bold leading-5 text-sky-800">
          <Target className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
          目標容量モードでは再エンコードが発生する場合があります。品質下限を守れない場合は自動的に処理を止め、設定変更を提案します。
        </div>
      )}
    </section>
  );
}
