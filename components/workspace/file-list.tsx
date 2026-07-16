"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { FileCard } from "@/components/workspace/file-card";

export interface FileListProps {
  files: File[];
  onRemove: (file: File) => void;
  onRemoveMany?: (files: File[]) => void;
}

type KindFilter = "all" | "image" | "video" | "audio";

export function FileList({ files, onRemove, onRemoveMany }: FileListProps) {
  const [selected, setSelected] = useState<Set<File>>(new Set());
  const [filter, setFilter] = useState<KindFilter>("all");
  const visible = useMemo(
    () =>
      files.filter((file) =>
        filter === "all" ? true : file.type.startsWith(`${filter}/`),
      ),
    [files, filter],
  );

  return (
    <section aria-labelledby="selected-files-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="selected-files-title" className="text-sm font-black text-[var(--text)]">
            追加したファイル
          </h2>
          <p className="mt-1 text-xs font-medium text-[var(--muted)]">
            {files.length}件 · 選択中 {selected.size}件
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as KindFilter)}
            aria-label="ファイル種別で絞り込む"
            className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-bold text-[var(--text)]"
          >
            <option value="all">すべての種類</option>
            <option value="image">画像</option>
            <option value="video">動画</option>
            <option value="audio">音声</option>
          </select>
          <button
            type="button"
            onClick={() =>
              setSelected(new Set(selected.size === visible.length ? [] : visible))
            }
            className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-xs font-bold text-[var(--text)]"
          >
            {selected.size === visible.length && visible.length > 0
              ? "選択解除"
              : "すべて選択"}
          </button>
          {selected.size > 0 && onRemoveMany && (
            <button
              type="button"
              onClick={() => {
                onRemoveMany([...selected]);
                setSelected(new Set());
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-red-200 px-3 text-xs font-bold text-red-700"
            >
              <Trash2 size={14} /> 選択を削除
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {visible.map((file) => (
          <FileCard
            key={`${file.name}:${file.size}:${file.lastModified}`}
            file={file}
            selected={selected.has(file)}
            onSelectedChange={(checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(file);
                else next.delete(file);
                return next;
              })
            }
            onRemove={() => onRemove(file)}
          />
        ))}
      </div>
    </section>
  );
}
