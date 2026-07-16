import { tmpdir } from "node:os";
import { join } from "node:path";

const MB = 1024 * 1024;

export const MAX_IMAGE_BYTES = 25 * MB;
export const MAX_VIDEO_BYTES = 250 * MB;
export const MAX_AUDIO_BYTES = 100 * MB;
export const MAX_REQUEST_BYTES = MAX_VIDEO_BYTES + 2 * MB;
export const MAX_FILES_PER_BATCH = 10;
export const FILE_TTL_MS = 30 * 60 * 1000;
export const MAX_IMAGE_INPUT_PIXELS = 40_000_000;
export const MAX_IMAGE_OUTPUT_PIXELS = 80_000_000;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_ANIMATION_FRAMES = 120;
export const MAX_ANIMATION_TOTAL_PIXELS = 80_000_000;
export const MAX_SVG_BYTES = 2 * MB;
export const MAX_MEDIA_DURATION_SECONDS = 30 * 60;
export const MAX_VIDEO_WIDTH = 7_680;
export const MAX_VIDEO_HEIGHT = 4_320;
export const MAX_AI_IMAGE_INPUT_PIXELS_CPU = 4_000_000;
export const MAX_AI_IMAGE_INPUT_PIXELS_GPU = 16_000_000;
export const MAX_AI_IMAGE_OUTPUT_PIXELS = 64_000_000;
export const TEMP_ROOT =
  process.env.COMPRESSION_TMP_DIR ??
  join(/*turbopackIgnore: true*/ tmpdir(), "compression-files");

// These MIME collections are display/size-limit hints only. Upload acceptance is
// decided from Sharp metadata and ffprobe stream data, never from the extension or
// browser supplied MIME type alone.
export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/tiff",
  "image/svg+xml",
  "image/heif",
  "image/heic",
]);

export const SUPPORTED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
  "video/mpeg",
  "video/mp2t",
  "video/x-flv",
  "video/x-ms-wmv",
  "video/3gpp",
  "video/ogg",
]);

export const SUPPORTED_AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/aac",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/opus",
  "audio/ogg",
  "audio/x-ms-wma",
  "audio/aiff",
  "audio/x-aiff",
]);
