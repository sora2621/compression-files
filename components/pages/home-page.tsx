"use client";

import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useWorkspace } from "@/components/app/workspace-provider";
import { ImageLibraryPicker } from "@/components/files/image-library-picker";
import { FileDropzone, type RejectedFile } from "@/components/workspace/file-dropzone";
import { FileList } from "@/components/workspace/file-list";

export function HomePage() {
  const router = useRouter();
  const { files, addFiles, removeFile, setFiles } = useWorkspace();
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[var(--page)]">
      <section className="mx-auto max-w-5xl px-4 pb-28 pt-10 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-bold text-[var(--primary-strong)]">
            <Sparkles size={14} /> 1 / 3　ファイルを追加
          </div>
          <h1 className="text-3xl font-black tracking-[-0.045em] text-[var(--text)] sm:text-5xl">
            画像・動画・音声を
            <span className="text-[var(--primary)]">簡単に最適化</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm font-medium leading-7 text-[var(--muted)] sm:text-base">
            ファイルを追加すると、実際の形式と内容を確認しておすすめ設定を提案します。自動では実行しません。
          </p>
        </div>

        <FileDropzone
          className="mt-9"
          onFiles={(incoming) => {
            addFiles(incoming);
            setRejected([]);
          }}
          onRejected={setRejected}
        />
        <ImageLibraryPicker
          className="mt-3"
          onImages={(incoming) => {
            addFiles(incoming);
            setRejected([]);
          }}
        />

        {rejected.length > 0 && (
          <section
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
            role="alert"
            aria-live="polite"
          >
            <h2 className="text-sm font-black text-amber-900 dark:text-amber-100">
              追加できなかったファイル
            </h2>
            <ul className="mt-2 space-y-1 text-xs font-bold text-amber-800 dark:text-amber-200">
              {rejected.map((item) => (
                <li key={`${item.name}:${item.reason}`}>
                  {item.name}: {item.reason}
                </li>
              ))}
            </ul>
          </section>
        )}

        {files.length > 0 && (
          <div className="mt-8">
            <FileList
              files={files}
              onRemove={removeFile}
              onRemoveMany={(targets) =>
                setFiles(files.filter((file) => !targets.includes(file)))
              }
            />
          </div>
        )}

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs font-black text-[var(--text)]">主な対応形式</p>
            <p className="mt-2 text-[11px] font-medium leading-5 text-[var(--muted)]">
              JPEG・PNG・WebP・AVIF・MP4・MOV・MKV・MP3・WAVほか
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs font-black text-[var(--text)]">最大ファイルサイズ</p>
            <p className="mt-2 text-[11px] font-medium leading-5 text-[var(--muted)]">
              画像25MB・音声100MB・動画250MB。最大10件まで。
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="flex items-center gap-2 text-xs font-black text-[var(--text)]">
              <ShieldCheck size={15} /> プライバシー
            </p>
            <p className="mt-2 text-[11px] font-medium leading-5 text-[var(--muted)]">
              元ファイルは処理後に削除。完成ファイルも設定した時間で自動削除します。
            </p>
          </div>
        </div>
      </section>

      {files.length > 0 && (
        <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[color:var(--surface)/.96] p-3 shadow-[0_-10px_30px_rgba(15,23,42,.08)] backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
            <div className="hidden sm:block">
              <p className="text-xs font-black text-[var(--text)]">
                {files.length}件を追加済み
              </p>
              <p className="mt-1 text-[10px] font-bold text-[var(--muted)]">
                合計 {(totalBytes / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/optimize")}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-6 text-sm font-black text-white shadow-sm hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 sm:ml-auto sm:w-auto"
            >
              解析して次へ <ArrowRight size={17} />
            </button>
          </div>
        </aside>
      )}

      <p className="sr-only" aria-live="polite">
        {files.length > 0
          ? `${files.length}件のファイルを追加しました`
          : "ファイルはまだ追加されていません"}
      </p>
      <span className="sr-only">
        <LockKeyhole /> ファイルは一時保存されます
      </span>
    </main>
  );
}
