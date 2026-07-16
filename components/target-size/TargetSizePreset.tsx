"use client";

import { useId } from "react";

import { TARGET_SIZE_PRESETS } from "@/lib/target-size/config";

import type {
  TargetSizePresetDefinition,
  TargetSizePresetId,
} from "@/lib/target-size/types";

export interface TargetSizePresetProps {
  selectedId: TargetSizePresetId;
  originalBytes: number;
  disabled?: boolean;
  onSelect: (preset: TargetSizePresetDefinition) => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function TargetSizePreset({
  selectedId,
  originalBytes,
  disabled = false,
  onSelect,
}: TargetSizePresetProps) {
  const presets = Object.values(TARGET_SIZE_PRESETS);
  const presetName = useId();

  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-black text-slate-700">用途から選ぶ</legend>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {presets.map((preset) => {
          const selected = selectedId === preset.id;
          const resolvedBytes =
            preset.targetBytes ?? Math.floor(originalBytes * (preset.targetRatio ?? 1));
          return (
            <label
              key={preset.id}
              className={`cursor-pointer rounded-xl border p-3 transition focus-within:ring-2 focus-within:ring-[#5865e8] focus-within:ring-offset-2 ${
                selected
                  ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200"
                  : "border-slate-200 bg-white hover:border-slate-300"
              } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <input
                type="radio"
                name={presetName}
                value={preset.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(preset)}
                className="sr-only"
              />
              <span className="block text-xs font-black text-slate-900">
                {preset.label}
              </span>
              <span className="mt-1 block text-[9px] font-medium leading-4 text-slate-500">
                {preset.description}
              </span>
              <span className="mt-2 block text-[10px] font-black text-[#5865e8]">
                {preset.targetRatio !== null
                  ? `元容量の${Math.round(preset.targetRatio * 100)}%以下`
                  : `${formatBytes(resolvedBytes)}以下`}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
