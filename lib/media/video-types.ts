export const VIDEO_RESOLUTIONS = [
  "original",
  "2160",
  "1440",
  "1080",
  "720",
  "480",
  "custom",
] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_CODECS = ["h264", "h265", "vp9", "av1"] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];

export const VIDEO_QUALITIES = ["high", "balanced", "small"] as const;
export type VideoQuality = (typeof VIDEO_QUALITIES)[number];

export const VIDEO_AUDIO_OPTIONS = [
  "copy",
  "aac128",
  "aac96",
  "opus128",
  "opus96",
  "vorbis128",
  "flac",
  "pcm",
] as const;
export type VideoAudioOption = (typeof VIDEO_AUDIO_OPTIONS)[number];

export const VIDEO_OUTPUT_CONTAINERS = ["source", "mp4", "webm", "mkv", "mov"] as const;
export type VideoOutputContainer = (typeof VIDEO_OUTPUT_CONTAINERS)[number];

export const VIDEO_DENOISE_FILTERS = ["none", "hqdn3d", "nlmeans"] as const;
export type VideoDenoiseFilter = (typeof VIDEO_DENOISE_FILTERS)[number];

export const VIDEO_SHARPEN_FILTERS = ["none", "unsharp", "cas"] as const;
export type VideoSharpenFilter = (typeof VIDEO_SHARPEN_FILTERS)[number];

export interface VideoEnhancementOptions {
  denoise: VideoDenoiseFilter;
  sharpen: VideoSharpenFilter;
  /** FFmpeg eq brightness. Valid range: -1.0 to 1.0. */
  brightness: number;
  /** FFmpeg eq contrast. The UI intentionally uses a conservative range. */
  contrast: number;
  /** FFmpeg eq saturation. 0 is grayscale, 1 is unchanged. */
  saturation: number;
  /** Convert the working/output colour space to BT.709. */
  colorCorrection: boolean;
}

export interface VideoAiOptions {
  scale: 2 | 4;
  model: "photo" | "anime";
  removeCompressionNoise: boolean;
  strength: "weak" | "standard" | "strong";
}

export type VideoCompressionMode = "copy" | "compress";
export type VideoFrameRate = "original" | "24" | "30" | "60";

export interface VideoCompressionOptions {
  mode: VideoCompressionMode;
  resolution: VideoResolution;
  customHeight: number | null;
  codec: VideoCodec;
  quality: VideoQuality;
  audio: VideoAudioOption;
  removeMetadata: boolean;
  /** Optional for backwards compatibility with stored jobs from the original MVP. */
  outputContainer?: VideoOutputContainer;
  /** Optional for backwards compatibility; omitted values mean no enhancement. */
  enhancements?: VideoEnhancementOptions;
  /** Selects Lanczos interpolation or optional frame-by-frame Real-ESRGAN. */
  upscaleMode?: "simple" | "ai";
  ai?: VideoAiOptions;
  /** Optional for backwards compatibility; omitted values preserve the source FPS. */
  frameRate?: VideoFrameRate;
  /** Processing speed only changes encoder effort/preset; CRF and quality floors stay intact. */
  speedPreset?: import("@/lib/processing/types").ProcessingSpeedPreset;
}

export interface VideoMediaInfo {
  formatName: string;
  width: number;
  height: number;
  duration: number;
  bitrate: number | null;
  chapterCount?: number;
  fps: number | null;
  videoCodec: string;
  audioCodec: string | null;
  audioBitrate: number | null;
  audioTrackCount?: number;
}

export interface AudioMediaInfo {
  formatName: string;
  duration: number;
  bitrate: number | null;
  audioCodec: string;
  audioBitrate: number | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface MediaStreamSummary {
  index: number;
  type: "video" | "audio" | "subtitle" | "attachment" | "data" | "unknown";
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isAttachedPicture: boolean;
  tags?: Record<string, string>;
}

export interface MediaProbeInfo {
  kind: "video" | "audio";
  formatName: string;
  duration: number;
  bitrate: number | null;
  chapterCount: number;
  video: {
    width: number;
    height: number;
    codec: string;
    bitrate: number | null;
    fps: number | null;
    pixelFormat?: string;
    bitsPerRawSample?: number;
    colorPrimaries?: string;
    colorTransfer?: string;
    colorSpace?: string;
    colorRange?: string;
    sampleAspectRatio?: string;
    displayAspectRatio?: string;
    rotation?: number;
    hdr?: boolean;
  } | null;
  audio: {
    codec: string;
    bitrate: number | null;
    sampleRate: number | null;
    channels: number | null;
  } | null;
  streams: MediaStreamSummary[];
  audioTrackCount: number;
  formatTags?: Record<string, string>;
}

export const DEFAULT_VIDEO_COMPRESSION_OPTIONS: VideoCompressionOptions = {
  mode: "copy",
  resolution: "original",
  customHeight: null,
  codec: "h264",
  quality: "balanced",
  audio: "copy",
  removeMetadata: true,
  outputContainer: "source",
  enhancements: {
    denoise: "none",
    sharpen: "none",
    brightness: 0,
    contrast: 1,
    saturation: 1,
    colorCorrection: false,
  },
  upscaleMode: "simple",
  ai: {
    scale: 2,
    model: "photo",
    removeCompressionNoise: false,
    strength: "standard",
  },
  frameRate: "original",
  speedPreset: "balanced",
};

export const DEFAULT_VIDEO_ENHANCEMENTS: VideoEnhancementOptions = {
  denoise: "none",
  sharpen: "none",
  brightness: 0,
  contrast: 1,
  saturation: 1,
  colorCorrection: false,
};

export const CRF_MAP: Record<VideoCodec, Record<VideoQuality, number>> = {
  h264: { high: 18, balanced: 23, small: 28 },
  h265: { high: 22, balanced: 26, small: 30 },
  vp9: { high: 24, balanced: 31, small: 38 },
  av1: { high: 24, balanced: 30, small: 36 },
};

function finiteInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function isVideoEnhancementOptions(
  value: unknown,
): value is VideoEnhancementOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<VideoEnhancementOptions>;
  return (
    VIDEO_DENOISE_FILTERS.includes(options.denoise as VideoDenoiseFilter) &&
    VIDEO_SHARPEN_FILTERS.includes(options.sharpen as VideoSharpenFilter) &&
    finiteInRange(options.brightness, -1, 1) &&
    finiteInRange(options.contrast, 0.5, 2) &&
    finiteInRange(options.saturation, 0, 3) &&
    (options.colorCorrection === undefined ||
      typeof options.colorCorrection === "boolean")
  );
}

export function isVideoAiOptions(value: unknown): value is VideoAiOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<VideoAiOptions>;
  return (
    (options.scale === 2 || options.scale === 4) &&
    (options.model === "photo" || options.model === "anime") &&
    typeof options.removeCompressionNoise === "boolean" &&
    (options.strength === "weak" ||
      options.strength === "standard" ||
      options.strength === "strong")
  );
}

export function normalizeVideoEnhancements(
  value: VideoEnhancementOptions | undefined,
): VideoEnhancementOptions {
  return value && isVideoEnhancementOptions(value)
    ? { ...DEFAULT_VIDEO_ENHANCEMENTS, ...value }
    : DEFAULT_VIDEO_ENHANCEMENTS;
}

export function videoEnhancementsRequireReencode(
  value: VideoEnhancementOptions | undefined,
) {
  const options = normalizeVideoEnhancements(value);
  return (
    options.denoise !== "none" ||
    options.sharpen !== "none" ||
    options.brightness !== 0 ||
    options.contrast !== 1 ||
    options.saturation !== 1 ||
    options.colorCorrection
  );
}

export function selectedVideoHeight(options: VideoCompressionOptions) {
  if (options.resolution === "original") return null;
  if (options.resolution === "custom") return options.customHeight;
  return Number(options.resolution);
}

export function canCopyAudioCodecToContainer(
  codec: string | null,
  container: VideoOutputContainer | undefined,
) {
  if (codec === null || !container || container === "source" || container === "mkv") {
    return true;
  }
  const normalized = codec.toLowerCase();
  if (container === "webm") return normalized === "opus" || normalized === "vorbis";
  if (container === "mp4") return normalized === "aac";
  return normalized === "aac" || normalized.startsWith("pcm_");
}

export function canCopyVideoCodecToContainer(
  codec: string,
  container: VideoOutputContainer | undefined,
) {
  if (!container || container === "source" || container === "mkv") return true;
  const normalized = codec.toLowerCase();
  if (container === "webm") {
    return normalized === "vp8" || normalized === "vp9" || normalized === "av1";
  }
  if (container === "mp4") {
    return ["h264", "hevc", "h265", "av1"].includes(normalized);
  }
  return normalized === "h264" || normalized === "hevc" || normalized === "h265";
}

export function isVideoCompressionOptions(
  value: unknown,
): value is VideoCompressionOptions {
  if (!value || typeof value !== "object") return false;
  const options = value as Partial<VideoCompressionOptions>;
  return (
    (options.mode === "copy" || options.mode === "compress") &&
    VIDEO_RESOLUTIONS.includes(options.resolution as VideoResolution) &&
    VIDEO_CODECS.includes(options.codec as VideoCodec) &&
    VIDEO_QUALITIES.includes(options.quality as VideoQuality) &&
    VIDEO_AUDIO_OPTIONS.includes(options.audio as VideoAudioOption) &&
    typeof options.removeMetadata === "boolean" &&
    (options.outputContainer === undefined ||
      VIDEO_OUTPUT_CONTAINERS.includes(
        options.outputContainer as VideoOutputContainer,
      )) &&
    (options.enhancements === undefined ||
      isVideoEnhancementOptions(options.enhancements)) &&
    (options.upscaleMode === undefined ||
      options.upscaleMode === "simple" ||
      options.upscaleMode === "ai") &&
    (options.ai === undefined || isVideoAiOptions(options.ai)) &&
    (options.frameRate === undefined ||
      ["original", "24", "30", "60"].includes(options.frameRate)) &&
    (options.speedPreset === undefined ||
      ["fast", "balanced", "maximum-compression"].includes(options.speedPreset)) &&
    (options.customHeight === null ||
      (Number.isInteger(options.customHeight) &&
        Number(options.customHeight) >= 144 &&
        Number(options.customHeight) <= 4320 &&
        Number(options.customHeight) % 2 === 0))
  );
}
