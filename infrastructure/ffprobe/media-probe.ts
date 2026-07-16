import ffprobeStatic from "ffprobe-static";

import { LOCAL_MEDIA_PROTOCOLS } from "@/infrastructure/ffmpeg/video-arguments";
import { runCommand, type CommandRunner } from "@/infrastructure/process/command-runner";
import { AppError } from "@/lib/errors";
import { logger } from "@/shared/logging/logger";
import { createProcessingTimer } from "@/shared/logging/processing-timer";

import type {
  AudioMediaInfo,
  MediaProbeInfo,
  VideoMediaInfo,
} from "@/lib/media/video-types";

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  bit_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  color_range?: string;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  side_data_list?: Array<{ rotation?: number }>;
  disposition?: { attached_pic?: number; default?: number };
  tags?: Record<string, string>;
}

interface FfprobeResult {
  streams?: FfprobeStream[];
  chapters?: Array<{ id?: number }>;
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

export interface MediaProbeOptions {
  executable?: string | null;
  runner?: CommandRunner;
  signal?: AbortSignal;
}

const MEDIA_PROBE_TIMEOUT_MS = 20_000;
const MEDIA_PROBE_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") return null;
  const [numerator, denominator = "1"] = value.split("/", 2);
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) {
    return null;
  }
  const fps = top / bottom;
  return Number.isFinite(fps) && fps > 0 ? Number(fps.toFixed(3)) : null;
}

export function buildMediaProbeArgs(inputPath: string) {
  return [
    "-v",
    "error",
    "-protocol_whitelist",
    LOCAL_MEDIA_PROTOCOLS,
    "-show_streams",
    "-show_format",
    "-show_chapters",
    "-of",
    "json",
    inputPath,
  ];
}

export function parseMediaProbeOutput(output: string): MediaProbeInfo {
  let parsed: FfprobeResult;
  try {
    parsed = JSON.parse(output) as FfprobeResult;
  } catch {
    throw new AppError("メディア情報を解析できませんでした。", 422, "MEDIA_PROBE_FAILED");
  }

  const video = parsed.streams?.find(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const duration =
    positiveNumber(parsed.format?.duration) ??
    positiveNumber(video?.duration) ??
    positiveNumber(audio?.duration);
  const rotation =
    video?.side_data_list
      ?.map((sideData) => Number(sideData.rotation))
      .find((value) => Number.isFinite(value)) ??
    (Number.isFinite(Number(video?.tags?.rotate))
      ? Number(video?.tags?.rotate)
      : undefined);
  const bitsPerRawSample = positiveNumber(video?.bits_per_raw_sample) ?? undefined;
  const hdr = Boolean(
    video &&
    (video.color_transfer === "smpte2084" ||
      video.color_transfer === "arib-std-b67" ||
      video.color_primaries === "bt2020" ||
      (video.pix_fmt && /(?:10|12|p010|p012)/.test(video.pix_fmt)) ||
      (bitsPerRawSample ?? 0) >= 10),
  );

  if (!duration || (!video && !audio)) {
    throw new AppError(
      "再生可能な映像・音声ストリームまたは再生時間を取得できませんでした。",
      422,
      "MEDIA_INFO_INCOMPLETE",
    );
  }

  return {
    kind: video ? "video" : "audio",
    formatName: parsed.format?.format_name ?? "unknown",
    duration,
    bitrate:
      positiveNumber(parsed.format?.bit_rate) ??
      positiveNumber(video?.bit_rate) ??
      positiveNumber(audio?.bit_rate),
    chapterCount: parsed.chapters?.length ?? 0,
    video: video
      ? {
          width: positiveNumber(video.width) ?? 0,
          height: positiveNumber(video.height) ?? 0,
          codec: video.codec_name ?? "unknown",
          bitrate: positiveNumber(video.bit_rate),
          fps: parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate),
          pixelFormat: video.pix_fmt,
          bitsPerRawSample,
          colorPrimaries: video.color_primaries,
          colorTransfer: video.color_transfer,
          colorSpace: video.color_space,
          colorRange: video.color_range,
          sampleAspectRatio: video.sample_aspect_ratio,
          displayAspectRatio: video.display_aspect_ratio,
          rotation,
          hdr,
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name ?? "unknown",
          bitrate: positiveNumber(audio.bit_rate),
          sampleRate: positiveNumber(audio.sample_rate),
          channels: positiveNumber(audio.channels),
        }
      : null,
    streams: (parsed.streams ?? []).map((stream) => ({
      index: stream.index ?? -1,
      type:
        stream.codec_type === "video" ||
        stream.codec_type === "audio" ||
        stream.codec_type === "subtitle" ||
        stream.codec_type === "attachment" ||
        stream.codec_type === "data"
          ? stream.codec_type
          : "unknown",
      codec: stream.codec_name ?? "unknown",
      language: stream.tags?.language ?? null,
      title: stream.tags?.title ?? null,
      isDefault: stream.disposition?.default === 1,
      isAttachedPicture: stream.disposition?.attached_pic === 1,
      tags: stream.tags,
    })),
    audioTrackCount: (parsed.streams ?? []).filter(
      (stream) => stream.codec_type === "audio",
    ).length,
    formatTags: parsed.format?.tags ?? {},
  };
}

export async function probeMedia(
  inputPath: string,
  options: MediaProbeOptions = {},
): Promise<MediaProbeInfo> {
  const executable = options.executable ?? process.env.FFPROBE_PATH ?? ffprobeStatic.path;
  if (!executable) {
    throw new AppError(
      "ffprobeが見つかりません。サーバーのセットアップを確認してください。",
      500,
      "FFPROBE_NOT_FOUND",
    );
  }

  const timer = createProcessingTimer();
  const { stdout } = await timer.measure("ffprobe", () =>
    (options.runner ?? runCommand)(executable, buildMediaProbeArgs(inputPath), {
      timeoutMs: MEDIA_PROBE_TIMEOUT_MS,
      signal: options.signal,
      stdoutLimitBytes: MEDIA_PROBE_OUTPUT_LIMIT_BYTES,
      stderrLimitBytes: 6_000,
      rejectOnStdoutLimit: true,
      createAbortError: () =>
        new AppError("メディア情報の解析を中止しました。", 499, "CANCELLED"),
      createTimeoutError: () =>
        new AppError(
          "メディア情報の解析がタイムアウトしました。",
          408,
          "MEDIA_PROBE_TIMEOUT",
        ),
      createStdoutLimitError: () =>
        new AppError(
          "メディア情報が大きすぎるため解析を中止しました。",
          422,
          "MEDIA_PROBE_OUTPUT_TOO_LARGE",
        ),
      createFailureError: () => {
        logger.error({
          stage: "media-probe",
          errorCode: "MEDIA_PROBE_FAILED",
        });
        return new AppError(
          "メディア情報を取得できませんでした。未対応形式または破損ファイルです。",
          422,
          "MEDIA_PROBE_FAILED",
        );
      },
    }),
  );
  return parseMediaProbeOutput(stdout);
}

export async function probeVideo(
  inputPath: string,
  options?: MediaProbeOptions,
): Promise<VideoMediaInfo> {
  const media = await probeMedia(inputPath, options);
  if (media.kind !== "video" || !media.video) {
    throw new AppError(
      "映像ストリームがありません。音声ファイルとして処理してください。",
      415,
      "VIDEO_REQUIRED",
    );
  }
  if (!media.video.width || !media.video.height) {
    throw new AppError(
      "動画の解像度を取得できませんでした。",
      422,
      "VIDEO_INFO_INCOMPLETE",
    );
  }
  return {
    formatName: media.formatName,
    width: media.video.width,
    height: media.video.height,
    duration: media.duration,
    bitrate: media.bitrate,
    chapterCount: media.chapterCount,
    fps: media.video.fps,
    videoCodec: media.video.codec,
    audioCodec: media.audio?.codec ?? null,
    audioBitrate: media.audio?.bitrate ?? null,
    audioTrackCount: media.audioTrackCount,
  };
}

export async function probeAudio(
  inputPath: string,
  options?: MediaProbeOptions,
): Promise<AudioMediaInfo> {
  const media = await probeMedia(inputPath, options);
  if (!media.audio || media.kind !== "audio") {
    throw new AppError("音声専用ファイルではありません。", 415, "AUDIO_REQUIRED");
  }
  return {
    formatName: media.formatName,
    duration: media.duration,
    bitrate: media.bitrate,
    audioCodec: media.audio.codec,
    audioBitrate: media.audio.bitrate,
    sampleRate: media.audio.sampleRate,
    channels: media.audio.channels,
  };
}
