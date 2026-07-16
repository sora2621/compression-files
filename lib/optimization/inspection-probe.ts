import type { MediaProbeInfo } from "@/lib/media/video-types";
import type { VideoOptimizationProbe } from "@/lib/optimization/video-quality";

/** Adapts the upload-stage ffprobe cache for advanced video optimization. */
export function videoOptimizationProbeFromInspection(
  source: MediaProbeInfo,
  size: number,
): VideoOptimizationProbe | undefined {
  if (source.kind !== "video" || !source.video) return undefined;
  return {
    formatName: source.formatName,
    size,
    duration: source.duration,
    width: source.video.width,
    height: source.video.height,
    fps: source.video.fps,
    videoCodec: source.video.codec,
    pixelFormat: source.video.pixelFormat,
    bitsPerRawSample: source.video.bitsPerRawSample,
    colorPrimaries: source.video.colorPrimaries,
    colorTransfer: source.video.colorTransfer,
    colorSpace: source.video.colorSpace,
    colorRange: source.video.colorRange,
    sampleAspectRatio: source.video.sampleAspectRatio,
    displayAspectRatio: source.video.displayAspectRatio,
    rotation: source.video.rotation,
    hdr: source.video.hdr ?? false,
    streams: source.streams.map((stream) => ({
      index: stream.index,
      codecType: stream.type,
      codecName: stream.codec,
      tags: stream.tags,
      attachedPicture: stream.isAttachedPicture,
    })),
    chapterCount: source.chapterCount,
    formatTags: source.formatTags ?? {},
  };
}
