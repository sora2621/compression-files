"use client";

import { useRef, useState } from "react";

import { ImageComparison } from "@/components/image-comparison";

export function BeforeAfterImage({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  return <ImageComparison beforeUrl={beforeUrl} afterUrl={afterUrl} />;
}

export function BeforeAfterVideo({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const [active, setActive] = useState<"before" | "after">("before");
  const beforeRef = useRef<HTMLVideoElement>(null);
  const afterRef = useRef<HTMLVideoElement>(null);

  const switchTo = (next: "before" | "after") => {
    const current = active === "before" ? beforeRef.current : afterRef.current;
    const target = next === "before" ? beforeRef.current : afterRef.current;
    if (current && target) target.currentTime = current.currentTime;
    setActive(next);
  };

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[var(--border)] bg-slate-950"
      aria-label="動画の処理前後比較"
    >
      <div className="grid grid-cols-2 bg-[var(--surface)] p-1">
        {(["before", "after"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => switchTo(value)}
            aria-pressed={active === value}
            className={`min-h-11 rounded-xl text-xs font-black ${active === value ? "bg-[var(--primary)] text-white" : "text-[var(--muted)]"}`}
          >
            {value === "before" ? "処理前" : "処理後"}
          </button>
        ))}
      </div>
      <video
        ref={beforeRef}
        src={beforeUrl}
        controls
        muted
        preload="metadata"
        className={`aspect-video w-full object-contain ${active === "before" ? "block" : "hidden"}`}
      />
      <video
        ref={afterRef}
        src={afterUrl}
        controls
        muted
        preload="metadata"
        className={`aspect-video w-full object-contain ${active === "after" ? "block" : "hidden"}`}
      />
      <p className="bg-[var(--surface)] px-4 py-3 text-center text-[10px] font-bold text-[var(--muted)]">
        タブを切り替えても同じ時間位置を引き継ぎます
      </p>
    </section>
  );
}

export function CompressionComparison({
  originalSize,
  outputSize,
}: {
  originalSize: number;
  outputSize: number;
}) {
  const ratio =
    originalSize > 0 ? Math.min(100, Math.max(3, (outputSize / originalSize) * 100)) : 0;
  const format = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return (
    <div
      className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
      aria-label="ファイル容量比較"
    >
      <div>
        <div className="mb-1 flex justify-between text-xs font-bold text-[var(--muted)]">
          <span>処理前</span>
          <span>{format(originalSize)}</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--surface-subtle)]">
          <div className="h-full w-full rounded-full bg-slate-400" />
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs font-bold text-[var(--text)]">
          <span>処理後</span>
          <span>{format(outputSize)}</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--surface-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--primary)]"
            style={{ width: `${ratio}%` }}
          />
        </div>
      </div>
    </div>
  );
}
