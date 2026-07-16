"use client";

import { getOutputFormatsForCategory } from "@/shared/media/output-formats";

import { OutputFormatCard } from "./OutputFormatCard";

import type { MediaCategory, OutputFormatValue } from "@/shared/media/output-formats";

interface OutputFormatSelectorProps {
  mediaCategory: MediaCategory;
  value: string;
  availableFormats?: readonly string[];
  disabled?: boolean;
  compact?: boolean;
  label?: string;
  onChange: (value: OutputFormatValue) => void;
}

export function OutputFormatSelector({
  mediaCategory,
  value,
  availableFormats,
  disabled = false,
  compact = false,
  label = "出力形式",
  onChange,
}: OutputFormatSelectorProps) {
  const definitions = getOutputFormatsForCategory(mediaCategory).filter(
    (definition) =>
      availableFormats === undefined || availableFormats.includes(definition.value),
  );

  if (compact) {
    return (
      <label className="block text-[10px] font-black text-slate-600">
        {label}
        <select
          value={value}
          disabled={disabled || definitions.length === 0}
          onChange={(event) => onChange(event.target.value as OutputFormatValue)}
          className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black text-slate-800"
        >
          {definitions.map((definition) => (
            <option key={definition.value} value={definition.value}>
              {definition.label} (.{definition.extension})
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="mb-3 text-sm font-black text-slate-900">{label}</legend>
      <div role="radiogroup" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {definitions.map((definition) => (
          <OutputFormatCard
            key={definition.value}
            definition={definition}
            selected={value === definition.value}
            disabled={disabled}
            onSelect={() => onChange(definition.value)}
          />
        ))}
      </div>
      {definitions.length === 0 && (
        <p role="alert" className="text-xs font-bold text-rose-700">
          現在の実行環境で利用できる出力形式がありません。
        </p>
      )}
    </fieldset>
  );
}
