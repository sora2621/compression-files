"use client";

import { getOutputFormatDefinition } from "@/shared/media/output-formats";

import type { RuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import type { VideoCodec, VideoOutputContainer } from "@/lib/media/video-types";

const VIDEO_CODEC_DETAILS: Record<
  VideoCodec,
  { label: string; description: string; encoder: string }
> = {
  h264: { label: "H.264", description: "互換性重視", encoder: "libx264" },
  h265: { label: "H.265", description: "高圧縮", encoder: "libx265" },
  vp9: { label: "VP9", description: "WebM向け", encoder: "libvpx-vp9" },
  av1: { label: "AV1", description: "高圧縮・処理重め", encoder: "libaom-av1" },
};

interface CodecSelectorProps {
  container: VideoOutputContainer | undefined;
  value: VideoCodec;
  capabilities?: RuntimeCapabilities | null;
  disabled?: boolean;
  onChange: (codec: VideoCodec) => void;
}

export function availableVideoCodecs(
  container: VideoOutputContainer | undefined,
  capabilities?: RuntimeCapabilities | null,
) {
  const definition =
    container && container !== "source" ? getOutputFormatDefinition(container) : null;
  const allowed = definition?.supportedVideoCodecs ?? Object.keys(VIDEO_CODEC_DETAILS);
  return (allowed as VideoCodec[]).filter((codec) => {
    const encoder = VIDEO_CODEC_DETAILS[codec].encoder;
    return capabilities?.ffmpeg.encoders.includes(encoder) ?? true;
  });
}

export function CodecSelector({
  container,
  value,
  capabilities,
  disabled = false,
  onChange,
}: CodecSelectorProps) {
  const codecs = availableVideoCodecs(container, capabilities);
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs font-black text-slate-700">動画コーデック</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {codecs.map((codec) => (
          <label
            key={codec}
            className={`cursor-pointer rounded-xl border p-3 ${
              value === codec ? "border-orange-400 bg-orange-50" : "border-slate-200"
            }`}
          >
            <input
              type="radio"
              name="video-codec"
              value={codec}
              checked={value === codec}
              onChange={() => onChange(codec)}
              className="sr-only"
            />
            <span className="block text-xs font-black text-slate-900">
              {VIDEO_CODEC_DETAILS[codec].label}
            </span>
            <span className="mt-1 block text-[10px] font-medium text-slate-500">
              {VIDEO_CODEC_DETAILS[codec].description}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
