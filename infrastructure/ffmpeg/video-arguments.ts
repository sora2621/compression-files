import {
  CRF_MAP,
  normalizeVideoEnhancements,
  selectedVideoHeight,
  videoEnhancementsRequireReencode,
  type VideoCompressionOptions,
} from "@/lib/media/video-types";
import { normalizeProcessingSpeedPreset } from "@/lib/processing/types";

import { buildVideoFilterChain } from "./video-filters";

export const LOCAL_MEDIA_PROTOCOLS = "file,pipe,crypto,data";

export const X264_PRESET_BY_SPEED = {
  fast: "veryfast",
  balanced: "medium",
  "maximum-compression": "slow",
} as const;

export interface VideoEncoderRuntimeOptions {
  hardwareEncoder?:
    | "h264_nvenc"
    | "hevc_nvenc"
    | "av1_nvenc"
    | "h264_qsv"
    | "hevc_qsv"
    | "av1_qsv"
    | "h264_amf"
    | "hevc_amf"
    | "av1_amf"
    | "h264_videotoolbox"
    | "hevc_videotoolbox"
    | "h264_vaapi"
    | "hevc_vaapi";
  forceCpu?: boolean;
  /** Avoids an unnecessary scale filter when a preset equals the source height. */
  sourceHeight?: number;
}

function encoderFor(codec: VideoCompressionOptions["codec"]) {
  if (codec === "h264") return "libx264";
  if (codec === "h265") return "libx265";
  if (codec === "vp9") return "libvpx-vp9";
  return "libaom-av1";
}

export function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  compression: VideoCompressionOptions,
  runtime: VideoEncoderRuntimeOptions = {},
) {
  const selectedHeight = selectedVideoHeight(compression);
  const targetHeight =
    selectedHeight !== null && selectedHeight === runtime.sourceHeight
      ? null
      : selectedHeight;
  const enhancements = normalizeVideoEnhancements(compression.enhancements);
  const speedPreset = normalizeProcessingSpeedPreset(compression.speedPreset);
  const shouldReencode =
    compression.mode === "compress" ||
    targetHeight !== null ||
    (compression.frameRate ?? "original") !== "original" ||
    videoEnhancementsRequireReencode(enhancements);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    LOCAL_MEDIA_PROTOCOLS,
    "-i",
    inputPath,
  ];

  if (!shouldReencode) {
    args.push("-map", "0", "-c", "copy");
  } else {
    args.push("-map", "0:v:0", "-map", "0:a?");
    const filters = buildVideoFilterChain({
      targetHeight,
      frameRate: compression.frameRate,
      enhancements,
    });
    if (filters.length) args.push("-vf", filters.join(","));

    const hardwareEncoder = runtime.forceCpu ? undefined : runtime.hardwareEncoder;
    args.push("-c:v", hardwareEncoder ?? encoderFor(compression.codec));
    if (hardwareEncoder?.endsWith("_nvenc")) {
      args.push(
        "-rc",
        "vbr",
        "-cq",
        String(CRF_MAP[compression.codec][compression.quality]),
        "-b:v",
        "0",
        "-preset",
        "p4",
        "-tune",
        "hq",
      );
    } else if (hardwareEncoder?.endsWith("_qsv")) {
      args.push(
        "-global_quality",
        String(CRF_MAP[compression.codec][compression.quality]),
        "-preset",
        X264_PRESET_BY_SPEED[speedPreset],
      );
    } else if (hardwareEncoder?.endsWith("_videotoolbox")) {
      args.push("-q:v", String(CRF_MAP[compression.codec][compression.quality]));
    } else if (hardwareEncoder?.endsWith("_amf")) {
      args.push(
        "-quality",
        "speed",
        "-rc",
        "cqp",
        "-qp_i",
        String(CRF_MAP[compression.codec][compression.quality]),
        "-qp_p",
        String(CRF_MAP[compression.codec][compression.quality]),
      );
    } else if (hardwareEncoder?.endsWith("_vaapi")) {
      args.push("-qp", String(CRF_MAP[compression.codec][compression.quality]));
    } else {
      args.push("-crf", String(CRF_MAP[compression.codec][compression.quality]));
    }
    args.push("-pix_fmt", "yuv420p");
    if (!hardwareEncoder) {
      if (compression.codec === "h264" || compression.codec === "h265") {
        args.push("-preset", X264_PRESET_BY_SPEED[speedPreset]);
      } else if (compression.codec === "vp9") {
        args.push(
          "-b:v",
          "0",
          "-deadline",
          "good",
          "-cpu-used",
          speedPreset === "fast"
            ? "4"
            : speedPreset === "maximum-compression"
              ? "1"
              : "2",
        );
      } else {
        args.push(
          "-b:v",
          "0",
          "-cpu-used",
          speedPreset === "fast"
            ? "6"
            : speedPreset === "maximum-compression"
              ? "2"
              : "4",
        );
      }
    }

    if (compression.codec === "h265" && /\.(mp4|mov)$/i.test(outputPath)) {
      args.push("-tag:v", "hvc1");
    }

    if (compression.audio === "copy") {
      args.push("-c:a", "copy");
    } else if (compression.audio === "vorbis128") {
      args.push("-c:a", "libvorbis", "-b:a", "128k");
    } else if (compression.audio === "flac") {
      args.push("-c:a", "flac", "-compression_level", "8");
    } else if (compression.audio === "pcm") {
      args.push("-c:a", "pcm_s16le");
    } else if (compression.audio.startsWith("opus")) {
      args.push(
        "-c:a",
        "libopus",
        "-b:a",
        compression.audio === "opus128" ? "128k" : "96k",
      );
    } else {
      args.push("-c:a", "aac", "-b:a", compression.audio === "aac128" ? "128k" : "96k");
    }
  }

  if (compression.removeMetadata) {
    args.push("-map_metadata", "-1", "-map_chapters", "-1");
  }

  args.push("-progress", "pipe:1", "-nostats", outputPath);
  return { args, shouldReencode, targetHeight };
}
