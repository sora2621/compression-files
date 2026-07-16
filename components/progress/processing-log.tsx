import { AlertTriangle, CheckCircle2, CircleAlert, Info, ScrollText } from "lucide-react";

import { sanitizeLogMessage } from "@/components/progress/utils";

import type { ProcessingLogEntry } from "@/components/progress/types";

export interface ProcessingLogProps {
  entries: ProcessingLogEntry[];
  title?: string;
  open?: boolean;
  emptyMessage?: string;
  className?: string;
}

const levelStyles = {
  info: { icon: Info, color: "text-slate-600", label: "情報" },
  success: { icon: CheckCircle2, color: "text-emerald-700", label: "成功" },
  warning: { icon: AlertTriangle, color: "text-amber-700", label: "注意" },
  error: { icon: CircleAlert, color: "text-rose-700", label: "エラー" },
} as const;

function formatTimestamp(value?: string | number | Date) {
  if (value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function ProcessingLog({
  entries,
  title = "処理ログ",
  open = false,
  emptyMessage = "処理ログはまだありません。",
  className,
}: ProcessingLogProps) {
  return (
    <details
      open={open || undefined}
      className={`group rounded-2xl border border-slate-200 bg-white ${className ?? ""}`}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-black text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5865e8] [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ScrollText size={16} className="text-[#5865e8]" aria-hidden="true" />
          {title}
        </span>
        <span className="text-[10px] font-bold text-slate-500">
          {entries.length}件 · <span className="group-open:hidden">表示</span>
          <span className="hidden group-open:inline">閉じる</span>
        </span>
      </summary>
      <div className="border-t border-slate-200 p-3">
        {entries.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs font-medium text-slate-500">
            {emptyMessage}
          </p>
        ) : (
          <ol
            className="max-h-64 space-y-1 overflow-y-auto overscroll-contain rounded-xl bg-slate-950 p-3"
            aria-label={title}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {entries.map((entry) => {
              const style = levelStyles[entry.level ?? "info"];
              const Icon = style.icon;
              const timestamp = formatTimestamp(entry.timestamp);
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-[11px] leading-5"
                >
                  <Icon
                    size={13}
                    className={`mt-1 shrink-0 ${style.color}`}
                    aria-hidden="true"
                  />
                  <span className="sr-only">{style.label}: </span>
                  {timestamp && (
                    <time className="shrink-0 font-mono tabular-nums text-slate-500">
                      {timestamp}
                    </time>
                  )}
                  <span className="min-w-0 break-words font-mono text-slate-200">
                    {sanitizeLogMessage(entry.message)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </details>
  );
}
