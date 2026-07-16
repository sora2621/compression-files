"use client";

import { FileAudio, FileImage, FileVideo, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface FileCardProps {
  file: File;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onRemove?: () => void;
  compact?: boolean;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export function FileCard({
  file,
  selected,
  onSelectedChange,
  onRemove,
  compact,
}: FileCardProps) {
  const kind = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("audio/")
      ? "audio"
      : "video";
  const Icon = kind === "image" ? FileImage : kind === "audio" ? FileAudio : FileVideo;
  const [preview, setPreview] = useState<string | null>(null);
  const format = useMemo(
    () =>
      file.type.split("/").pop()?.toUpperCase() ||
      file.name.split(".").pop()?.toUpperCase() ||
      "FILE",
    [file],
  );

  useEffect(() => {
    if (kind !== "image") return;
    const url = URL.createObjectURL(file);
    const timer = window.setTimeout(() => setPreview(url), 0);
    return () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
  }, [file, kind]);

  return (
    <article
      className={`group relative flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${compact ? "p-3" : "p-4"}`}
    >
      {onSelectedChange && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="size-5 rounded border-[var(--border-strong)] accent-[var(--primary)]"
          aria-label={`${file.name}を選択`}
        />
      )}
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--surface-subtle)] text-[var(--primary)]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <Icon size={22} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-[var(--text)]" title={file.name}>
          {file.name}
        </p>
        <p className="mt-1 text-[11px] font-bold text-[var(--muted)]">
          {format} · {formatBytes(file.size)}
        </p>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${file.name}を削除`}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-[var(--muted)] hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/40"
        >
          <Trash2 size={17} />
        </button>
      )}
    </article>
  );
}
