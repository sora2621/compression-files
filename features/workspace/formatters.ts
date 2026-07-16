import type { ProcessResult } from "@/features/workspace/types";

export function formatBytes(bytes: number) {
  const absolute = Math.abs(bytes);
  if (absolute < 1024) return `${absolute} B`;
  if (absolute < 1024 * 1024) return `${(absolute / 1024).toFixed(1)} KB`;
  if (absolute < 1024 * 1024 * 1024) {
    return `${(absolute / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(absolute / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatMediaBitrate(bitrate: number | null) {
  if (!bitrate) return "不明";
  if (bitrate >= 1_000_000) {
    return `${(bitrate / 1_000_000).toFixed(2)} Mbps`;
  }
  return `${Math.round(bitrate / 1000)} kbps`;
}

export function reductionCopy(result: ProcessResult) {
  if (result.savedBytes >= 0) {
    return `${formatBytes(result.savedBytes)} 削減`;
  }
  return `${formatBytes(result.savedBytes)} 増加`;
}
