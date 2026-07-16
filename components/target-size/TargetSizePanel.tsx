"use client";

import {
  FileDown,
  FlaskConical,
  LoaderCircle,
  Play,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import { useId } from "react";

import { TargetSizeEstimate } from "@/components/target-size/TargetSizeEstimate";
import { TargetSizeInput } from "@/components/target-size/TargetSizeInput";
import { TargetSizePreset } from "@/components/target-size/TargetSizePreset";
import { TargetSizeRecommendation } from "@/components/target-size/TargetSizeRecommendation";
import { TargetSizeWarning } from "@/components/target-size/TargetSizeWarning";
import {
  AUDIO_BITRATE_CANDIDATES_KBPS,
  VIDEO_HEIGHT_CANDIDATES,
} from "@/lib/target-size/config";

import type {
  TargetAudioMode,
  TargetSizeEstimate as TargetSizeEstimateData,
  TargetSizeOptions,
} from "@/lib/target-size/types";

export type TargetSizeMediaKind = "image" | "video" | "audio";

export interface TargetSizePanelProps {
  options: TargetSizeOptions;
  onChange: (update: Partial<TargetSizeOptions>) => void;
  originalBytes: number;
  mediaKinds: readonly TargetSizeMediaKind[];
  estimate: TargetSizeEstimateData | null;
  onRunSampleEstimate?: () => void;
  onCancelSampleEstimate?: () => void;
  onStartWithoutEstimate?: () => void;
  sampleEstimating?: boolean;
  disabled?: boolean;
  className?: string;
}

const imageQualityFields: Array<{
  key: "jpeg" | "webp" | "avif";
  label: string;
}> = [
  { key: "jpeg", label: "JPEG品質の下限" },
  { key: "webp", label: "WebP品質の下限" },
  { key: "avif", label: "AVIF品質の下限" },
];

export function TargetSizePanel({
  options,
  onChange,
  originalBytes,
  mediaKinds,
  estimate,
  onRunSampleEstimate,
  onCancelSampleEstimate,
  onStartWithoutEstimate,
  sampleEstimating = false,
  disabled = false,
  className,
}: TargetSizePanelProps) {
  const titleId = useId();
  const hasImages = mediaKinds.includes("image");
  const hasVideos = mediaKinds.includes("video");
  const hasAudio = mediaKinds.includes("audio") || hasVideos;
  const controlsDisabled = disabled || !options.enabled;
  const targetBytes =
    options.targetBytes ??
    (options.targetRatio !== null
      ? Math.max(1, Math.floor(originalBytes * options.targetRatio))
      : 0);

  function updateMinimumQuality(
    key: keyof TargetSizeOptions["minimumQuality"],
    value: number,
  ) {
    onChange({
      minimumQuality: {
        ...options.minimumQuality,
        [key]: value,
      },
    });
  }

  return (
    <section
      className={`rounded-[24px] border border-indigo-200 bg-indigo-50/35 p-4 sm:p-6 ${className ?? ""}`}
      aria-labelledby={titleId}
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-[#5865e8]">
            <Target size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 id={titleId} className="text-sm font-black text-slate-900">
              目標容量を指定
            </h2>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
              品質下限を守りながら、指定容量以下になる候補を探索します。
            </p>
          </div>
        </div>
        <label
          className={`flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-black focus-within:ring-2 focus-within:ring-[#5865e8] ${
            options.enabled
              ? "border-indigo-400 text-indigo-800"
              : "border-slate-200 text-slate-600"
          } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            checked={options.enabled}
            disabled={disabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            className="size-4 accent-[#5865e8]"
          />
          目標容量モードを使う
        </label>
      </div>

      <fieldset
        disabled={controlsDisabled}
        className={`mt-5 space-y-5 ${controlsDisabled ? "opacity-55" : ""}`}
      >
        <legend className="sr-only">目標容量設定</legend>

        <TargetSizePreset
          selectedId={options.presetId}
          originalBytes={originalBytes}
          disabled={controlsDisabled}
          onSelect={(preset) =>
            onChange({
              presetId: preset.id,
              targetBytes: preset.targetBytes,
              targetRatio: preset.targetRatio,
            })
          }
        />

        <TargetSizeInput
          valueBytes={targetBytes > 0 ? targetBytes : null}
          unit={options.unit}
          disabled={controlsDisabled}
          onValueChange={(bytes) =>
            onChange({
              presetId: "custom",
              targetBytes: bytes,
              targetRatio: null,
            })
          }
          onUnitChange={(unit) => onChange({ unit })}
        />

        {hasAudio && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
            <label className="block text-xs font-black text-slate-800">
              音声の扱い
              <select
                value={options.audioMode}
                disabled={controlsDisabled}
                onChange={(event) =>
                  onChange({ audioMode: event.target.value as TargetAudioMode })
                }
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed"
              >
                <option value="auto">自動（おすすめ）</option>
                {AUDIO_BITRATE_CANDIDATES_KBPS.map((bitrate) => (
                  <option key={bitrate} value={String(bitrate)}>
                    {bitrate}kbps
                  </option>
                ))}
                <option value="remove">音声を削除</option>
              </select>
            </label>
            <p
              className={`mt-2 text-[10px] font-medium leading-5 ${options.audioMode === "remove" ? "font-bold text-rose-700" : "text-sky-800"}`}
            >
              {options.audioMode === "remove"
                ? "音声を削除すると音声ストリーム分の容量を削減できますが、出力は無音になります。"
                : "自動では映像・音声の配分を見ながら、目標容量に適したビットレートを選びます。"}
            </p>
          </div>
        )}

        <details className="group rounded-2xl border border-slate-200 bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5865e8] [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <SlidersHorizontal
                size={15}
                className="text-[#5865e8]"
                aria-hidden="true"
              />{" "}
              品質下限と変換許可
            </span>
            <span className="text-[10px] font-bold text-slate-500">
              <span className="group-open:hidden">開く</span>
              <span className="hidden group-open:inline">閉じる</span>
            </span>
          </summary>
          <div className="space-y-5 border-t border-slate-200 p-4">
            {hasImages && (
              <fieldset>
                <legend className="text-xs font-black text-slate-800">
                  画像品質の下限
                </legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {imageQualityFields.map((field) => (
                    <label
                      key={field.key}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] font-black text-slate-700"
                    >
                      <span className="flex justify-between gap-2">
                        <span>{field.label}</span>
                        <output className="tabular-nums text-[#5865e8]">
                          {options.minimumQuality[field.key]}
                        </output>
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={options.minimumQuality[field.key]}
                        aria-label={field.label}
                        aria-valuetext={`${options.minimumQuality[field.key]}点`}
                        onChange={(event) =>
                          updateMinimumQuality(field.key, Number(event.target.value))
                        }
                        className="mt-3 w-full accent-[#5865e8]"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 focus-within:ring-2 focus-within:ring-[#5865e8] ${options.allowLossyForPng ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
                  >
                    <input
                      type="checkbox"
                      checked={options.allowLossyForPng}
                      onChange={(event) =>
                        onChange({ allowLossyForPng: event.target.checked })
                      }
                      className="mt-0.5 size-4 accent-amber-600"
                    />
                    <span>
                      <span className="block text-xs font-black text-slate-900">
                        PNGの非可逆圧縮を許可
                      </span>
                      <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                        WebP・AVIF・JPEGなどのlossy候補も比較し、容量を小さくします。
                      </span>
                    </span>
                  </label>

                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={options.jpegBackground !== null}
                        onChange={(event) =>
                          onChange({
                            jpegBackground: event.target.checked ? "#ffffff" : null,
                          })
                        }
                        className="mt-0.5 size-4 accent-[#5865e8]"
                      />
                      <span>
                        <span className="block text-xs font-black text-slate-900">
                          透過画像をJPEGにする背景色を指定
                        </span>
                        <span className="mt-1 block text-[10px] font-medium text-slate-500">
                          透過部分は指定色で塗りつぶされます。
                        </span>
                      </span>
                    </label>
                    {options.jpegBackground !== null && (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="color"
                          value={options.jpegBackground}
                          aria-label="JPEG背景色"
                          onChange={(event) =>
                            onChange({ jpegBackground: event.target.value })
                          }
                          className="size-10 cursor-pointer rounded-lg border border-slate-300 bg-white p-1"
                        />
                        <input
                          type="text"
                          value={options.jpegBackground}
                          pattern="#[0-9a-fA-F]{6}"
                          aria-label="JPEG背景色の16進数"
                          onChange={(event) => {
                            if (/^#[0-9a-f]{6}$/i.test(event.target.value))
                              onChange({ jpegBackground: event.target.value });
                          }}
                          className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-xs font-black uppercase text-slate-800"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </fieldset>
            )}

            {hasVideos && (
              <label className="block text-xs font-black text-slate-800">
                動画解像度の下限
                <select
                  value={options.minimumQuality.videoHeight}
                  onChange={(event) =>
                    updateMinimumQuality("videoHeight", Number(event.target.value))
                  }
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800"
                >
                  {VIDEO_HEIGHT_CANDIDATES.map((height) => (
                    <option key={height} value={height}>
                      {height}p以上を維持
                    </option>
                  ))}
                </select>
              </label>
            )}

            {hasAudio && (
              <label className="block text-xs font-black text-slate-800">
                音声ビットレートの下限
                <select
                  value={options.minimumQuality.audioKbps}
                  onChange={(event) =>
                    updateMinimumQuality("audioKbps", Number(event.target.value))
                  }
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800"
                >
                  {AUDIO_BITRATE_CANDIDATES_KBPS.map((bitrate) => (
                    <option key={bitrate} value={bitrate}>
                      {bitrate}kbps以上
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </details>
      </fieldset>

      <TargetSizeWarning
        enabled={options.enabled}
        originalBytes={originalBytes}
        targetBytes={targetBytes}
        feasibility={estimate?.feasibility}
        className="mt-4"
      />

      {options.enabled && (
        <div className="mt-4 space-y-4">
          {hasVideos && onRunSampleEstimate && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRunSampleEstimate}
                disabled={disabled || sampleEstimating}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
              >
                {sampleEstimating ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" /> サンプルを解析中…
                  </>
                ) : (
                  <>
                    <FlaskConical size={15} /> 先頭・中間・終盤で精度を上げる
                  </>
                )}
              </button>
              {sampleEstimating && onStartWithoutEstimate && (
                <button
                  type="button"
                  onClick={onStartWithoutEstimate}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white hover:bg-indigo-700"
                >
                  <Play size={15} /> 予測を待たずに開始
                </button>
              )}
              {sampleEstimating && onCancelSampleEstimate && (
                <button
                  type="button"
                  onClick={onCancelSampleEstimate}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-black text-slate-700 hover:bg-slate-50"
                >
                  <X size={15} /> 詳細な容量予測をキャンセル
                </button>
              )}
            </div>
          )}
          <TargetSizeRecommendation
            estimate={estimate}
            allowResolutionChange={options.allowResolutionChange}
            disabled={disabled}
            onAllowResolutionChangeChange={(allowed) =>
              onChange({ allowResolutionChange: allowed })
            }
          />
          <TargetSizeEstimate estimate={estimate} />
          <p className="flex items-start gap-2 rounded-xl bg-slate-900 p-3 text-[10px] font-medium leading-5 text-slate-300">
            <FileDown
              size={14}
              className="mt-0.5 shrink-0 text-indigo-300"
              aria-hidden="true"
            />
            目標値は上限です。品質下限や利用可能なコーデックのため、達成できない場合は最良候補と理由を結果に表示します。
          </p>
        </div>
      )}
    </section>
  );
}
