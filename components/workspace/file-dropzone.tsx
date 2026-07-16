"use client";

import { ClipboardPaste, FilePlus2, ShieldCheck, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  onRejected?: (files: RejectedFile[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  className?: string;
}

const MAX_BYTES = 250 * 1024 * 1024;

function validateFiles(files: File[], maxFiles: number) {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  files.slice(0, maxFiles).forEach((file) => {
    if (file.size === 0) rejected.push({ name: file.name, reason: "空のファイルです" });
    else if (file.size > MAX_BYTES)
      rejected.push({ name: file.name, reason: "250MBを超えています" });
    else if (/x-msdownload|x-executable|x-dosexec/i.test(file.type)) {
      rejected.push({
        name: file.name,
        reason: "実行ファイルは安全のため追加できません",
      });
    } else accepted.push(file);
  });
  if (files.length > maxFiles) {
    files.slice(maxFiles).forEach((file) =>
      rejected.push({
        name: file.name,
        reason: `一度に追加できるのは${maxFiles}件までです`,
      }),
    );
  }
  return { accepted, rejected };
}

export function FileDropzone({
  onFiles,
  onRejected,
  disabled = false,
  maxFiles = 10,
  className,
}: FileDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const result = validateFiles(files, maxFiles);
      if (result.accepted.length) onFiles(result.accepted);
      if (result.rejected.length) onRejected?.(result.rejected);
    },
    [disabled, maxFiles, onFiles, onRejected],
  );

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (images.length) {
        event.preventDefault();
        submit(images);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [submit]);

  return (
    <section
      className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition sm:p-10 ${
        dragging
          ? "border-[var(--primary)] bg-[var(--primary-soft)] ring-4 ring-[color:var(--primary)/.12]"
          : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--primary)]"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className ?? ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        submit(Array.from(event.dataTransfer.files));
      }}
      aria-label="画像・動画・音声ファイルの追加領域"
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(event) => submit(Array.from(event.target.files ?? []))}
        aria-label="ファイルを選択"
      />
      <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-[var(--primary-soft)] text-[var(--primary)]">
        {dragging ? <FilePlus2 size={30} /> : <UploadCloud size={30} />}
      </div>
      <h2 className="mt-5 text-xl font-black tracking-tight text-[var(--text)] sm:text-2xl">
        {dragging ? "ここにドロップしてください" : "ファイルをドラッグ＆ドロップ"}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm font-medium leading-6 text-[var(--muted)]">
        画像・動画・音声をまとめて追加できます。実際のファイル内容をサーバーで安全に確認します。
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--primary)] px-6 text-sm font-black text-white shadow-sm transition hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:opacity-50"
      >
        ファイルを選択
      </button>
      <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[11px] font-bold text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <ClipboardPaste size={14} /> 画像の貼り付け対応
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} /> 元ファイルは変更しません
        </span>
      </div>
    </section>
  );
}
