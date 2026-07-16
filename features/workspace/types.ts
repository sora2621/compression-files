import type { ProcessingLogEntry } from "@/components/progress/types";
import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type { ImageEncoding, ProcessingMode } from "@/lib/media/image-types";
import type {
  AudioMediaInfo,
  MediaProbeInfo,
  VideoCompressionOptions,
  VideoMediaInfo,
} from "@/lib/media/video-types";
import type { OptimizationReport } from "@/lib/optimization/types";
import type { ProgressEvent } from "@/lib/progress/types";
import type { TargetSizeResult } from "@/lib/target-size/types";

export type MediaKind = "image" | "video" | "audio";

export type ItemStatus = "queued" | "processing" | "complete" | "error" | "cancelled";

export interface MetadataField {
  group: "EXIF" | "GPS" | "XMP" | "IPTC";
  key: string;
  value: string;
}

export interface ProcessResult {
  jobId: string;
  kind: MediaKind;
  originalName: string;
  outputName: string;
  originalSize: number;
  outputSize: number;
  savedBytes: number;
  reductionPercent: number;
  outputMime: string;
  outputFormat: string;
  encoding: ImageEncoding | null;
  quality: number | null;
  warnings: string[];
  downloadUrl: string;
  previewUrl: string | null;
  previewUrls?: { before: string; after: string } | null;
  metadata: {
    detected: boolean;
    types: string[];
    fields: MetadataField[];
  };
  metadataAfter?: {
    detected: boolean;
    types: string[];
    fields: MetadataField[];
  };
  removedMetadataTypes: string[];
  expiresInMinutes: number;
  processing: "stream-copy" | "ffmpeg" | "sharp" | "real-esrgan";
  optimizationReport?: OptimizationReport;
  targetSizeResult?: TargetSizeResult;
  image?: {
    before: {
      format: string;
      width: number | null;
      height: number | null;
      pages: number;
    };
    after: {
      format: string;
      width: number | null;
      height: number | null;
      pages: number;
    };
    processingMode: ProcessingMode;
  };
  video?: {
    before: VideoMediaInfo;
    after: VideoMediaInfo;
    options: VideoCompressionOptions;
    crf: number | null;
  };
  audio?: {
    before: AudioMediaInfo;
    after: AudioMediaInfo;
    options: AudioProcessingOptions;
  };
}

export interface QueueItem {
  id: string;
  file: File;
  kind: "unknown" | MediaKind;
  originalPreview: string | null;
  hasTransparency: boolean | null;
  uploadId?: string;
  videoInfo?: VideoMediaInfo;
  audioInfo?: AudioMediaInfo;
  probeInfo?: MediaProbeInfo;
  detectedFormat?: string;
  /** Optional per-file override. Values are validated against the media-category whitelist. */
  outputFormat?: string;
  recommendations?: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  inspectionStatus?: "uploading" | "ready" | "error";
  inspectionError?: string;
  progress?: number;
  progressStage?: string;
  progressEvent?: ProgressEvent;
  activeJobId?: string;
  originalSize?: number;
  startedAt?: number;
  finishedAt?: number;
  logs?: ProcessingLogEntry[];
  recovered?: boolean;
  status: ItemStatus;
  result?: ProcessResult;
  error?: string;
  errorCode?: string;
}

export interface StoredActiveJob {
  itemId: string;
  jobId: string;
  fileName: string;
  kind: MediaKind;
  originalSize: number;
  detectedFormat?: string;
  startedAt: number;
}
