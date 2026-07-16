import { spawn } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";

import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";

import type {
  AdvancedOptimizationMode,
  OptimizationCandidateReport,
  OptimizationReport,
  QualitySegment,
  VideoQualitySearchOptions,
  VideoStreamSelectionOptions,
} from "./types";

const LOCAL_PROTOCOLS = "file,pipe,crypto,data";
const COMMAND_OUTPUT_LIMIT = 8 * 1024 * 1024;
const ENCODE_TIMEOUT_MS = 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 30_000;

export interface VideoOptimizationStream {
  index: number;
  codecType: "video" | "audio" | "subtitle" | "attachment" | "data" | string;
  codecName?: string;
  tags?: Record<string, string>;
  attachedPicture?: boolean;
}

export interface VideoOptimizationProbe {
  formatName: string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  videoCodec: string;
  pixelFormat?: string;
  bitsPerRawSample?: number;
  colorPrimaries?: string;
  colorTransfer?: string;
  colorSpace?: string;
  colorRange?: string;
  sampleAspectRatio?: string;
  displayAspectRatio?: string;
  rotation?: number;
  hdr: boolean;
  streams: VideoOptimizationStream[];
  chapterCount: number;
  formatTags: Record<string, string>;
}

export interface VideoOptimizationCapabilities {
  ffmpegAvailable: boolean;
  encoders: readonly string[];
  filters: readonly string[];
  muxers: readonly string[];
}

export interface RemovalPreviewItem {
  category: "audio" | "subtitle" | "attachment" | "chapter" | "metadata";
  label: string;
  count: number;
  details: string[];
}

export interface VideoRemovalPreview {
  willRemove: boolean;
  items: RemovalPreviewItem[];
  preservedTechnicalData: string[];
}

export interface QualityCandidateDefinition {
  id: string;
  label: string;
  codec: "av1" | "h265" | "h264";
  encoder: string;
  crf: number;
  preset: VideoQualitySearchOptions["preset"];
  available: boolean;
  unavailableReason?: string;
}

export interface VmafAssessment {
  mean: number;
  min: number;
  lowQualitySegments: QualitySegment[];
}

export interface OptimizationCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type OptimizationCommandRunner = (
  executable: string,
  args: readonly string[],
  options?: OptimizationCommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface OptimizeVideoQualityOptions {
  inputPath: string;
  outputDirectory: string;
  mode: Extract<
    AdvancedOptimizationMode,
    "strict-lossless" | "high-quality-optimization"
  >;
  streamSelection: VideoStreamSelectionOptions;
  qualitySearch: VideoQualitySearchOptions;
  probe?: VideoOptimizationProbe;
  capabilities?: VideoOptimizationCapabilities;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  runner?: OptimizationCommandRunner;
  signal?: AbortSignal;
  onProgress?: (stage: string) => void;
  onCandidate?: (candidate: OptimizationCandidateReport) => void;
}

interface RawProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_primaries?: string;
  color_transfer?: string;
  color_space?: string;
  color_range?: string;
  sample_aspect_ratio?: string;
  display_aspect_ratio?: string;
  tags?: Record<string, string>;
  disposition?: { attached_pic?: number };
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
}

interface RawProbeResult {
  streams?: RawProbeStream[];
  chapters?: unknown[];
  format?: {
    format_name?: string;
    duration?: string;
    size?: string;
    tags?: Record<string, string>;
  };
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFrameRate(value: string | undefined) {
  if (!value || value === "0/0") return null;
  const [topRaw, bottomRaw = "1"] = value.split("/", 2);
  const top = Number(topRaw);
  const bottom = Number(bottomRaw);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return null;
  const result = top / bottom;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function safeEnum(value: string | undefined, allowed: ReadonlySet<string>) {
  return value && allowed.has(value) ? value : undefined;
}

const PIXEL_FORMATS = new Set([
  "yuv420p",
  "yuv422p",
  "yuv444p",
  "yuv420p10le",
  "yuv422p10le",
  "yuv444p10le",
  "yuv420p12le",
  "yuv422p12le",
  "yuv444p12le",
  "p010le",
  "p012le",
]);
const COLOR_PRIMARIES = new Set([
  "bt709",
  "bt2020",
  "smpte170m",
  "smpte240m",
  "smpte431",
  "smpte432",
  "film",
  "unknown",
]);
const COLOR_TRANSFERS = new Set([
  "bt709",
  "bt2020-10",
  "bt2020-12",
  "smpte170m",
  "smpte240m",
  "smpte2084",
  "arib-std-b67",
  "iec61966-2-1",
  "linear",
  "unknown",
]);
const COLOR_SPACES = new Set([
  "bt709",
  "bt2020nc",
  "bt2020c",
  "smpte170m",
  "smpte240m",
  "fcc",
  "rgb",
  "unknown",
]);
const COLOR_RANGES = new Set(["tv", "pc", "mpeg", "jpeg", "unknown"]);

export const defaultOptimizationCommandRunner: OptimizationCommandRunner = (
  executable,
  args,
  options = {},
) =>
  new Promise((resolveCommand, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ executable, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolveCommand({ stdout, stderr });
    };
    const append = (current: string, chunk: Buffer) =>
      `${current}${chunk.toString()}`.slice(-COMMAND_OUTPUT_LIMIT);
    const abort = () => {
      child.kill("SIGKILL");
      finish(new AppError("動画最適化をキャンセルしました。", 499, "CANCELLED"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new AppError(
          "動画最適化が制限時間を超えました。",
          408,
          "VIDEO_OPTIMIZATION_TIMEOUT",
        ),
      );
    }, options.timeoutMs ?? ENCODE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else
        finish(
          new AppError(
            "FFmpegによる動画最適化に失敗しました。",
            422,
            "VIDEO_OPTIMIZATION_FAILED",
          ),
        );
    });
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });

export async function probeVideoForOptimization(
  inputPath: string,
  ffprobeExecutable = process.env.FFPROBE_PATH ?? ffprobeStatic.path,
  runner: OptimizationCommandRunner = defaultOptimizationCommandRunner,
  signal?: AbortSignal,
): Promise<VideoOptimizationProbe> {
  if (!ffprobeExecutable) {
    throw new AppError("ffprobeを利用できません。", 503, "FFPROBE_UNAVAILABLE");
  }
  const { stdout } = await runner(
    ffprobeExecutable,
    [
      "-v",
      "error",
      "-protocol_whitelist",
      LOCAL_PROTOCOLS,
      "-show_streams",
      "-show_format",
      "-show_chapters",
      "-of",
      "json",
      inputPath,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS, signal },
  );
  let parsed: RawProbeResult;
  try {
    parsed = JSON.parse(stdout) as RawProbeResult;
  } catch {
    throw new AppError(
      "動画の詳細情報を解析できませんでした。",
      422,
      "VIDEO_OPTIMIZATION_PROBE_FAILED",
    );
  }
  const rawStreams = parsed.streams ?? [];
  const video = rawStreams.find(
    (stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1,
  );
  const width = finiteNumber(video?.width) ?? 0;
  const height = finiteNumber(video?.height) ?? 0;
  const duration = finiteNumber(parsed.format?.duration) ?? 0;
  const size = finiteNumber(parsed.format?.size) ?? 0;
  if (!video || width <= 0 || height <= 0 || duration <= 0 || size <= 0) {
    throw new AppError(
      "動画の解像度、再生時間、または容量を取得できませんでした。",
      422,
      "VIDEO_OPTIMIZATION_INFO_INCOMPLETE",
    );
  }
  const rotation =
    video.side_data_list
      ?.map((sideData) => finiteNumber(sideData.rotation))
      .find((value) => value !== undefined) ?? finiteNumber(video.tags?.rotate);
  const pixelFormat = video.pix_fmt;
  const bitsPerRawSample = finiteNumber(video.bits_per_raw_sample);
  const hdr =
    video.color_transfer === "smpte2084" ||
    video.color_transfer === "arib-std-b67" ||
    video.color_primaries === "bt2020" ||
    Boolean(pixelFormat && /(?:10|12|p010|p012)/.test(pixelFormat)) ||
    (bitsPerRawSample ?? 0) >= 10;

  return {
    formatName: parsed.format?.format_name ?? "unknown",
    size,
    duration,
    width,
    height,
    fps: parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate),
    videoCodec: video.codec_name ?? "unknown",
    pixelFormat,
    bitsPerRawSample,
    colorPrimaries: video.color_primaries,
    colorTransfer: video.color_transfer,
    colorSpace: video.color_space,
    colorRange: video.color_range,
    sampleAspectRatio: video.sample_aspect_ratio,
    displayAspectRatio: video.display_aspect_ratio,
    rotation,
    hdr,
    streams: rawStreams.map((stream) => ({
      index: stream.index ?? -1,
      codecType: stream.codec_type ?? "unknown",
      codecName: stream.codec_name,
      tags: stream.tags,
      attachedPicture: stream.disposition?.attached_pic === 1,
    })),
    chapterCount: parsed.chapters?.length ?? 0,
    formatTags: parsed.format?.tags ?? {},
  };
}

export function previewVideoStreamRemovals(
  probe: VideoOptimizationProbe,
  options: VideoStreamSelectionOptions,
): VideoRemovalPreview {
  const items: RemovalPreviewItem[] = [];
  const audio = probe.streams.filter((stream) => stream.codecType === "audio");
  const subtitles = probe.streams.filter((stream) => stream.codecType === "subtitle");
  const attachments = probe.streams.filter(
    (stream) => stream.codecType === "attachment" || stream.attachedPicture,
  );
  if (options.keepPrimaryAudioOnly && audio.length > 1) {
    items.push({
      category: "audio",
      label: "主音声以外の音声トラック",
      count: audio.length - 1,
      details: audio
        .slice(1)
        .map((stream) => stream.tags?.title ?? `音声 #${stream.index}`),
    });
  }
  if (options.removeSubtitles && subtitles.length) {
    items.push({
      category: "subtitle",
      label: "字幕トラック",
      count: subtitles.length,
      details: subtitles.map(
        (stream) =>
          stream.tags?.title ?? stream.tags?.language ?? `字幕 #${stream.index}`,
      ),
    });
  }
  if (options.removeAttachments && attachments.length) {
    items.push({
      category: "attachment",
      label: "添付ファイル・カバー画像",
      count: attachments.length,
      details: attachments.map(
        (stream) =>
          stream.tags?.filename ?? stream.tags?.title ?? `添付 #${stream.index}`,
      ),
    });
  }
  if (options.removeChapters && probe.chapterCount > 0) {
    items.push({
      category: "chapter",
      label: "チャプター",
      count: probe.chapterCount,
      details: [`${probe.chapterCount}件のチャプター`],
    });
  }
  const metadataKeys = Object.keys(probe.formatTags).sort();
  if (options.stripPrivacyMetadata && metadataKeys.length) {
    items.push({
      category: "metadata",
      label: "コンテナのプライバシーメタデータ",
      count: metadataKeys.length,
      details: metadataKeys,
    });
  }
  return {
    willRemove: items.length > 0,
    items,
    preservedTechnicalData: [
      "映像・音声の圧縮済みストリーム",
      "色空間・色域・HDR side data",
      "回転・アスペクト比・タイムベース・FPS",
    ],
  };
}

function streamMapArgs(options: VideoStreamSelectionOptions) {
  // FFmpeg's uppercase V excludes attached pictures/cover art while preserving
  // ordinary video. This avoids deleting display-matrix/HDR side data from the
  // retained main stream merely to remove an attachment.
  const args = ["-map", options.removeAttachments ? "0:V?" : "0:v?"];
  args.push("-map", options.keepPrimaryAudioOnly ? "0:a:0?" : "0:a?");
  if (!options.removeSubtitles) args.push("-map", "0:s?");
  if (!options.removeAttachments) args.push("-map", "0:t?");
  args.push("-map", "0:d?");
  return args;
}

function selectionMetadataArgs(options: VideoStreamSelectionOptions) {
  return [
    "-map_metadata",
    options.stripPrivacyMetadata ? "-1" : "0",
    "-map_chapters",
    options.removeChapters ? "-1" : "0",
  ];
}

function baseInputArgs(inputPath: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    LOCAL_PROTOCOLS,
    "-i",
    inputPath,
  ];
}

export function buildStrictLosslessCopyArgs(
  inputPath: string,
  outputPath: string,
  options: VideoStreamSelectionOptions,
) {
  return [
    ...baseInputArgs(inputPath),
    ...streamMapArgs(options),
    "-c",
    "copy",
    ...selectionMetadataArgs(options),
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  ];
}

function encoderFor(codec: QualityCandidateDefinition["codec"], encoders: Set<string>) {
  if (codec === "av1") {
    if (encoders.has("libsvtav1")) return "libsvtav1";
    return "libaom-av1";
  }
  return codec === "h265" ? "libx265" : "libx264";
}

export function buildVideoQualityCandidates(
  options: VideoQualitySearchOptions,
  capabilities: VideoOptimizationCapabilities,
) {
  const encoders = new Set(capabilities.encoders);
  const preset: VideoQualitySearchOptions["preset"] = [
    "medium",
    "slow",
    "slower",
  ].includes(options.preset)
    ? options.preset
    : "medium";
  const specifications: Array<{
    enabled: boolean;
    codec: QualityCandidateDefinition["codec"];
    label: string;
    crfs: number[];
  }> = [
    { enabled: options.includeAv1, codec: "av1", label: "AV1", crfs: [18, 22, 26, 30] },
    {
      enabled: options.includeH265,
      codec: "h265",
      label: "H.265",
      crfs: [18, 21, 24, 27],
    },
    {
      enabled: options.includeH264,
      codec: "h264",
      label: "H.264 高品質",
      crfs: [16, 18, 20],
    },
  ];
  return specifications.flatMap((specification) => {
    if (!specification.enabled) return [];
    const encoder = encoderFor(specification.codec, encoders);
    const available = capabilities.ffmpegAvailable && encoders.has(encoder);
    return specification.crfs.map((crf): QualityCandidateDefinition => ({
      id: `${specification.codec}-crf-${crf}`,
      label: `${specification.label} CRF ${crf}`,
      codec: specification.codec,
      encoder,
      crf,
      preset,
      available,
      unavailableReason: available
        ? undefined
        : `${encoder}エンコーダーをこのFFmpegで利用できません。`,
    }));
  });
}

function validRatio(value: string | undefined) {
  return value && /^\d{1,6}:\d{1,6}$/.test(value) && value !== "0:1" ? value : undefined;
}

function sourceTechnicalArgs(probe: VideoOptimizationProbe) {
  const args: string[] = [];
  const pixelFormat = safeEnum(probe.pixelFormat, PIXEL_FORMATS);
  if (pixelFormat) args.push("-pix_fmt", pixelFormat);
  else if (probe.hdr || (probe.bitsPerRawSample ?? 0) >= 10) {
    args.push("-pix_fmt", "yuv420p10le");
  }
  const primaries = safeEnum(probe.colorPrimaries, COLOR_PRIMARIES);
  const transfer = safeEnum(probe.colorTransfer, COLOR_TRANSFERS);
  const space = safeEnum(probe.colorSpace, COLOR_SPACES);
  const range = safeEnum(probe.colorRange, COLOR_RANGES);
  if (primaries) args.push("-color_primaries", primaries);
  if (transfer) args.push("-color_trc", transfer);
  if (space) args.push("-colorspace", space);
  if (range) args.push("-color_range", range);
  const aspect = validRatio(probe.displayAspectRatio);
  if (aspect) args.push("-aspect:v:0", aspect);
  if (
    probe.rotation !== undefined &&
    Number.isFinite(probe.rotation) &&
    Math.abs(probe.rotation) <= 360
  ) {
    args.push("-metadata:s:v:0", `rotate=${Number(probe.rotation.toFixed(3))}`);
  }
  return args;
}

export function buildVideoQualityCandidateArgs(
  inputPath: string,
  outputPath: string,
  definition: QualityCandidateDefinition,
  probe: VideoOptimizationProbe,
  selection: VideoStreamSelectionOptions,
) {
  const args = [
    ...baseInputArgs(inputPath),
    ...streamMapArgs(selection),
    "-c",
    "copy",
    "-c:v:0",
    definition.encoder,
    "-crf",
    String(definition.crf),
    "-fps_mode:v:0",
    "passthrough",
    ...sourceTechnicalArgs(probe),
  ];
  if (definition.encoder === "libx264" || definition.encoder === "libx265") {
    args.push("-preset", definition.preset);
  } else if (definition.encoder === "libaom-av1") {
    args.push(
      "-b:v",
      "0",
      "-cpu-used",
      definition.preset === "medium" ? "4" : definition.preset === "slow" ? "2" : "1",
    );
  } else {
    args.push(
      "-preset",
      definition.preset === "medium" ? "8" : definition.preset === "slow" ? "6" : "4",
    );
  }
  args.push(
    "-c:a",
    "copy",
    ...selectionMetadataArgs(selection),
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  );
  return args;
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

export function parseVmafJson(
  contents: string,
  minimumFrameThreshold: number,
  fps: number | null,
): VmafAssessment {
  const parsed = JSON.parse(contents) as {
    frames?: Array<{ frameNum?: number; metrics?: { vmaf?: number } }>;
    pooled_metrics?: { vmaf?: { mean?: number; min?: number } };
  };
  const frames = (parsed.frames ?? [])
    .map((frame, index) => ({
      frame: finiteNumber(frame.frameNum) ?? index,
      score: finiteNumber(frame.metrics?.vmaf),
    }))
    .filter(
      (frame): frame is { frame: number; score: number } => frame.score !== undefined,
    );
  const pooledMean = finiteNumber(parsed.pooled_metrics?.vmaf?.mean);
  const pooledMin = finiteNumber(parsed.pooled_metrics?.vmaf?.min);
  const mean =
    pooledMean ??
    (frames.length
      ? frames.reduce((sum, frame) => sum + frame.score, 0) / frames.length
      : undefined);
  const min =
    pooledMin ??
    (frames.length ? Math.min(...frames.map((frame) => frame.score)) : undefined);
  if (mean === undefined || min === undefined) {
    throw new AppError("VMAF結果に品質スコアがありません。", 422, "VMAF_RESULT_INVALID");
  }
  const effectiveFps = fps && fps > 0 ? fps : 1;
  const lowFrames = frames.filter((frame) => frame.score < minimumFrameThreshold);
  const segments: QualitySegment[] = [];
  for (const frame of lowFrames) {
    const previous = segments.at(-1);
    const start = frame.frame / effectiveFps;
    const end = (frame.frame + 1) / effectiveFps;
    if (previous && Math.abs(previous.endSeconds - start) < 1 / effectiveFps / 2) {
      previous.endSeconds = rounded(end);
      previous.score = rounded(Math.min(previous.score, frame.score));
    } else {
      segments.push({
        startSeconds: rounded(start),
        endSeconds: rounded(end),
        score: rounded(frame.score),
      });
    }
  }
  return { mean: rounded(mean), min: rounded(min), lowQualitySegments: segments };
}

function buildVmafArgs(originalPath: string, candidatePath: string, logFileName: string) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-protocol_whitelist",
    LOCAL_PROTOCOLS,
    "-i",
    candidatePath,
    "-i",
    originalPath,
    "-lavfi",
    `[0:v:0]setpts=PTS-STARTPTS[dist];[1:v:0]setpts=PTS-STARTPTS[ref];[dist][ref]libvmaf=log_fmt=json:log_path=${logFileName}`,
    "-an",
    "-sn",
    "-f",
    "null",
    "-",
  ];
}

function streamHashArgs(inputPath: string, options: VideoStreamSelectionOptions) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-protocol_whitelist",
    LOCAL_PROTOCOLS,
    "-i",
    inputPath,
    "-map",
    options.removeAttachments ? "0:V?" : "0:v?",
    "-map",
    options.keepPrimaryAudioOnly ? "0:a:0?" : "0:a?",
    "-c",
    "copy",
    "-f",
    "streamhash",
    "-hash",
    "SHA256",
    "pipe:1",
  ];
}

function normalizeStreamHash(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .sort()
    .join("\n");
}

async function safeUnlink(path: string) {
  await unlink(path).catch(() => undefined);
}

function originalReport(probe: VideoOptimizationProbe): OptimizationCandidateReport {
  return {
    id: "original",
    label: "元ファイル",
    method: "元ファイルを保持",
    format: probe.formatName,
    codec: probe.videoCodec,
    size: probe.size,
    status: "qualified",
    losslessVerified: true,
    verificationMethod: "入力ファイルを変更しない",
    reason: "再エンコードしていない元ファイルです。",
  };
}

function reductionPercent(originalSize: number, outputSize: number) {
  return originalSize > 0
    ? Number((((originalSize - outputSize) / originalSize) * 100).toFixed(1))
    : 0;
}

function originalDecision(
  mode: OptimizeVideoQualityOptions["mode"],
  probe: VideoOptimizationProbe,
  candidates: OptimizationCandidateReport[],
  reason: string,
): { selectedOutputPath: string; report: OptimizationReport } {
  const original = candidates.find((candidate) => candidate.id === "original");
  if (original) original.status = "selected";
  return {
    selectedOutputPath: "",
    report: {
      mode,
      originalSize: probe.size,
      outputSize: probe.size,
      reductionPercent: 0,
      selectedCandidateId: "original",
      selectedMethod: "元ファイルを保持",
      selectedFormat: probe.formatName,
      selectedCodec: probe.videoCodec,
      keptOriginal: true,
      decisionReason: reason,
      losslessVerification: {
        status: "passed",
        method: "入力ファイルを変更しない",
        details: "元ファイルをそのまま採用しました。",
      },
      candidates,
    },
  };
}

export async function detectVideoOptimizationCapabilities(): Promise<VideoOptimizationCapabilities> {
  const capabilities = await getRuntimeCapabilities();
  return {
    ffmpegAvailable: capabilities.ffmpeg.available,
    encoders: capabilities.ffmpeg.encoders,
    filters: capabilities.ffmpeg.filters,
    muxers: capabilities.ffmpeg.muxers,
  };
}

function strictOutputExtension(inputPath: string, formatName?: string) {
  const extension = extname(inputPath).toLowerCase();
  if (
    new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".ts", ".m2ts", ".ogv"]).has(
      extension,
    )
  ) {
    return extension;
  }
  const formats = new Set(
    (formatName ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  );
  if (formats.has("webm")) return ".webm";
  if (formats.has("matroska")) return ".mkv";
  if (formats.has("mov") || formats.has("mp4")) return ".mp4";
  if (formats.has("avi")) return ".avi";
  if (formats.has("mpegts")) return ".ts";
  if (formats.has("ogg")) return ".ogv";
  return ".mkv";
}

async function strictLosslessOptimization(
  options: OptimizeVideoQualityOptions,
  probe: VideoOptimizationProbe,
  runner: OptimizationCommandRunner,
  ffmpegExecutable: string,
) {
  const outputPath = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `strict-lossless${strictOutputExtension(options.inputPath, probe.formatName)}`,
  );
  let inputHash: { stdout: string; stderr: string };
  let outputHash: { stdout: string; stderr: string };
  try {
    options.onProgress?.("無劣化ストリームをコピー中");
    await runner(
      ffmpegExecutable,
      buildStrictLosslessCopyArgs(options.inputPath, outputPath, options.streamSelection),
      { timeoutMs: ENCODE_TIMEOUT_MS, signal: options.signal },
    );
    options.onProgress?.("ストリームハッシュを検証中");
    [inputHash, outputHash] = await Promise.all([
      runner(
        ffmpegExecutable,
        streamHashArgs(options.inputPath, options.streamSelection),
        {
          timeoutMs: ENCODE_TIMEOUT_MS,
          signal: options.signal,
        },
      ),
      runner(ffmpegExecutable, streamHashArgs(outputPath, options.streamSelection), {
        timeoutMs: ENCODE_TIMEOUT_MS,
        signal: options.signal,
      }),
    ]);
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  }
  const verified =
    normalizeStreamHash(inputHash.stdout).length > 0 &&
    normalizeStreamHash(inputHash.stdout) === normalizeStreamHash(outputHash.stdout);
  if (!verified) {
    await safeUnlink(outputPath);
    const original = originalReport(probe);
    const rejected: OptimizationCandidateReport = {
      id: "strict-lossless-copy",
      label: "無劣化ストリームコピー",
      method: "FFmpeg -c copy",
      format: strictOutputExtension(options.inputPath, probe.formatName).slice(1),
      codec: probe.videoCodec,
      size: null,
      status: "rejected",
      losslessVerified: false,
      verificationMethod: "FFmpeg streamhash SHA-256",
      reason: "保持対象ストリームのハッシュが一致しないため採用しませんでした。",
    };
    const decision = originalDecision(
      "strict-lossless",
      probe,
      [original, rejected],
      "無劣化検証に合格しなかったため元ファイルを保持しました。",
    );
    decision.selectedOutputPath = options.inputPath;
    decision.report.losslessVerification = {
      status: "failed",
      method: "FFmpeg streamhash SHA-256",
      details: rejected.reason,
    };
    return decision;
  }
  const outputSize = (await stat(outputPath)).size;
  const removalPreview = previewVideoStreamRemovals(probe, options.streamSelection);
  const selected: OptimizationCandidateReport = {
    id: "strict-lossless-copy",
    label: "無劣化ストリームコピー",
    method: "FFmpeg -c copy",
    format: strictOutputExtension(options.inputPath, probe.formatName).slice(1),
    codec: probe.videoCodec,
    size: outputSize,
    status: "selected",
    losslessVerified: true,
    verificationMethod: "FFmpeg streamhash SHA-256",
    reason: "保持対象の映像・音声ストリームが入力と一致しました。",
  };
  if (outputSize > probe.size && !removalPreview.willRemove) {
    selected.status = "qualified";
    selected.reason =
      "無劣化検証には合格しましたが、元ファイルはすでに削除条件を満たし、出力容量が増えるため採用しませんでした。";
    await safeUnlink(outputPath);
    const decision = originalDecision(
      "strict-lossless",
      probe,
      [originalReport(probe), selected],
      "元ファイルは指定条件を満たしており、無劣化コピー後の容量が増えるため元ファイルを採用しました。",
    );
    decision.selectedOutputPath = options.inputPath;
    return decision;
  }
  const prioritizedRemoval = outputSize > probe.size && removalPreview.willRemove;
  return {
    selectedOutputPath: outputPath,
    report: {
      mode: "strict-lossless" as const,
      originalSize: probe.size,
      outputSize,
      reductionPercent: reductionPercent(probe.size, outputSize),
      selectedCandidateId: selected.id,
      selectedMethod: selected.method,
      selectedFormat: selected.format ?? probe.formatName,
      selectedCodec: probe.videoCodec,
      keptOriginal: false,
      decisionReason: prioritizedRemoval
        ? "出力容量は増えましたが、指定された不要ストリームまたはプライバシーメタデータの削除を容量より優先しました。"
        : "再エンコードせず、指定された不要ストリームとメタデータだけを削除しました。",
      losslessVerification: {
        status: "passed" as const,
        method: "FFmpeg streamhash SHA-256",
        details: "保持対象の圧縮済み映像・音声ストリームが一致しました。",
      },
      candidates: [originalReport(probe), selected],
    },
  };
}

export async function optimizeVideoQuality(
  options: OptimizeVideoQualityOptions,
): Promise<{
  selectedOutputPath: string;
  report: OptimizationReport;
}> {
  const runner = options.runner ?? defaultOptimizationCommandRunner;
  const ffmpegExecutable =
    options.ffmpegExecutable ?? process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!ffmpegExecutable) {
    throw new AppError("FFmpegを利用できません。", 503, "FFMPEG_UNAVAILABLE");
  }
  let probe = options.probe;
  if (!probe) {
    options.onProgress?.("動画情報を解析中");
    probe = await probeVideoForOptimization(
      options.inputPath,
      options.ffprobeExecutable,
      runner,
      options.signal,
    );
  }
  if (options.mode === "strict-lossless") {
    return strictLosslessOptimization(options, probe, runner, ffmpegExecutable);
  }

  let capabilities = options.capabilities;
  if (!capabilities) {
    options.onProgress?.("実行環境の動画処理能力を確認中");
    capabilities = await detectVideoOptimizationCapabilities();
  }
  const definitions = buildVideoQualityCandidates(options.qualitySearch, capabilities);
  const reports: OptimizationCandidateReport[] = [originalReport(probe)];
  const generatedPaths = new Map<string, string>();
  const vmafAvailable =
    capabilities.ffmpegAvailable && capabilities.filters.includes("libvmaf");
  const matroskaAvailable = capabilities.muxers.includes("matroska");

  for (const definition of definitions) {
    const unavailableReason = !vmafAvailable
      ? "libvmafフィルターをこのFFmpegで利用できないため、高画質を検証できません。"
      : !matroskaAvailable
        ? "Matroska muxerを利用できないため、安全な候補コンテナを生成できません。"
        : definition.unavailableReason;
    if (unavailableReason) {
      const report: OptimizationCandidateReport = {
        id: definition.id,
        label: definition.label,
        method: `${definition.encoder} CRF ${definition.crf}`,
        format: "MKV",
        codec: definition.codec.toUpperCase(),
        size: null,
        status: "unavailable",
        reason: unavailableReason,
      };
      reports.push(report);
      options.onCandidate?.(report);
      continue;
    }

    const candidatePath = join(
      /*turbopackIgnore: true*/ options.outputDirectory,
      `${definition.id}.mkv`,
    );
    const vmafFileName = `${definition.id}-vmaf.json`;
    const vmafPath = join(
      /*turbopackIgnore: true*/ options.outputDirectory,
      vmafFileName,
    );
    try {
      options.onProgress?.(`${definition.label}をエンコード中`);
      await runner(
        ffmpegExecutable,
        buildVideoQualityCandidateArgs(
          options.inputPath,
          candidatePath,
          definition,
          probe,
          options.streamSelection,
        ),
        { timeoutMs: ENCODE_TIMEOUT_MS, signal: options.signal },
      );
      const size = (await stat(candidatePath)).size;
      generatedPaths.set(definition.id, candidatePath);
      options.onProgress?.(`${definition.label}のVMAFを検証中`);
      await runner(
        ffmpegExecutable,
        buildVmafArgs(options.inputPath, candidatePath, vmafFileName),
        {
          cwd: options.outputDirectory,
          timeoutMs: ENCODE_TIMEOUT_MS,
          signal: options.signal,
        },
      );
      const assessment = parseVmafJson(
        await readFile(vmafPath, "utf8"),
        options.qualitySearch.minimumFrameThreshold,
        probe.fps,
      );
      const qualifies =
        assessment.mean >= options.qualitySearch.vmafThreshold &&
        assessment.min >= options.qualitySearch.minimumFrameThreshold;
      const report: OptimizationCandidateReport = {
        id: definition.id,
        label: definition.label,
        method: `${definition.encoder} CRF ${definition.crf} / ${definition.preset}`,
        format: "MKV",
        codec: definition.codec.toUpperCase(),
        size,
        status: qualifies ? "qualified" : "rejected",
        vmafMean: assessment.mean,
        vmafMin: assessment.min,
        lowQualitySegments: assessment.lowQualitySegments,
        reason: qualifies
          ? "VMAFの平均値と最低フレーム値が高画質基準を満たしました。"
          : "VMAFの平均値または最低フレーム値が高画質基準を下回りました。",
      };
      reports.push(report);
      options.onCandidate?.(report);
    } catch (error) {
      const report: OptimizationCandidateReport = {
        id: definition.id,
        label: definition.label,
        method: `${definition.encoder} CRF ${definition.crf}`,
        format: "MKV",
        codec: definition.codec.toUpperCase(),
        size: null,
        status: "unavailable",
        reason:
          error instanceof AppError && error.code === "CANCELLED"
            ? "処理がキャンセルされました。"
            : "候補の生成またはVMAF検証に失敗したため採用できません。",
      };
      reports.push(report);
      options.onCandidate?.(report);
      await safeUnlink(candidatePath);
      generatedPaths.delete(definition.id);
      if (error instanceof AppError && error.code === "CANCELLED") {
        for (const path of generatedPaths.values()) await safeUnlink(path);
        throw error;
      }
    } finally {
      await safeUnlink(vmafPath);
    }
  }

  const qualified = reports
    .filter(
      (report) =>
        report.status === "qualified" &&
        report.size !== null &&
        report.size < probe.size &&
        generatedPaths.has(report.id),
    )
    .sort((left, right) => (left.size ?? Infinity) - (right.size ?? Infinity));
  const selected = qualified[0];
  if (!selected) {
    for (const path of generatedPaths.values()) await safeUnlink(path);
    const reason = vmafAvailable
      ? "高画質基準を満たし、かつ元ファイルより小さい候補がないため元ファイルを採用しました。"
      : "VMAFを利用できず画質を検証できないため、虚偽の高画質表示をせず元ファイルを採用しました。";
    const decision = originalDecision(
      "high-quality-optimization",
      probe,
      reports,
      reason,
    );
    decision.selectedOutputPath = options.inputPath;
    return decision;
  }

  selected.status = "selected";
  for (const [id, path] of generatedPaths) {
    if (id !== selected.id) await safeUnlink(path);
  }
  const selectedPath = generatedPaths.get(selected.id)!;
  const assessment = {
    label: "高画質基準を満たした候補" as const,
    threshold: options.qualitySearch.vmafThreshold,
    minimumFrameThreshold: options.qualitySearch.minimumFrameThreshold,
    vmafMean: selected.vmafMean!,
    vmafMin: selected.vmafMin!,
    lowQualitySegments: selected.lowQualitySegments ?? [],
  };
  return {
    selectedOutputPath: selectedPath,
    report: {
      mode: "high-quality-optimization",
      originalSize: probe.size,
      outputSize: selected.size!,
      reductionPercent: reductionPercent(probe.size, selected.size!),
      selectedCandidateId: selected.id,
      selectedMethod: selected.method,
      selectedFormat: selected.format ?? "MKV",
      selectedCodec: selected.codec,
      keptOriginal: false,
      decisionReason:
        "VMAF高画質基準を満たした候補のうち、容量が最小の候補を採用しました。",
      losslessVerification: {
        status: "not-applicable",
        method: "VMAF品質評価",
        details: "再エンコード候補のため完全無劣化ではありません。",
      },
      qualityAssessment: assessment,
      candidates: reports,
    },
  };
}

export const optimizeAdvancedVideo = optimizeVideoQuality;
