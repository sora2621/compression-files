import { AppError } from "@/lib/errors";

import type { AudioOutputFormat } from "@/lib/media/audio-types";
import type {
  AudioMediaInfo,
  VideoCodec,
  VideoMediaInfo,
  VideoOutputContainer,
} from "@/lib/media/video-types";

const VIDEO_FORMAT_NAMES: Record<
  Exclude<VideoOutputContainer, "source">,
  readonly string[]
> = {
  mp4: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  mov: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  webm: ["matroska", "webm"],
  mkv: ["matroska", "webm"],
};

const AUDIO_FORMAT_NAMES: Record<AudioOutputFormat, readonly string[]> = {
  mp3: ["mp3"],
  m4a: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  aac: ["aac"],
  opus: ["ogg", "opus"],
  ogg: ["ogg"],
  wav: ["wav"],
  flac: ["flac"],
};

function containsFormat(formatName: string, allowed: readonly string[]) {
  const actual = new Set(formatName.toLowerCase().split(","));
  return allowed.some((name) => actual.has(name));
}

function videoCodecMatches(expected: VideoCodec, actual: string) {
  if (expected === "h265") return actual === "hevc" || actual === "h265";
  return actual === expected;
}

export function assertVideoOutputMatches(
  container: Exclude<VideoOutputContainer, "source">,
  expectedCodec: VideoCodec | null,
  output: VideoMediaInfo,
) {
  if (!containsFormat(output.formatName, VIDEO_FORMAT_NAMES[container])) {
    throw new AppError(
      "出力動画の内容と選択したコンテナが一致しないため、ダウンロードを中止しました。",
      422,
      "OUTPUT_FORMAT_MISMATCH",
    );
  }
  if (expectedCodec && !videoCodecMatches(expectedCodec, output.videoCodec)) {
    throw new AppError(
      "出力動画の映像コーデックが指定と一致しないため、ダウンロードを中止しました。",
      422,
      "OUTPUT_CODEC_MISMATCH",
    );
  }
}

export function assertAudioOutputMatches(
  format: AudioOutputFormat,
  output: AudioMediaInfo,
) {
  if (!containsFormat(output.formatName, AUDIO_FORMAT_NAMES[format])) {
    throw new AppError(
      "出力音声の内容と選択した形式が一致しないため、ダウンロードを中止しました。",
      422,
      "OUTPUT_FORMAT_MISMATCH",
    );
  }
  const expectedCodec =
    format === "m4a" || format === "aac"
      ? "aac"
      : format === "ogg"
        ? "vorbis"
        : format === "wav"
          ? "pcm_"
          : format;
  if (
    (expectedCodec === "pcm_" && !output.audioCodec.startsWith("pcm_")) ||
    (expectedCodec !== "pcm_" && output.audioCodec !== expectedCodec)
  ) {
    throw new AppError(
      "出力音声のコーデックが指定と一致しないため、ダウンロードを中止しました。",
      422,
      "OUTPUT_CODEC_MISMATCH",
    );
  }
}
