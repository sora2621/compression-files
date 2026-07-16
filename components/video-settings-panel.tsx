"use client";

import { AlertTriangle, Film, Gauge, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import {
  CodecSelector,
  OutputFileNamePreview,
  OutputFormatSelector,
  OutputFormatWarning,
  availableVideoCodecs,
} from "@/components/output-format";
import {
  CRF_MAP,
  DEFAULT_VIDEO_ENHANCEMENTS,
  VIDEO_OUTPUT_CONTAINERS,
  canCopyAudioCodecToContainer,
  selectedVideoHeight,
  type VideoCompressionOptions,
  type VideoMediaInfo,
  type VideoQuality,
} from "@/lib/media/video-types";

import type { RuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";

interface VideoSettingsPanelProps {
  mediaInfos: VideoMediaInfo[];
  options: VideoCompressionOptions;
  disabled: boolean;
  capabilities?: RuntimeCapabilities | null;
  onChange: (update: Partial<VideoCompressionOptions>) => void;
  originalFileName?: string;
}

const resolutions = [
  { value: "original", label: "元のまま", height: null },
  { value: "2160", label: "2160p（4K）", height: 2160 },
  { value: "1440", label: "1440p（2K）", height: 1440 },
  { value: "1080", label: "1080p（Full HD）", height: 1080 },
  { value: "720", label: "720p（HD）", height: 720 },
  { value: "480", label: "480p（SD）", height: 480 },
  { value: "custom", label: "カスタム", height: null },
] as const;

const qualities: Array<{
  id: VideoQuality;
  label: string;
  description: string;
}> = [
  { id: "high", label: "高品質", description: "画質を優先" },
  { id: "balanced", label: "バランス", description: "品質と容量の両立" },
  { id: "small", label: "容量優先", description: "軽さを優先" },
];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatBitrate(bitrate: number | null) {
  if (!bitrate) return "不明";
  return `${(bitrate / 1_000_000).toFixed(2)} Mbps`;
}

function estimatedEffect(options: VideoCompressionOptions, sourceHeight: number) {
  if (options.mode === "copy") return "画質・容量ともほぼ維持";
  const target = selectedVideoHeight(options);
  const ratio = target ? Math.min(1, target / sourceHeight) : 1;
  if (options.quality === "small" || ratio <= 0.55) return "大きめ";
  if (options.quality === "balanced" || ratio < 1) return "中程度";
  return "控えめ";
}

export function VideoSettingsPanel({
  mediaInfos,
  options,
  disabled,
  capabilities,
  originalFileName,
  onChange,
}: VideoSettingsPanelProps) {
  const [codecChangedReason, setCodecChangedReason] = useState<string | null>(null);
  const source = mediaInfos[0] ?? null;
  const minimumHeight = mediaInfos.length
    ? Math.min(...mediaInfos.map((info) => info.height))
    : 0;
  const targetHeight = selectedVideoHeight(options);
  const enhancements = options.enhancements ?? DEFAULT_VIDEO_ENHANCEMENTS;
  const videoAi = options.ai ?? {
    scale: 2 as const,
    model: "photo" as const,
    removeCompressionNoise: false,
    strength: "standard" as const,
  };
  const customInvalid =
    options.resolution === "custom" &&
    (options.customHeight === null ||
      options.customHeight < 144 ||
      options.customHeight > 4320 ||
      options.customHeight % 2 !== 0);
  const upscale =
    targetHeight !== null && minimumHeight > 0 && targetHeight > minimumHeight;
  const availableContainers = VIDEO_OUTPUT_CONTAINERS.filter(
    (container) =>
      container === "source" || capabilities?.outputs.video.includes(container),
  );
  const audioOptions = (
    options.outputContainer === "webm"
      ? ["copy", "opus128", "opus96", "vorbis128"]
      : options.outputContainer === "mp4"
        ? ["copy", "aac128", "aac96"]
        : options.outputContainer === "mov"
          ? ["copy", "aac128", "aac96", "pcm"]
          : ["copy", "aac128", "aac96", "opus128", "opus96", "flac"]
  ).filter((audio) => {
    if (audio === "copy") {
      return mediaInfos.every((info) =>
        canCopyAudioCodecToContainer(info.audioCodec, options.outputContainer),
      );
    }
    if (!capabilities) return true;
    const encoder = audio.startsWith("aac")
      ? "aac"
      : audio.startsWith("opus")
        ? "libopus"
        : audio === "vorbis128"
          ? "libvorbis"
          : audio === "flac"
            ? "flac"
            : "pcm_s16le";
    return capabilities.ffmpeg.encoders.includes(encoder);
  }) as VideoCompressionOptions["audio"][];
  const audioLabels: Record<VideoCompressionOptions["audio"], string> = {
    copy: "元のまま",
    aac128: "AAC 128kbps",
    aac96: "AAC 96kbps",
    opus128: "Opus 128kbps",
    opus96: "Opus 96kbps",
    vorbis128: "Vorbis 128kbps",
    flac: "FLAC（可逆）",
    pcm: "PCM（無圧縮）",
  };

  return (
    <section className="rounded-[24px] border border-orange-200 bg-orange-50/45 p-4 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <Film size={18} className="text-orange-600" /> 動画設定
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            解像度・コーデック・CRF・音声を選択できます。
          </p>
        </div>
        {source && (
          <span className="w-fit rounded-full border border-orange-200 bg-white px-3 py-1.5 text-[10px] font-black text-orange-700">
            {mediaInfos.length > 1
              ? `${mediaInfos.length}本を一括設定`
              : "ffprobe 解析済み"}
          </span>
        )}
      </div>

      {source ? (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[
            ["解像度", `${source.width} × ${source.height}`],
            ["再生時間", formatDuration(source.duration)],
            ["ビットレート", formatBitrate(source.bitrate)],
            ["映像", source.videoCodec.toUpperCase()],
            ["FPS", source.fps?.toFixed(2) ?? "不明"],
            ["音声", source.audioCodec?.toUpperCase() ?? "なし"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-orange-100 bg-white p-3">
              <p className="text-[9px] font-black text-slate-400">{label}</p>
              <p className="mt-1 truncate text-xs font-black text-slate-800">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-white p-4 text-xs font-bold text-slate-500">
          <span className="size-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          ffprobeで動画情報を解析しています…
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <div className="space-y-4">
          <fieldset disabled={disabled}>
            <legend className="mb-2 text-xs font-black text-slate-700">処理モード</legend>
            <div className="grid gap-2">
              {[
                {
                  id: "copy" as const,
                  label: "無劣化コピー",
                  detail: "解像度とストリームを維持（-c copy）",
                },
                {
                  id: "compress" as const,
                  label: "動画を圧縮",
                  detail: "CRF指定で再エンコード",
                },
              ].map((mode) => (
                <label
                  key={mode.id}
                  className={`cursor-pointer rounded-xl border p-3 transition ${
                    options.mode === mode.id
                      ? "border-orange-400 bg-white ring-1 ring-orange-400"
                      : "border-orange-100 bg-white/70"
                  }`}
                >
                  <input
                    type="radio"
                    name="video-mode"
                    value={mode.id}
                    checked={options.mode === mode.id}
                    onChange={() =>
                      onChange(
                        mode.id === "copy"
                          ? {
                              mode: "copy",
                              resolution: "original",
                              customHeight: null,
                              audio: "copy",
                              enhancements: DEFAULT_VIDEO_ENHANCEMENTS,
                            }
                          : { mode: "compress" },
                      )
                    }
                    className="sr-only"
                  />
                  <span className="block text-xs font-black text-slate-900">
                    {mode.label}
                  </span>
                  <span className="mt-1 block text-[10px] font-medium text-slate-500">
                    {mode.detail}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {options.mode === "compress" ? (
            <OutputFormatSelector
              compact
              mediaCategory="video"
              value={
                options.outputContainer && options.outputContainer !== "source"
                  ? options.outputContainer
                  : "mp4"
              }
              availableFormats={availableContainers.filter(
                (container) => container !== "source",
              )}
              disabled={disabled}
              label="出力コンテナ"
              onChange={(value) => {
                const outputContainer = value as Exclude<
                  VideoCompressionOptions["outputContainer"],
                  "source" | undefined
                >;
                const codecs = availableVideoCodecs(outputContainer, capabilities);
                const codec = codecs.includes(options.codec)
                  ? options.codec
                  : (codecs[0] ?? "h264");
                const audio =
                  options.audio === "copy" &&
                  !mediaInfos.every((info) =>
                    canCopyAudioCodecToContainer(info.audioCodec, outputContainer),
                  )
                    ? outputContainer === "webm"
                      ? "opus96"
                      : "aac128"
                    : outputContainer === "webm"
                      ? options.audio === "copy"
                        ? "copy"
                        : "opus96"
                      : outputContainer === "mp4"
                        ? options.audio === "copy" || options.audio.startsWith("aac")
                          ? options.audio
                          : "aac128"
                        : outputContainer === "mov" &&
                            options.audio !== "copy" &&
                            !options.audio.startsWith("aac") &&
                            options.audio !== "pcm"
                          ? "aac128"
                          : options.audio;
                setCodecChangedReason(
                  codec !== options.codec
                    ? `${outputContainer.toUpperCase()}では現在の映像コーデックを使用できないため、${codec.toUpperCase()}へ変更しました。`
                    : audio !== options.audio
                      ? `${outputContainer.toUpperCase()}との互換性を保つため、音声コーデックを変更しました。`
                      : null,
                );
                onChange({ outputContainer, codec, audio });
              }}
            />
          ) : (
            <label className="block">
              <span className="mb-2 block text-xs font-black text-slate-700">
                出力コンテナ
              </span>
              <select
                value={options.outputContainer ?? "source"}
                disabled={disabled}
                onChange={(event) =>
                  onChange({
                    outputContainer: event.target
                      .value as VideoCompressionOptions["outputContainer"],
                  })
                }
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800"
              >
                {availableContainers.map((container) => (
                  <option key={container} value={container}>
                    {container === "source"
                      ? "元コンテナ（または推奨）"
                      : container.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <OutputFormatWarning codecChangedReason={codecChangedReason} />
          {originalFileName && options.outputContainer !== "source" && (
            <OutputFileNamePreview
              originalFileName={originalFileName}
              outputFormat={options.outputContainer ?? "mp4"}
            />
          )}
          <div>
            {options.mode === "copy" && options.outputContainer !== "source" && (
              <span className="mt-1 block text-[10px] font-bold text-amber-700">
                コーデックを変えずにコンテナだけ変換します。非対応の組み合わせはサーバーで拒否します。
              </span>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <input
              type="checkbox"
              checked={options.removeMetadata}
              disabled={disabled}
              onChange={(event) => onChange({ removeMetadata: event.target.checked })}
              className="mt-0.5 size-4 accent-emerald-600"
            />
            <span>
              <span className="flex items-center gap-1.5 text-xs font-black text-emerald-800">
                <ShieldCheck size={14} /> メタデータを削除
              </span>
              <span className="mt-1 block text-[10px] font-medium leading-4 text-emerald-700">
                コンテナ情報とチャプターを削除します。
              </span>
            </span>
          </label>
        </div>

        {options.mode === "compress" ? (
          <div className="space-y-5 rounded-2xl border border-orange-100 bg-white p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-700">
                  出力解像度
                </span>
                <select
                  value={options.resolution}
                  disabled={disabled || !source}
                  onChange={(event) =>
                    onChange(
                      (() => {
                        const resolution = event.target
                          .value as VideoCompressionOptions["resolution"];
                        const nextHeight =
                          resolution === "original"
                            ? null
                            : resolution === "custom"
                              ? (options.customHeight ?? minimumHeight)
                              : Number(resolution);
                        return {
                          mode: "compress" as const,
                          resolution,
                          customHeight: resolution === "custom" ? nextHeight : null,
                          upscaleMode:
                            nextHeight !== null && nextHeight > minimumHeight
                              ? (options.upscaleMode ?? "simple")
                              : "simple",
                        };
                      })(),
                    )
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                >
                  {resolutions.map((resolution) => (
                    <option key={resolution.value} value={resolution.value}>
                      {resolution.label}
                      {resolution.height !== null && resolution.height > minimumHeight
                        ? "（アップスケール）"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-700">音声</span>
                <select
                  value={options.audio}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      audio: event.target.value as VideoCompressionOptions["audio"],
                    })
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                >
                  {audioOptions.map((audio) => (
                    <option key={audio} value={audio}>
                      {audioLabels[audio]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {options.resolution === "custom" && (
              <label className="block">
                <span className="mb-2 block text-xs font-black text-slate-700">
                  カスタム高さ（px）
                </span>
                <input
                  type="number"
                  min="144"
                  max="4320"
                  step="2"
                  value={options.customHeight ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      (() => {
                        const customHeight = event.target.value
                          ? Number(event.target.value)
                          : null;
                        return {
                          customHeight,
                          upscaleMode:
                            customHeight !== null && customHeight > minimumHeight
                              ? (options.upscaleMode ?? "simple")
                              : "simple",
                        };
                      })(),
                    )
                  }
                  className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                />
                <span className="mt-1 block text-[10px] font-medium text-slate-400">
                  幅はアスペクト比を維持して自動計算します（scale=-2:高さ）。
                </span>
              </label>
            )}

            {upscale && (
              <fieldset
                disabled={disabled}
                className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/50 p-3"
              >
                <legend className="px-1 text-xs font-black text-fuchsia-900">
                  アップスケール方法
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label
                    className={`rounded-xl border p-3 ${options.upscaleMode !== "ai" ? "border-fuchsia-400 bg-white" : "border-fuchsia-100"}`}
                  >
                    <input
                      type="radio"
                      name="video-upscale-mode"
                      checked={options.upscaleMode !== "ai"}
                      onChange={() => onChange({ upscaleMode: "simple" })}
                      className="sr-only"
                    />
                    <span className="block text-xs font-black text-slate-900">
                      Lanczos単純拡大
                    </span>
                    <span className="mt-1 block text-[9px] font-medium text-slate-500">
                      高速ですが、新しい画質情報は増えません。
                    </span>
                  </label>
                  <label
                    className={`rounded-xl border p-3 ${options.upscaleMode === "ai" ? "border-fuchsia-400 bg-white" : "border-fuchsia-100"} ${capabilities?.ai.realEsrgan ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                  >
                    <input
                      type="radio"
                      name="video-upscale-mode"
                      checked={options.upscaleMode === "ai"}
                      disabled={!capabilities?.ai.realEsrgan}
                      onChange={() => onChange({ upscaleMode: "ai" })}
                      className="sr-only"
                    />
                    <span className="block text-xs font-black text-slate-900">
                      Real-ESRGAN AI超解像
                    </span>
                    <span className="mt-1 block text-[9px] font-medium text-slate-500">
                      フレームごとに細部を推定します。非常に重い処理です。
                    </span>
                  </label>
                </div>

                {options.upscaleMode === "ai" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <label className="text-[10px] font-bold text-slate-600">
                      AI倍率
                      <select
                        value={videoAi.scale}
                        onChange={(event) =>
                          onChange({
                            ai: {
                              ...videoAi,
                              scale: Number(event.target.value) as 2 | 4,
                            },
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black"
                      >
                        <option value="2">2倍</option>
                        <option value="4">4倍</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-bold text-slate-600">
                      モデル
                      <select
                        value={videoAi.model}
                        onChange={(event) =>
                          onChange({
                            ai: {
                              ...videoAi,
                              model: event.target.value as "photo" | "anime",
                            },
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black"
                      >
                        <option value="photo">写真向け</option>
                        <option value="anime">アニメ・イラスト向け</option>
                      </select>
                    </label>
                    <label className="text-[10px] font-bold text-slate-600">
                      補正強度
                      <select
                        value={videoAi.strength}
                        onChange={(event) =>
                          onChange({
                            ai: {
                              ...videoAi,
                              strength: event.target.value as typeof videoAi.strength,
                            },
                          })
                        }
                        className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black"
                      >
                        <option value="weak">弱い</option>
                        <option value="standard">標準</option>
                        <option value="strong">強い</option>
                      </select>
                    </label>
                    <label className="flex items-start gap-2 text-[10px] font-bold text-slate-600 sm:col-span-3">
                      <input
                        type="checkbox"
                        checked={videoAi.removeCompressionNoise}
                        onChange={(event) =>
                          onChange({
                            ai: {
                              ...videoAi,
                              removeCompressionNoise: event.target.checked,
                            },
                          })
                        }
                        className="mt-0.5 accent-fuchsia-600"
                      />
                      圧縮ノイズを除去してからAI超解像する
                    </label>
                  </div>
                )}
                {!capabilities?.ai.realEsrgan && (
                  <p className="mt-2 text-[9px] font-bold text-amber-700">
                    {capabilities?.ai.reason ?? "AIワーカーを確認しています。"}
                  </p>
                )}
                {options.upscaleMode === "ai" && !capabilities?.ai.gpu && (
                  <p className="mt-2 text-[9px] font-bold text-rose-700">
                    GPU未検出のため10秒・Full HD以下に制限されます。
                  </p>
                )}
                <p className="mt-2 text-[9px] font-bold text-fuchsia-800">
                  AIは元動画にない細部を生成する可能性があります。
                </p>
              </fieldset>
            )}

            <CodecSelector
              container={options.outputContainer}
              value={options.codec}
              capabilities={capabilities}
              disabled={disabled}
              onChange={(codec) => onChange({ codec })}
            />

            <label className="block text-xs font-black text-slate-700">
              フレームレート
              <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                通常は元のままがおすすめです。変更すると再エンコードされます。
              </span>
              <select
                value={options.frameRate ?? "original"}
                disabled={disabled || options.upscaleMode === "ai"}
                aria-describedby="video-frame-rate-help"
                onChange={(event) =>
                  onChange({
                    frameRate: event.target.value as NonNullable<
                      VideoCompressionOptions["frameRate"]
                    >,
                  })
                }
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800"
              >
                <option value="original">元のフレームレートを維持</option>
                <option value="24">24 FPS</option>
                <option value="30">30 FPS</option>
                <option value="60">60 FPS</option>
              </select>
              <span id="video-frame-rate-help" className="sr-only">
                FPSは1秒あたりの画像枚数です。変更すると滑らかさと容量が変わります。
              </span>
            </label>

            <fieldset disabled={disabled}>
              <legend className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-700">
                <SlidersHorizontal size={14} /> 圧縮品質
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {qualities.map((quality) => (
                  <label
                    key={quality.id}
                    className={`cursor-pointer rounded-xl border p-3 text-center ${
                      options.quality === quality.id
                        ? "border-orange-400 bg-orange-50"
                        : "border-slate-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="video-quality"
                      value={quality.id}
                      checked={options.quality === quality.id}
                      onChange={() => onChange({ quality: quality.id })}
                      className="sr-only"
                    />
                    <span className="block text-xs font-black text-slate-900">
                      {quality.label}
                    </span>
                    <span className="mt-1 block text-[9px] font-medium text-slate-500">
                      {quality.description}
                    </span>
                    <span className="mt-2 inline-block rounded-full bg-white px-2 py-0.5 text-[9px] font-black text-orange-700">
                      CRF {CRF_MAP[options.codec][quality.id]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset
              disabled={disabled}
              className="rounded-xl border border-orange-100 bg-orange-50/50 p-3"
            >
              <legend className="px-1 text-xs font-black text-slate-700">
                通常の画質補正（FFmpeg）
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-slate-600">
                  ノイズ軽減
                  <select
                    value={enhancements.denoise}
                    onChange={(event) =>
                      onChange({
                        enhancements: {
                          ...enhancements,
                          denoise: event.target.value as typeof enhancements.denoise,
                        },
                      })
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black"
                  >
                    <option value="none">なし</option>
                    <option value="hqdn3d">hqdn3d（高速）</option>
                    <option value="nlmeans">nlmeans（高品質・低速）</option>
                  </select>
                </label>
                <label className="text-[10px] font-bold text-slate-600">
                  シャープ化
                  <select
                    value={enhancements.sharpen}
                    onChange={(event) =>
                      onChange({
                        enhancements: {
                          ...enhancements,
                          sharpen: event.target.value as typeof enhancements.sharpen,
                        },
                      })
                    }
                    className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs font-black"
                  >
                    <option value="none">なし</option>
                    <option value="unsharp">unsharp</option>
                    <option value="cas">CAS</option>
                  </select>
                </label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    key: "brightness" as const,
                    label: "明るさ",
                    min: -0.25,
                    max: 0.25,
                    step: 0.01,
                  },
                  {
                    key: "contrast" as const,
                    label: "コントラスト",
                    min: 0.5,
                    max: 1.5,
                    step: 0.01,
                  },
                  {
                    key: "saturation" as const,
                    label: "彩度",
                    min: 0,
                    max: 2,
                    step: 0.01,
                  },
                ].map((control) => (
                  <label
                    key={control.key}
                    className="text-[10px] font-bold text-slate-600"
                  >
                    <span className="flex justify-between">
                      <span>{control.label}</span>
                      <output>{enhancements[control.key].toFixed(2)}</output>
                    </span>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={enhancements[control.key]}
                      onChange={(event) =>
                        onChange({
                          enhancements: {
                            ...enhancements,
                            [control.key]: Number(event.target.value),
                          },
                        })
                      }
                      className="mt-2 w-full accent-orange-500"
                    />
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-start gap-2 text-[10px] font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={enhancements.colorCorrection}
                  onChange={(event) =>
                    onChange({
                      enhancements: {
                        ...enhancements,
                        colorCorrection: event.target.checked,
                      },
                    })
                  }
                  className="mt-0.5 accent-orange-500"
                />
                BT.709へ色空間を補正（入力の色空間によっては変換できない場合があります）
              </label>
              <p className="mt-3 text-[9px] font-bold text-orange-700">
                解像度変更には scale=-2:高さ:flags=lanczos
                を使用し、アスペクト比・FPSを維持します。
              </p>
            </fieldset>

            <div className="flex items-center justify-between rounded-xl bg-slate-900 p-3 text-white">
              <span className="flex items-center gap-2 text-[10px] font-bold text-slate-300">
                <Gauge size={15} /> 推定削減効果
              </span>
              <span className="text-xs font-black">
                {estimatedEffect(options, minimumHeight || 1)}
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800">
              <AlertTriangle className="mt-0.5 shrink-0" size={14} />
              再エンコードされるため、完全な無劣化ではありません。presetはmediumを使用します。
            </div>
            {(upscale || customInvalid) && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold leading-5 text-rose-800"
              >
                <AlertTriangle className="mt-0.5 shrink-0" size={14} />
                {customInvalid
                  ? "カスタム高さは144〜4320pxの偶数で指定してください。"
                  : "元動画より高い解像度です。アップスケールになり、画質は改善しません。"}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-emerald-200 bg-white p-6 text-center">
            <ShieldCheck size={28} className="text-emerald-600" />
            <p className="mt-3 text-sm font-black text-slate-900">
              完全無劣化のストリームコピー
            </p>
            <p className="mt-2 max-w-md text-xs font-medium leading-6 text-slate-500">
              解像度・映像・音声を変更せず、-c
              copyで高速に処理します。メタデータ削除を有効にした場合だけ不要情報を除去します。
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
