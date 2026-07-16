"use client";

import { Maximize2, Scan } from "lucide-react";
import { useState } from "react";

interface ImageComparisonProps {
  beforeUrl: string;
  afterUrl: string;
  beforeAlt?: string;
  afterAlt?: string;
}

export function ImageComparison({
  beforeUrl,
  afterUrl,
  beforeAlt = "処理前",
  afterAlt = "処理後",
}: ImageComparisonProps) {
  const [position, setPosition] = useState(50);
  const [view, setView] = useState<"fit" | "actual" | "zoom">("fit");
  const imageClass =
    view === "actual"
      ? "max-w-none object-none"
      : view === "zoom"
        ? "h-full w-full scale-150 object-contain"
        : "h-full w-full object-contain";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {[
            ["fit", "全体表示"],
            ["actual", "ピクセル等倍"],
            ["zoom", "拡大"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id as typeof view)}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black ${
                view === id ? "bg-indigo-100 text-indigo-700" : "text-slate-500"
              }`}
            >
              {id === "actual" ? <Scan className="mr-1 inline" size={12} /> : null}
              {id === "zoom" ? <Maximize2 className="mr-1 inline" size={12} /> : null}
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-bold text-slate-400">
          スライダーを動かして比較
        </span>
      </div>

      <div className="relative h-72 overflow-auto rounded-2xl border border-slate-200 bg-[linear-gradient(45deg,#f1f3f5_25%,transparent_25%),linear-gradient(-45deg,#f1f3f5_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f1f3f5_75%),linear-gradient(-45deg,transparent_75%,#f1f3f5_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt={beforeAlt}
          className={`absolute inset-0 m-auto transition-transform ${imageClass}`}
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={afterUrl}
            alt={afterAlt}
            className={`absolute inset-0 m-auto transition-transform ${imageClass}`}
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(15,23,42,.25)]"
          style={{ left: `${position}%` }}
        >
          <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-black text-indigo-600 shadow-lg">
            ↔
          </span>
        </div>
        <span className="absolute left-3 top-3 rounded-md bg-slate-950/75 px-2 py-1 text-[9px] font-black text-white">
          AFTER
        </span>
        <span className="absolute right-3 top-3 rounded-md bg-slate-950/75 px-2 py-1 text-[9px] font-black text-white">
          BEFORE
        </span>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">処理前後の比較位置</span>
        <input
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="w-full accent-indigo-600"
        />
      </label>
    </div>
  );
}
