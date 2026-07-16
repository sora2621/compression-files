import type { ReactNode } from "react";

export function StickyActionBar({
  fileCount,
  inputSize,
  estimatedOutputSize,
  estimatedSavedSize,
  action,
  reason,
}: {
  fileCount: number;
  inputSize: string;
  estimatedOutputSize: string;
  estimatedSavedSize: string;
  action: ReactNode;
  reason?: string | null;
}) {
  return (
    <aside
      className="sticky bottom-0 z-30 border-t border-[var(--border)] bg-[color:var(--surface)/.96] px-4 py-3 shadow-[0_-10px_30px_rgba(15,23,42,.08)] backdrop-blur"
      aria-label="最適化の実行"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-[10px] sm:grid-cols-4">
          <div>
            <dt className="text-[var(--muted)]">ファイル</dt>
            <dd className="font-black text-[var(--text)]">{fileCount}件</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">入力</dt>
            <dd className="font-black text-[var(--text)]">{inputSize}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">推定出力</dt>
            <dd className="font-black text-[var(--text)]">{estimatedOutputSize}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">推定削減</dt>
            <dd className="font-black text-emerald-700 dark:text-emerald-400">
              {estimatedSavedSize}
            </dd>
          </div>
        </dl>
        <div className="sm:min-w-64">
          {action}
          {reason && (
            <p className="mt-1 text-center text-[10px] font-bold text-amber-700 dark:text-amber-300">
              {reason}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
