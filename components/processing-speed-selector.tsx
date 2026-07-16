"use client";

import { Gauge, Scale, Snail } from "lucide-react";

import type { ProcessingSpeedPreset } from "@/lib/processing/types";

const OPTIONS = [
  {
    id: "fast",
    label: "高速",
    description: "処理時間を優先します。利用可能なGPUと1パス処理を優先します。",
    icon: Gauge,
  },
  {
    id: "balanced",
    label: "バランス",
    description: "時間・容量・画質のバランスを取り、品質下限を維持します。",
    icon: Scale,
  },
  {
    id: "maximum-compression",
    label: "高圧縮",
    description: "処理時間をかけ、目標容量では高精度な2パス処理を使います。",
    icon: Snail,
  },
] as const;

export function ProcessingSpeedSelector({
  value,
  onChange,
  disabled,
}: {
  value: ProcessingSpeedPreset;
  onChange: (value: ProcessingSpeedPreset) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 text-xs font-black text-slate-700">処理速度</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.id)}
              className={`rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-cyan-500 bg-cyan-50 text-cyan-950"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="flex items-center gap-2 text-xs font-black">
                <Icon size={16} aria-hidden="true" /> {option.label}
              </span>
              <span className="mt-1 block text-[10px] font-medium leading-relaxed text-slate-500">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
