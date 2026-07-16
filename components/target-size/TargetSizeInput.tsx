"use client";

import { HardDriveDownload } from "lucide-react";
import { useId } from "react";

import { TARGET_SIZE_UNITS, type TargetSizeUnit } from "@/lib/target-size/types";

export interface TargetSizeInputProps {
  valueBytes: number | null;
  unit: TargetSizeUnit;
  disabled?: boolean;
  onValueChange: (bytes: number | null) => void;
  onUnitChange: (unit: TargetSizeUnit) => void;
}

const unitBytes: Record<TargetSizeUnit, number> = {
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
};

function displayValue(bytes: number | null, unit: TargetSizeUnit) {
  if (bytes === null) return "";
  return Number((bytes / unitBytes[unit]).toFixed(3));
}

export function TargetSizeInput({
  valueBytes,
  unit,
  disabled = false,
  onValueChange,
  onUnitChange,
}: TargetSizeInputProps) {
  const inputId = useId();
  const helpId = `${inputId}-help`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <label
        htmlFor={inputId}
        className="flex items-center gap-2 text-xs font-black text-slate-800"
      >
        <HardDriveDownload size={15} className="text-[#5865e8]" aria-hidden="true" />
        目標ファイルサイズ
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_88px_auto] items-center gap-2">
        <input
          id={inputId}
          type="number"
          min={0.001}
          step={0.001}
          inputMode="decimal"
          value={displayValue(valueBytes, unit)}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => {
            if (event.target.value === "") {
              onValueChange(null);
              return;
            }
            const value = Number(event.target.value);
            const bytes = Math.round(value * unitBytes[unit]);
            onValueChange(Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null);
          }}
          className="min-h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black tabular-nums text-slate-900 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <select
          value={unit}
          disabled={disabled}
          aria-label="目標容量の単位"
          onChange={(event) => onUnitChange(event.target.value as TargetSizeUnit)}
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-2 text-xs font-black text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100"
        >
          {TARGET_SIZE_UNITS.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
        <span className="whitespace-nowrap text-xs font-black text-slate-700">
          以下にする
        </span>
      </div>
      <p id={helpId} className="mt-2 text-[10px] font-medium leading-4 text-slate-500">
        出力時のコンテナ差を見込み、指定値を超えない候補を探索します。
      </p>
    </div>
  );
}
