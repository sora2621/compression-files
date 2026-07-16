"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "実行する",
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle size={20} />
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="確認画面を閉じる"
            className="grid size-11 place-items-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
          >
            <X size={18} />
          </button>
        </div>
        <h2 id={titleId} className="mt-5 text-xl font-black text-[var(--text)]">
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm font-medium leading-6 text-[var(--muted)]"
        >
          {description}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-[var(--border)] px-5 text-sm font-black text-[var(--text)]"
          >
            戻る
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`min-h-11 rounded-xl px-5 text-sm font-black text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-[var(--primary)] hover:bg-[var(--primary-strong)]"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
