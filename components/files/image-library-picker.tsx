"use client";

import { Images } from "lucide-react";
import { useRef } from "react";

interface ImageLibraryPickerProps {
  onImages: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

export function ImageLibraryPicker({
  onImages,
  disabled = false,
  className,
}: ImageLibraryPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`md:hidden ${className ?? ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        className="sr-only"
        aria-label="ライブラリから画像を選ぶ"
        onChange={(event) => {
          onImages(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-5 text-sm font-black text-[var(--text)] transition hover:bg-[var(--surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Images size={18} aria-hidden="true" />
        ライブラリから画像を選ぶ
      </button>
    </div>
  );
}
