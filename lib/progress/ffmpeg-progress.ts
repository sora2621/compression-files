import type { FfmpegProgressMetrics } from "./types";

const MAX_BUFFER_LENGTH = 128 * 1024;

function finiteNumber(value: string | undefined) {
  if (value === undefined || value === "N/A") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseFfmpegTimestamp(value: string | undefined) {
  if (!value) return undefined;
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes >= 60 ||
    seconds >= 60
  ) {
    return undefined;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function parseFfmpegProgressBlock(
  values: Readonly<Record<string, string>>,
): FfmpegProgressMetrics {
  const speed = values.speed?.trim();
  const bitrate = values.bitrate?.trim();
  // Despite its historical name, FFmpeg reports out_time_ms in microseconds.
  const microseconds = finiteNumber(values.out_time_us ?? values.out_time_ms);
  const timestampSeconds = parseFfmpegTimestamp(values.out_time);
  const rawProgress = values.progress;
  return {
    frame: finiteNumber(values.frame),
    fps: finiteNumber(values.fps),
    bitrate,
    bitrateKbps: bitrate?.endsWith("kbits/s")
      ? finiteNumber(bitrate.slice(0, -"kbits/s".length).trim())
      : undefined,
    totalSize: finiteNumber(values.total_size),
    outTimeSeconds:
      microseconds !== undefined ? microseconds / 1_000_000 : timestampSeconds,
    outTime: values.out_time,
    duplicateFrames: finiteNumber(values.dup_frames),
    droppedFrames: finiteNumber(values.drop_frames),
    speed,
    speedMultiplier: speed?.endsWith("x") ? finiteNumber(speed.slice(0, -1)) : undefined,
    progress:
      rawProgress === "continue" || rawProgress === "end" ? rawProgress : undefined,
  };
}

/** Stateful parser that handles arbitrary stdout chunk boundaries. */
export class FfmpegProgressParser {
  private buffer = "";
  private block: Record<string, string> = {};

  constructor(private readonly onProgress: (value: FfmpegProgressMetrics) => void) {}

  push(chunk: string | Buffer) {
    this.buffer += chunk.toString();
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      // Keep the newest unterminated line. Valid FFmpeg progress lines are tiny.
      this.buffer = this.buffer.slice(-MAX_BUFFER_LENGTH);
    }
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.consumeLine(line);
  }

  finish() {
    if (this.buffer) this.consumeLine(this.buffer);
    this.buffer = "";
    if (Object.keys(this.block).length > 0) this.emitBlock();
  }

  private consumeLine(line: string) {
    const separator = line.indexOf("=");
    if (separator <= 0) return;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key) return;
    this.block[key] = value;
    if (key === "progress") this.emitBlock();
  }

  private emitBlock() {
    const block = this.block;
    this.block = {};
    this.onProgress(parseFfmpegProgressBlock(block));
  }
}

export function calculateFfmpegProgress(
  metrics: FfmpegProgressMetrics,
  totalDuration?: number,
  totalFrames?: number,
) {
  let ratio: number | undefined;
  if (
    metrics.outTimeSeconds !== undefined &&
    totalDuration !== undefined &&
    totalDuration > 0
  ) {
    ratio = metrics.outTimeSeconds / totalDuration;
  } else if (
    metrics.frame !== undefined &&
    totalFrames !== undefined &&
    totalFrames > 0
  ) {
    ratio = metrics.frame / totalFrames;
  }
  if (ratio === undefined || !Number.isFinite(ratio)) return 0;
  return Number(Math.min(99, Math.max(0, ratio * 100)).toFixed(1));
}
