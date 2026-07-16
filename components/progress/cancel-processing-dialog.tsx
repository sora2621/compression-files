"use client";

import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export interface CancelProcessingDialogProps {
  open: boolean;
  fileName?: string;
  isCancelling?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function CancelProcessingDialog({
  open,
  fileName,
  isCancelling = false,
  onConfirm,
  onClose,
}: CancelProcessingDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousElement = document.activeElement as HTMLElement | null;
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCancelling) onClose();
      if (event.key !== "Tab") return;
      const dialog = cancelButtonRef.current?.closest('[role="dialog"]');
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousElement?.focus();
    };
  }, [isCancelling, onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isCancelling) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-100 text-amber-700">
            <AlertTriangle size={23} aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isCancelling}
            aria-label="ダイアログを閉じる"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8] disabled:opacity-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <h2 id={titleId} className="mt-5 text-xl font-black text-slate-900">
          処理をキャンセルしますか？
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-sm font-medium leading-6 text-slate-600"
        >
          実行中の処理を安全に停止し、作成途中の一時ファイルを削除します。
          {fileName && (
            <span className="mt-2 block break-all font-black text-slate-800">
              対象: {fileName}
            </span>
          )}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            disabled={isCancelling}
            className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8] disabled:opacity-50"
          >
            処理を続ける
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isCancelling}
            aria-live="polite"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-black text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          >
            {isCancelling && (
              <LoaderCircle
                size={15}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {isCancelling ? "停止しています" : "キャンセルする"}
          </button>
        </div>
      </div>
    </div>
  );
}
