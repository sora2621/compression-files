"use client";

import { AlertOctagon, ChevronDown, RefreshCw, SlidersHorizontal, X } from "lucide-react";

import { sanitizeLogMessage } from "@/components/progress/utils";

export interface ErrorCardProps {
  message: string;
  title?: string;
  details?: string;
  errorCode?: string;
  onRetry?: () => void;
  onChangeSettings?: () => void;
  onDismiss?: () => void;
  retryDisabled?: boolean;
  className?: string;
}

export function ErrorCard({
  message,
  title = "処理を完了できませんでした",
  details,
  errorCode,
  onRetry,
  onChangeSettings,
  onDismiss,
  retryDisabled = false,
  className,
}: ErrorCardProps) {
  return (
    <section
      role="alert"
      className={`rounded-3xl border border-rose-200 bg-white p-5 soft-shadow sm:p-7 ${className ?? ""}`}
    >
      <div className="flex items-start gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-rose-100 text-rose-700">
          <AlertOctagon size={23} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black tracking-wider text-rose-600">ERROR</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">{title}</h2>
            </div>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="エラー表示を閉じる"
                className="grid size-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <X size={17} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="mt-3 text-sm font-bold leading-6 text-rose-800">{message}</p>
          {errorCode && (
            <p className="mt-2 text-[10px] font-bold text-slate-500">
              エラー番号: {errorCode}
            </p>
          )}
        </div>
      </div>

      {details && (
        <details className="group mt-5 rounded-xl border border-slate-200 bg-slate-50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs font-black text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-500 [&::-webkit-details-marker]:hidden">
            詳細情報
            <ChevronDown
              size={15}
              className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 p-4 text-[11px] leading-5 text-slate-600">
            {sanitizeLogMessage(details)}
          </pre>
        </details>
      )}

      {(onRetry || onChangeSettings) && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-black text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={15} aria-hidden="true" /> 再試行
            </button>
          )}
          {onChangeSettings && (
            <button
              type="button"
              onClick={onChangeSettings}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 text-sm font-black text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865e8]"
            >
              <SlidersHorizontal size={15} aria-hidden="true" /> 設定を変更して再処理
            </button>
          )}
        </div>
      )}
    </section>
  );
}
