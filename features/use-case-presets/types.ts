import type { AudioProcessingOptions } from "@/lib/media/audio-types";
import type {
  ImageEncoding,
  ImageOutputFormat,
  ProcessingMode,
} from "@/lib/media/image-types";
import type { VideoCompressionOptions } from "@/lib/media/video-types";
import type { ProcessingSpeedPreset } from "@/lib/processing/types";
import type { TargetSizeOptions } from "@/lib/target-size/types";

export type UseCaseId =
  | "web"
  | "email"
  | "social"
  | "smartphone"
  | "print"
  | "archive"
  | "presentation"
  | "custom";

export interface UseCasePresetDefinition {
  id: Exclude<UseCaseId, "custom">;
  label: string;
  description: string;
  optimization: string;
  reductionRange: readonly [number, number];
  secondsPerMb: number;
  image: {
    photoFormat: ImageOutputFormat;
    transparentFormat: ImageOutputFormat;
    quality: number;
    encoding: ImageEncoding;
    maxLongEdge: number | null;
    removeMetadata: boolean;
  };
  video: Pick<
    VideoCompressionOptions,
    "outputContainer" | "codec" | "quality" | "resolution" | "audio" | "removeMetadata"
  >;
  audio: Pick<AudioProcessingOptions, "outputFormat" | "quality" | "removeMetadata">;
  targetMegabytes: {
    image: number | null;
    multipleImages: number | null;
    mediaTotal: number | null;
  };
  processingMode: ProcessingMode;
  speedPreset: ProcessingSpeedPreset;
}

export interface AnalyzedFile {
  file: File;
  kind: "image" | "video" | "audio" | "unknown";
  width: number | null;
  height: number | null;
  duration: number | null;
  hasTransparency: boolean | null;
}

export interface FileAnalysisSummary {
  files: AnalyzedFile[];
  totalBytes: number;
  kinds: Array<"image" | "video" | "audio">;
  maxLongEdge: number | null;
  maxDuration: number | null;
  hasTransparency: boolean;
}

export interface CompressionInitialSettings {
  processingMode: ProcessingMode;
  imageFormat: ImageOutputFormat;
  imageEncoding: ImageEncoding;
  imageQuality: number;
  imageMaxDimension: number | null;
  speedPreset: ProcessingSpeedPreset;
  videoOptions: Partial<VideoCompressionOptions>;
  audioOptions: Partial<AudioProcessingOptions>;
  targetSizeOptions: Partial<TargetSizeOptions>;
}

export interface ResolvedUseCasePreset {
  id: UseCaseId;
  label: string;
  description: string;
  optimization: string;
  estimatedReductionPercent: number;
  estimatedOutputBytes: number;
  estimatedSeconds: number;
  settings: CompressionInitialSettings;
  summaryRows: Array<{ label: string; value: string }>;
  reasons: string[];
}
