import ffprobeStatic from "ffprobe-static";

import { defaultTargetCommandRunner } from "@/infrastructure/ffmpeg/target-command-runner";
import { LOCAL_MEDIA_PROTOCOLS } from "@/infrastructure/ffmpeg/video-arguments";
import { AppError } from "@/lib/errors";

import { parseFrameRate } from "./media-probe";

import type { TargetCommandRunner } from "@/infrastructure/ffmpeg/target-command-runner";

export interface TargetMediaProbe {
  kind: "video" | "audio";
  duration: number;
  size: number;
  formatName: string;
  totalBitrateKbps: number | null;
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodecs: string[];
  audioTrackCount: number;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  bit_rate?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

interface RawProbe {
  streams?: RawStream[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
}

const TARGET_PROBE_TIMEOUT_MS = 30_000;

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildTargetProbeArgs(inputPath: string) {
  return [
    "-v",
    "error",
    "-protocol_whitelist",
    LOCAL_MEDIA_PROTOCOLS,
    "-show_entries",
    "stream=codec_type,codec_name,bit_rate,width,height,avg_frame_rate,r_frame_rate:format=format_name,duration,size,bit_rate",
    "-of",
    "json",
    inputPath,
  ];
}

export function parseTargetProbeOutput(stdout: string): TargetMediaProbe {
  let parsed: RawProbe;
  try {
    parsed = JSON.parse(stdout) as RawProbe;
  } catch {
    throw new AppError(
      "ffprobeの結果を解析できませんでした。",
      422,
      "TARGET_SIZE_PROBE_FAILED",
    );
  }
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  const duration = positiveNumber(parsed.format?.duration) ?? 0;
  const size = positiveNumber(parsed.format?.size) ?? 0;
  if (duration <= 0) {
    throw new AppError("再生時間が0秒のファイルは処理できません。", 422, "ZERO_DURATION");
  }
  if (size <= 0) {
    throw new AppError("0バイトのファイルは処理できません。", 422, "EMPTY_FILE");
  }
  const audioBitrate = audio.reduce(
    (sum, stream) => sum + (positiveNumber(stream.bit_rate) ?? 0),
    0,
  );
  return {
    kind: video ? "video" : "audio",
    duration,
    size,
    formatName: parsed.format?.format_name ?? "unknown",
    totalBitrateKbps:
      positiveNumber(parsed.format?.bit_rate) !== null
        ? Math.round((positiveNumber(parsed.format?.bit_rate) ?? 0) / 1000)
        : null,
    videoBitrateKbps:
      positiveNumber(video?.bit_rate) !== null
        ? Math.round((positiveNumber(video?.bit_rate) ?? 0) / 1000)
        : null,
    audioBitrateKbps: audioBitrate > 0 ? Math.round(audioBitrate / 1000) : null,
    width: positiveNumber(video?.width),
    height: positiveNumber(video?.height),
    fps: parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate),
    videoCodec: video?.codec_name ?? null,
    audioCodecs: audio.map((stream) => stream.codec_name ?? "unknown"),
    audioTrackCount: audio.length,
  };
}

export async function probeTargetMedia(
  inputPath: string,
  ffprobeExecutable = process.env.FFPROBE_PATH ?? ffprobeStatic.path,
  runner: TargetCommandRunner = defaultTargetCommandRunner,
  signal?: AbortSignal,
): Promise<TargetMediaProbe> {
  if (!ffprobeExecutable) {
    throw new AppError("ffprobeを利用できません。", 503, "FFPROBE_UNAVAILABLE");
  }
  const { stdout } = await runner(ffprobeExecutable, buildTargetProbeArgs(inputPath), {
    timeoutMs: TARGET_PROBE_TIMEOUT_MS,
    signal,
  });
  return parseTargetProbeOutput(stdout);
}
