"use client";

import { RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";

import {
  DEFAULT_IMAGE_ENHANCEMENTS,
  type ImageEnhancementOptions,
} from "@/lib/media/image-types";

export interface ImageEnhancementPanelProps {
  value: ImageEnhancementOptions;
  onChange: (update: Partial<ImageEnhancementOptions>) => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface RangeDefinition {
  key: "denoise" | "brightness" | "contrast" | "saturation" | "gamma";
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const ranges: RangeDefinition[] = [
  {
    key: "denoise",
    label: "ノイズ軽減",
    description: "ざらつきや細かな色むらを滑らかにします",
    min: 0,
    max: 10,
    step: 1,
    format: (value) => (value === 0 ? "オフ" : `${value} / 10`),
  },
  {
    key: "brightness",
    label: "明るさ",
    description: "画像全体の明るさを調整します",
    min: 0.5,
    max: 1.5,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: "contrast",
    label: "コントラスト",
    description: "明暗差を調整し、立体感を整えます",
    min: 0.5,
    max: 1.5,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: "saturation",
    label: "彩度",
    description: "色の鮮やかさを調整します",
    min: 0,
    max: 2,
    step: 0.01,
    format: (value) => `${Math.round(value * 100)}%`,
  },
  {
    key: "gamma",
    label: "ガンマ補正",
    description: "中間調を中心に明るさを補正します",
    min: 1,
    max: 3,
    step: 0.01,
    format: (value) => value.toFixed(2),
  },
];

const toggles: Array<{
  key: "sharpen" | "autoRotate" | "normalizeColorSpace";
  label: string;
  description: string;
}> = [
  {
    key: "sharpen",
    label: "シャープ化",
    description: "輪郭を整えて、くっきり見せます",
  },
  {
    key: "autoRotate",
    label: "自動回転",
    description: "EXIFの向きを画素へ反映してから削除します",
  },
  {
    key: "normalizeColorSpace",
    label: "色空間を最適化",
    description: "Web表示に適した色空間へ安全に変換します",
  },
];

export function ImageEnhancementPanel({
  value,
  onChange,
  disabled = false,
  disabledReason,
}: ImageEnhancementPanelProps) {
  return (
    <section className="rounded-[24px] border border-violet-200 bg-violet-50/35 p-4 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <SlidersHorizontal size={18} className="text-violet-600" aria-hidden="true" />
            通常の画質補正
          </div>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
            Sharpで画素を解析し、色・明るさ・輪郭を調整します。
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(DEFAULT_IMAGE_ENHANCEMENTS)}
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 text-[10px] font-black text-violet-700 transition hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={13} aria-hidden="true" /> 初期値に戻す
        </button>
      </div>

      {disabledReason && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] font-bold leading-5 text-amber-800">
          {disabledReason}
        </div>
      )}

      <fieldset disabled={disabled} className={disabled ? "opacity-55" : undefined}>
        <legend className="sr-only">画像の通常補正設定</legend>

        <div className="grid gap-2 sm:grid-cols-3">
          {toggles.map((toggle) => (
            <label
              key={toggle.key}
              className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition ${
                value[toggle.key]
                  ? "border-violet-300 bg-white ring-1 ring-violet-100"
                  : "border-violet-100 bg-white/75 hover:border-violet-200"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                checked={value[toggle.key]}
                onChange={(event) => onChange({ [toggle.key]: event.target.checked })}
                className="mt-0.5 size-4 shrink-0 accent-violet-600"
              />
              <span>
                <span className="block text-xs font-black text-slate-900">
                  {toggle.label}
                </span>
                <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                  {toggle.description}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {ranges.map((range) => {
            const currentValue = value[range.key];
            const progress = ((currentValue - range.min) / (range.max - range.min)) * 100;
            return (
              <label
                key={range.key}
                className="rounded-2xl border border-violet-100 bg-white p-4"
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-xs font-black text-slate-900">
                      {range.label}
                    </span>
                    <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                      {range.description}
                    </span>
                  </span>
                  <output className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700">
                    {range.format(currentValue)}
                  </output>
                </span>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={currentValue}
                  aria-label={range.label}
                  aria-valuetext={range.format(currentValue)}
                  onChange={(event) =>
                    onChange({ [range.key]: Number(event.target.value) })
                  }
                  className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full accent-violet-600 disabled:cursor-not-allowed"
                  style={{
                    background: `linear-gradient(to right, #7c3aed ${progress}%, #ede9fe ${progress}%)`,
                  }}
                />
                <span className="mt-1.5 flex justify-between text-[9px] font-bold text-slate-400">
                  <span>{range.format(range.min)}</span>
                  <span>{range.format(range.max)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-violet-100 bg-white/80 p-3 text-[10px] font-medium leading-5 text-slate-600">
        <Sparkles
          className="mt-0.5 shrink-0 text-violet-600"
          size={14}
          aria-hidden="true"
        />
        強いノイズ軽減やシャープ化は細部の見え方を変える場合があります。プレビュー比較を確認してからダウンロードしてください。
      </div>
    </section>
  );
}
