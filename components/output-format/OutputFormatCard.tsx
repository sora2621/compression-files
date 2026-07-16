"use client";

import { Check } from "lucide-react";

import type { OutputFormatDefinition } from "@/shared/media/output-formats";

interface OutputFormatCardProps {
  definition: OutputFormatDefinition;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function OutputFormatCard({
  definition,
  selected,
  disabled = false,
  onSelect,
}: OutputFormatCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${
        selected
          ? "border-indigo-500 bg-white shadow-sm ring-1 ring-indigo-500"
          : "border-slate-200 bg-white/70 hover:border-slate-300"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-black text-slate-900">{definition.label}</span>
        {selected && (
          <span className="grid size-5 place-items-center rounded-full bg-indigo-600 text-white">
            <Check size={13} />
          </span>
        )}
      </span>
      <span className="mt-1 block text-[10px] font-black text-indigo-700">
        .{definition.extension}
      </span>
      <span className="mt-2 block text-[10px] font-medium leading-4 text-slate-500">
        {definition.description}
      </span>
      <span className="mt-3 flex flex-wrap gap-1">
        {definition.recommendations.slice(0, 3).map((recommendation) => (
          <span
            key={recommendation}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-black text-slate-600"
          >
            {recommendation}
          </span>
        ))}
      </span>
      <span className="mt-3 grid grid-cols-3 gap-1 text-[8px] font-bold text-slate-500">
        <span>互換性 {definition.compatibility}</span>
        <span>容量 {definition.estimatedSize}</span>
        <span>処理 {definition.estimatedTime}</span>
      </span>
      {definition.mediaCategory === "image" && (
        <span className="mt-2 block text-[8px] font-bold text-slate-500">
          透過 {definition.supportsTransparency ? "対応" : "非対応"} · 可逆圧縮{" "}
          {definition.supportsLossless ? "対応" : "非対応"}
        </span>
      )}
    </button>
  );
}
