import { AppError } from "@/lib/errors";

import { LOCAL_MEDIA_PROTOCOLS } from "./video-arguments";

export type TargetVideoCodec = "h264" | "h265" | "av1";

export interface TwoPassBuildOptions {
  inputPath: string;
  outputPath: string;
  passlogPath: string;
  codec: TargetVideoCodec;
  videoBitrateKbps: number;
  audioBitrateKbpsPerTrack: number | null;
  removeAudio: boolean;
  targetHeight: number | null;
  sourceHeight: number;
  preset?: "veryfast" | "medium" | "slow" | "slower";
  platform?: NodeJS.Platform;
}

export interface TwoPassArguments {
  pass1Args: string[];
  pass2Args: string[];
  encoder: "libx264" | "libx265" | "libaom-av1";
  nullOutput: "NUL" | "/dev/null";
}

export function targetEncoderFor(codec: TargetVideoCodec) {
  return codec === "h264" ? "libx264" : codec === "h265" ? "libx265" : "libaom-av1";
}

function encodeVideoArgs(options: TwoPassBuildOptions, pass: 1 | 2) {
  const encoder = targetEncoderFor(options.codec);
  const preset = ["veryfast", "medium", "slow", "slower"].includes(options.preset ?? "")
    ? options.preset!
    : "slow";
  const args = [
    "-map",
    "0:v:0",
    "-c:v",
    encoder,
    "-b:v",
    `${Math.max(1, Math.floor(options.videoBitrateKbps))}k`,
    "-pass",
    String(pass),
    "-passlogfile",
    options.passlogPath,
  ];
  if (options.targetHeight && options.targetHeight < options.sourceHeight) {
    args.push("-vf", `scale=-2:${Math.floor(options.targetHeight)}:flags=lanczos`);
  }
  if (encoder === "libaom-av1") {
    args.push(
      "-cpu-used",
      preset === "veryfast"
        ? "7"
        : preset === "medium"
          ? "5"
          : preset === "slow"
            ? "3"
            : "1",
    );
  } else {
    args.push("-preset", preset);
  }
  if (encoder === "libx265") args.push("-tag:v", "hvc1");
  return args;
}

export function buildTwoPassArgs(options: TwoPassBuildOptions): TwoPassArguments {
  if (!(<readonly string[]>["h264", "h265", "av1"]).includes(options.codec)) {
    throw new AppError("動画コーデックが正しくありません。", 400, "INVALID_VIDEO_CODEC");
  }
  if (!Number.isFinite(options.videoBitrateKbps) || options.videoBitrateKbps <= 0) {
    throw new AppError("動画ビットレートが正しくありません。", 400, "INVALID_BITRATE");
  }
  const nullOutput = options.platform === "win32" ? "NUL" : "/dev/null";
  const input = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    LOCAL_MEDIA_PROTOCOLS,
    "-i",
    options.inputPath,
  ];
  const pass1Args = [
    ...input,
    ...encodeVideoArgs(options, 1),
    "-an",
    "-sn",
    "-dn",
    "-f",
    "null",
    nullOutput,
  ];
  const pass2Args = [...input, ...encodeVideoArgs(options, 2)];
  if (options.removeAudio) {
    pass2Args.push("-an");
  } else {
    pass2Args.push(
      "-map",
      "0:a?",
      "-c:a",
      "aac",
      "-b:a",
      `${Math.max(64, Math.floor(options.audioBitrateKbpsPerTrack ?? 64))}k`,
    );
  }
  pass2Args.push(
    "-map_metadata",
    "-1",
    "-map_chapters",
    "0",
    "-movflags",
    "+faststart",
    options.outputPath,
  );
  return {
    pass1Args,
    pass2Args,
    encoder: targetEncoderFor(options.codec),
    nullOutput,
  };
}

export function buildSampleExtractionArgs(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  codec: TargetVideoCodec,
  videoBitrateKbps: number,
  targetHeight: number | null,
  sourceHeight: number,
) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-t",
    String(Math.max(0.1, durationSeconds)),
    "-protocol_whitelist",
    LOCAL_MEDIA_PROTOCOLS,
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-c:v",
    targetEncoderFor(codec),
    "-b:v",
    `${Math.max(1, Math.floor(videoBitrateKbps))}k`,
    "-an",
  ];
  if (targetHeight && targetHeight < sourceHeight) {
    args.push("-vf", `scale=-2:${targetHeight}:flags=lanczos`);
  }
  args.push(outputPath);
  return args;
}
