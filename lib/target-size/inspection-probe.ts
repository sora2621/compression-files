import type { MediaProbeInfo } from "@/lib/media/video-types";
import type { TargetMediaProbe } from "@/lib/target-size/video-target";

/** Reuses the single ffprobe result stored by the upload inspection stage. */
export function targetProbeFromInspection(
  source: MediaProbeInfo,
  size: number,
): TargetMediaProbe {
  return {
    kind: source.kind,
    duration: source.duration,
    size,
    formatName: source.formatName,
    totalBitrateKbps:
      source.bitrate === null ? null : Math.max(1, Math.round(source.bitrate / 1_000)),
    videoBitrateKbps:
      source.video?.bitrate === null || source.video?.bitrate === undefined
        ? null
        : Math.max(1, Math.round(source.video.bitrate / 1_000)),
    audioBitrateKbps:
      source.audio?.bitrate === null || source.audio?.bitrate === undefined
        ? null
        : Math.max(1, Math.round(source.audio.bitrate / 1_000)),
    width: source.video?.width ?? null,
    height: source.video?.height ?? null,
    fps: source.video?.fps ?? null,
    videoCodec: source.video?.codec ?? null,
    audioCodecs: source.streams
      .filter((stream) => stream.type === "audio")
      .map((stream) => stream.codec),
    audioTrackCount: source.audioTrackCount,
  };
}
