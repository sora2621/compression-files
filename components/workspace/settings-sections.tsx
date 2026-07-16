import type { ReactNode } from "react";

export function BasicSettings({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="basic-settings-title">
      <h2 id="basic-settings-title" className="text-base font-black text-[var(--text)]">
        シンプル設定
      </h2>
      <p className="mt-1 text-xs font-medium text-[var(--muted)]">
        迷った場合は「バランス」がおすすめです。
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AdvancedSettings({
  children,
  open = false,
}: {
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open || undefined}
      className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 text-sm font-black text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] [&::-webkit-details-marker]:hidden">
        <span>詳細設定</span>
        <span className="text-xs text-[var(--primary)] group-open:hidden">開く</span>
        <span className="hidden text-xs text-[var(--primary)] group-open:inline">
          閉じる
        </span>
      </summary>
      <div className="border-t border-[var(--border)] p-4">{children}</div>
    </details>
  );
}
