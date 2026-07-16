import type {
  FileProcessingStatus,
  ProcessingStatus,
  ProcessingStepStatus,
} from "@/components/progress/types";

export type ProgressState =
  ProcessingStatus | ProcessingStepStatus | FileProcessingStatus;

export function clampProgress(value: number, state: ProgressState = "processing") {
  const normalized = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  const clamped = Math.min(100, Math.max(0, normalized));
  return state === "completed" ? 100 : Math.min(99, clamped);
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "不明";
  const sign = bytes < 0 ? "-" : "";
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${sign}${Math.round(absolute)} B`;
  if (absolute < 1024 ** 2) return `${sign}${(absolute / 1024).toFixed(1)} KB`;
  if (absolute < 1024 ** 3) {
    return `${sign}${(absolute / 1024 ** 2).toFixed(2)} MB`;
  }
  return `${sign}${(absolute / 1024 ** 3).toFixed(2)} GB`;
}

export function formatElapsedTime(seconds?: number | null) {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return "--";
  }
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  if (hours > 0) return `${hours}時間${minutes}分${remainingSeconds}秒`;
  if (minutes > 0) return `${minutes}分${remainingSeconds}秒`;
  return `${remainingSeconds}秒`;
}

export function formatMediaTime(seconds?: number | null) {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return "--:--";
  }
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function calculateReduction(originalSize: number, outputSize: number) {
  if (!Number.isFinite(originalSize) || originalSize <= 0) return null;
  return ((originalSize - outputSize) / originalSize) * 100;
}

export function sanitizeLogMessage(message: string) {
  return message
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"']+/g, "[内部パス]")
    .replace(/\/(?:tmp|private\/tmp|var\/tmp)\/[^\s"']+/g, "[一時ファイル]");
}

export const processingStatusLabels: Record<ProcessingStatus, string> = {
  "validating-settings": "設定を確認中",
  "creating-job": "処理を準備中",
  uploading: "アップロード中",
  "analyzing-media": "ファイル情報を解析中",
  "estimating-output": "出力容量を予測中",
  queued: "処理開始待ち",
  pending: "待機中",
  analyzing: "解析中",
  processing: "処理中",
  enhancing: "高画質化中",
  encoding: "エンコード中",
  finalizing: "出力を確認中",
  completed: "完了",
  failed: "エラー",
  cancelled: "キャンセル済み",
};

export const stepStatusLabels: Record<ProcessingStepStatus, string> = {
  pending: "未処理",
  processing: "処理中",
  completed: "完了",
  failed: "エラー",
  cancelled: "キャンセル済み",
};

export const fileStatusLabels: Record<FileProcessingStatus, string> = {
  pending: "待機中",
  "analyzing-file": "ファイル解析中",
  "analyzing-metadata": "メタデータ解析中",
  compressing: "圧縮中",
  converting: "形式変換中",
  enhancing: "高画質化中",
  outputting: "出力中",
  completed: "完了",
  failed: "エラー",
  cancelled: "キャンセル済み",
};
