"use client";

import { Download, FileAudio, FileImage, FileVideo, History, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";

function formatBytes(bytes: number) {
  return bytes < 1024 ** 2
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export function HistoryPage() {
  const { history, hydrated, removeHistory, clearHistory } = useWorkspace();
  const [clearOpen, setClearOpen] = useState(false);
  const [kind, setKind] = useState<"all" | "image" | "video" | "audio">("all");
  const visible = history.filter((entry) => kind === "all" || entry.kind === kind);

  if (!hydrated)
    return (
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl px-4 py-10 sm:px-6">
        <LoadingSkeleton rows={4} />
      </main>
    );

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black text-[var(--primary)]">History</p>
            <h1 className="mt-2 text-3xl font-black text-[var(--text)]">処理履歴</h1>
            <p className="mt-2 text-sm font-medium text-[var(--muted)]">
              この端末で処理したファイルだけを表示します。期限切れの履歴は自動で消えます。
            </p>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setClearOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-xs font-black text-red-700"
            >
              <Trash2 size={15} /> 履歴をすべて削除
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <EmptyState
            icon={History}
            title="処理履歴はまだありません"
            description="最適化が完了すると、ダウンロード期限内の結果がここに表示されます。"
            action={
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white"
              >
                ファイルを追加
              </Link>
            }
          />
        ) : (
          <>
            <div
              className="mb-4 flex gap-2 overflow-x-auto pb-1"
              aria-label="種類で絞り込む"
            >
              {(["all", "image", "video", "audio"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                  className={`min-h-10 shrink-0 rounded-xl px-4 text-xs font-black ${kind === value ? "bg-[var(--primary)] text-white" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"}`}
                >
                  {value === "all"
                    ? "すべて"
                    : value === "image"
                      ? "画像"
                      : value === "video"
                        ? "動画"
                        : "音声"}
                </button>
              ))}
            </div>
            <div className="grid gap-3">
              {visible.map((entry) => {
                const Icon =
                  entry.kind === "image"
                    ? FileImage
                    : entry.kind === "video"
                      ? FileVideo
                      : FileAudio;
                const reduced = entry.originalSize >= entry.outputSize;
                return (
                  <article
                    key={entry.jobId}
                    className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center"
                  >
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
                      <Icon size={21} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2
                        className="truncate text-sm font-black text-[var(--text)]"
                        title={entry.outputName}
                      >
                        {entry.outputName}
                      </h2>
                      <p className="mt-1 text-[11px] font-bold text-[var(--muted)]">
                        {entry.outputFormat.toUpperCase()} ·{" "}
                        {formatBytes(entry.originalSize)} →{" "}
                        {formatBytes(entry.outputSize)}
                      </p>
                      <p className="mt-1 truncate text-[10px] font-bold text-[var(--muted)]">
                        保存名: {entry.outputName}
                      </p>
                      <p
                        className={`mt-1 text-[10px] font-black ${reduced ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}
                      >
                        {reduced
                          ? `${entry.reductionPercent}%削減`
                          : "容量が増加しました"}{" "}
                        ·{" "}
                        {new Intl.DateTimeFormat("ja-JP", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(entry.createdAt))}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/result/${entry.jobId}`}
                        className="inline-flex min-h-10 items-center rounded-xl border border-[var(--border)] px-3 text-xs font-black text-[var(--text)]"
                      >
                        結果を見る
                      </Link>
                      <a
                        href={entry.downloadUrl}
                        download={entry.outputName}
                        className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[var(--primary)] px-3 text-xs font-black text-white"
                      >
                        <Download size={14} /> ダウンロード
                      </a>
                      <button
                        type="button"
                        onClick={() => removeHistory(entry.jobId)}
                        aria-label={`${entry.outputName}の履歴を削除`}
                        className="grid size-10 place-items-center rounded-xl text-[var(--muted)] hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={clearOpen}
        title="履歴をすべて削除しますか？"
        description="この端末に保存された履歴表示を削除します。サーバー上の一時ファイルはそれぞれの期限で自動削除されます。"
        confirmLabel="履歴を削除"
        danger
        onConfirm={clearHistory}
        onClose={() => setClearOpen(false)}
      />
    </main>
  );
}
