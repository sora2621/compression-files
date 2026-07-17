"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ImageSaveStatus } from "@/components/files/image-save-status";
import { createCompressedFileName } from "@/shared/files/create-compressed-file-name";
import {
  canShareImageFile,
  IMAGE_SAVE_ERROR_MESSAGE,
  saveImageToDevice,
} from "@/shared/files/save-image-to-device";

interface MobileImageDownloadButtonProps {
  downloadUrl?: string | null;
  originalFileName: string;
  outputExtension: string;
  outputMimeType?: string;
}

export function MobileImageDownloadButton({
  downloadUrl,
  originalFileName,
  outputExtension,
  outputMimeType,
}: MobileImageDownloadButtonProps) {
  const [loadedResult, setLoadedResult] = useState<{
    url: string;
    blob: Blob;
  } | null>(null);
  const [loadErrorUrl, setLoadErrorUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [hasError, setHasError] = useState(false);
  const saveLock = useRef(false);
  const fileName = useMemo(
    () => createCompressedFileName(originalFileName, outputExtension),
    [originalFileName, outputExtension],
  );

  useEffect(() => {
    const controller = new AbortController();

    if (!downloadUrl) {
      return () => controller.abort();
    }

    void fetch(downloadUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Result image could not be loaded");
        return response.blob();
      })
      .then((resultBlob) => {
        setLoadedResult({ url: downloadUrl, blob: resultBlob });
        setLoadErrorUrl(null);
        setStatus("");
        setHasError(false);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadErrorUrl(downloadUrl);
        setHasError(true);
        setStatus(IMAGE_SAVE_ERROR_MESSAGE);
      });

    return () => controller.abort();
  }, [downloadUrl]);

  const blob =
    loadedResult && loadedResult.url === downloadUrl ? loadedResult.blob : null;
  const loading = Boolean(downloadUrl && !blob && loadErrorUrl !== downloadUrl);
  const saveOptions = blob
    ? { blob, fileName, mimeType: outputMimeType, title: `画像を保存: ${fileName}` }
    : null;
  const shareAvailable = saveOptions ? canShareImageFile(saveOptions) : false;
  const disabled = !blob || loading || saving;

  const save = async () => {
    if (!saveOptions || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setHasError(false);
    setStatus("保存・共有画面を準備しています。");

    try {
      const result = await saveImageToDevice(saveOptions);
      if (result.status === "saved") {
        setStatus(
          result.method === "share"
            ? "端末の保存・共有画面を開きました。"
            : "ダウンロードを開始しました。",
        );
      } else {
        setStatus("");
      }
    } catch {
      setHasError(true);
      setStatus(IMAGE_SAVE_ERROR_MESSAGE);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <aside
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[color:var(--surface)/.97] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(15,23,42,.12)] backdrop-blur md:hidden"
      aria-label="処理済み画像の保存"
    >
      <div className="mx-auto max-w-xl">
        <div className="mb-2 flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p
              className="truncate text-xs font-black text-[var(--text)]"
              title={fileName}
            >
              保存名: {fileName}
            </p>
            <p className="mt-1 text-[11px] font-medium text-[var(--muted)]">
              {shareAvailable
                ? "ボタンを押すと端末の保存・共有画面が開きます。"
                : "このブラウザーではダウンロードフォルダーへ保存します。"}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          aria-busy={saving}
          onClick={() => void save()}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-5 text-sm font-black text-white shadow-sm transition hover:bg-[var(--primary-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading || saving ? (
            <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
          ) : (
            <Download size={18} aria-hidden="true" />
          )}
          {saving ? "保存しています…" : loading ? "画像を準備しています…" : "画像を保存"}
        </button>
        <div className="mt-1.5">
          <ImageSaveStatus message={status} error={hasError} />
        </div>
      </div>
    </aside>
  );
}
