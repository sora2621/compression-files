"use client";

import { AudioLines, ShieldCheck } from "lucide-react";

import { OutputFileNamePreview, OutputFormatSelector } from "@/components/output-format";
import {
  AUDIO_BITRATE_MAP,
  type AudioProcessingOptions,
  type AudioOutputFormat,
  type LossyAudioOutputFormat,
} from "@/lib/media/audio-types";
import { isStrictLosslessProcessingMode } from "@/lib/media/image-types";

import type { AudioMediaInfo } from "@/lib/media/video-types";

interface AudioSettingsPanelProps {
  mediaInfos: AudioMediaInfo[];
  options: AudioProcessingOptions;
  availableFormats: string[];
  disabled: boolean;
  originalFileName?: string;
  onChange: (update: Partial<AudioProcessingOptions>) => void;
}

export function AudioSettingsPanel({
  mediaInfos,
  options,
  availableFormats,
  disabled,
  originalFileName,
  onChange,
}: AudioSettingsPanelProps) {
  const source = mediaInfos[0];
  const lossy = options.outputFormat in AUDIO_BITRATE_MAP;
  const losslessInvalid =
    isStrictLosslessProcessingMode(options.processingMode) &&
    options.outputFormat !== "flac" &&
    options.outputFormat !== "wav";

  return (
    <section className="rounded-[24px] border border-sky-200 bg-sky-50/50 p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-slate-900">
            <AudioLines size={18} className="text-sky-600" /> 音声設定
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            実行中のFFmpegで利用できる出力だけを表示します。
          </p>
        </div>
        {source && (
          <span className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[10px] font-black text-sky-700">
            {source.audioCodec.toUpperCase()} · {source.sampleRate ?? "?"}Hz
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <OutputFormatSelector
          compact
          mediaCategory="audio"
          value={options.outputFormat}
          availableFormats={availableFormats}
          disabled={disabled || options.processingMode === "metadata-only"}
          onChange={(value) => onChange({ outputFormat: value as AudioOutputFormat })}
        />

        {lossy && options.processingMode !== "metadata-only" && (
          <label>
            <span className="mb-2 block text-xs font-black text-slate-700">圧縮品質</span>
            <select
              value={options.quality}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  quality: event.target.value as AudioProcessingOptions["quality"],
                })
              }
              className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800"
            >
              <option value="high">高品質</option>
              <option value="balanced">バランス</option>
              <option value="small">容量優先</option>
            </select>
            <span className="mt-1 block text-[10px] font-bold text-sky-700">
              {
                AUDIO_BITRATE_MAP[options.outputFormat as LossyAudioOutputFormat][
                  options.quality
                ]
              }
            </span>
          </label>
        )}
      </div>

      {originalFileName && (
        <div className="mt-4">
          <OutputFileNamePreview
            originalFileName={originalFileName}
            outputFormat={options.outputFormat}
          />
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
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
          <span className="mt-1 block text-[10px] font-medium text-emerald-700">
            コンテナ情報とチャプターを削除します。
          </span>
        </span>
      </label>

      {losslessInvalid && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold text-rose-800"
        >
          無劣化モードではFLACまたはWAVを選択してください。
        </p>
      )}
      {options.processingMode === "metadata-only" && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800">
          対応する元コンテナへ -c copy
          できる場合だけ処理します。再エンコードが必要な形式では、形式変換を選択してください。
        </p>
      )}
    </section>
  );
}
