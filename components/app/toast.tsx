"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";

export function Toast() {
  const { toast, dismissToast } = useWorkspace();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, 4_000);
    return () => window.clearTimeout(timer);
  }, [dismissToast, toast]);

  if (!toast) return null;
  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "warning" || toast.tone === "error"
        ? AlertTriangle
        : Info;

  return (
    <div
      className="fixed inset-x-4 bottom-24 z-[70] mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:bottom-6"
      role="status"
      aria-live="polite"
    >
      <Icon
        size={18}
        className="mt-0.5 shrink-0 text-[var(--primary)]"
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-sm font-bold leading-6 text-[var(--text)]">
        {toast.message}
      </p>
      <button
        type="button"
        onClick={dismissToast}
        aria-label="通知を閉じる"
        className="grid size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-subtle)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}
