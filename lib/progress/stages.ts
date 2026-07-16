import type { ProcessingStep } from "./types";

export const IMAGE_PROCESSING_STAGES = [
  "ファイルを確認",
  "メタデータを解析",
  "画像を変換",
  "画像を最適化",
  "出力ファイルを生成",
  "ダウンロード準備",
] as const;

export const VIDEO_PROCESSING_STAGES = [
  "ファイルを確認",
  "ffprobeで動画情報を解析",
  "メタデータを確認",
  "動画をデコード",
  "解像度・画質を調整",
  "動画をエンコード",
  "音声を結合",
  "出力ファイルを生成",
  "ダウンロード準備",
] as const;

export const AI_VIDEO_PROCESSING_STAGES = [
  "ファイルを解析",
  "フレームを抽出",
  "AIモデルを読み込み",
  "AI高画質化",
  "動画を再構築",
  "音声を結合",
  "出力ファイルを生成",
] as const;

export const AUDIO_PROCESSING_STAGES = [
  "ファイルを確認",
  "ffprobeで音声情報を解析",
  "メタデータを確認",
  "音声を変換",
  "出力ファイルを生成",
  "ダウンロード準備",
] as const;

export function stepsFromProgress(
  labels: readonly string[],
  stageIndex: number,
  terminal?: "completed" | "failed" | "cancelled",
): ProcessingStep[] {
  const safeIndex = Math.min(labels.length - 1, Math.max(0, stageIndex));
  return labels.map((label, index) => ({
    id: `${index + 1}`,
    label,
    status:
      terminal === "completed"
        ? "completed"
        : index < safeIndex
          ? "completed"
          : index > safeIndex
            ? "pending"
            : terminal === "failed"
              ? "failed"
              : terminal === "cancelled"
                ? "cancelled"
                : "processing",
  }));
}

export function inferStageIndex(progress: number, totalStages: number) {
  if (totalStages <= 1) return 0;
  const safeProgress = Math.min(99, Math.max(0, progress));
  return Math.min(totalStages - 1, Math.floor((safeProgress / 100) * totalStages));
}
