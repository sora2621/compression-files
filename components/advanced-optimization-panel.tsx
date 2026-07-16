"use client";

import {
  AlertTriangle,
  Archive,
  BadgeCheck,
  Film,
  Gauge,
  Image as ImageIcon,
  Info,
  Minimize2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useId } from "react";

import type {
  AdvancedOptimizationMode,
  LosslessImageOptions,
  VideoQualitySearchOptions,
  VideoStreamSelectionOptions,
} from "@/lib/optimization/types";

export type AdvancedOptimizationMediaKind = "image" | "video" | "audio";

export interface AdvancedOptimizationPanelProps {
  mode: AdvancedOptimizationMode;
  onModeChange: (mode: AdvancedOptimizationMode) => void;
  losslessImageOptions: LosslessImageOptions;
  onLosslessImageOptionsChange: (update: Partial<LosslessImageOptions>) => void;
  videoStreamSelection: VideoStreamSelectionOptions;
  onVideoStreamSelectionChange: (update: Partial<VideoStreamSelectionOptions>) => void;
  videoQualitySearch: VideoQualitySearchOptions;
  onVideoQualitySearchChange: (update: Partial<VideoQualitySearchOptions>) => void;
  mediaKinds: readonly AdvancedOptimizationMediaKind[];
  videoDeletionPreview?: string[];
  disabled?: boolean;
  className?: string;
}

const modes: Array<{
  id: AdvancedOptimizationMode;
  label: string;
  description: string;
  detail: string;
  icon: typeof ShieldCheck;
}> = [
  {
    id: "strict-lossless",
    label: "完全無劣化",
    description: "データを変更せずに削減",
    detail: "画素・映像・音声が一致する候補だけを採用します。",
    icon: ShieldCheck,
  },
  {
    id: "high-quality-optimization",
    label: "高画質最適化",
    description: "見た目を維持しながら削減",
    detail: "品質検査を通過した候補から最小サイズを選びます。",
    icon: Sparkles,
  },
  {
    id: "size-priority",
    label: "容量優先",
    description: "ファイルサイズをできるだけ小さく",
    detail: "画質が変化する可能性を許容して容量を優先します。",
    icon: Minimize2,
  },
  {
    id: "archive",
    label: "アーカイブ",
    description: "長期保存を重視",
    detail: "復元性と保存向け形式を優先して候補を比較します。",
    icon: Archive,
  },
];

const losslessImageSettings: Array<{
  key: keyof LosslessImageOptions;
  label: string;
  description: string;
}> = [
  {
    key: "stripPrivacyMetadata",
    label: "プライバシーメタデータを削除",
    description: "EXIF・GPS・XMPなどを候補から取り除きます。",
  },
  {
    key: "compareWebpLossless",
    label: "WebP losslessも比較",
    description: "復元後の画素一致を検証してから採用します。",
  },
  {
    key: "enableJpegXl",
    label: "JPEG XLを候補に含める",
    description: "対応エンコーダーがある場合だけ候補を作成します。",
  },
];

const streamSettings: Array<{
  key: keyof VideoStreamSelectionOptions;
  label: string;
  description: string;
}> = [
  {
    key: "keepPrimaryAudioOnly",
    label: "主音声だけを保持",
    description: "副音声や別言語の音声ストリームを除外します。",
  },
  {
    key: "removeSubtitles",
    label: "字幕を削除",
    description: "埋め込み字幕ストリームを出力に含めません。",
  },
  {
    key: "removeAttachments",
    label: "添付ファイルを削除",
    description: "コンテナ内のフォントや画像などを除外します。",
  },
  {
    key: "removeChapters",
    label: "チャプターを削除",
    description: "章情報を削除してコンテナを簡素化します。",
  },
  {
    key: "stripPrivacyMetadata",
    label: "プライバシーメタデータを削除",
    description: "撮影場所や作成者などの情報を取り除きます。",
  },
];

const codecSettings: Array<{
  key: "includeAv1" | "includeH265" | "includeH264";
  label: string;
  description: string;
}> = [
  { key: "includeAv1", label: "AV1", description: "高圧縮・処理は重め" },
  { key: "includeH265", label: "H.265", description: "高圧縮・互換性に注意" },
  { key: "includeH264", label: "H.264", description: "互換性を優先" },
];

interface ToggleCardProps {
  checked: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}

function ToggleCard({
  checked,
  disabled,
  label,
  description,
  onChange,
}: ToggleCardProps) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border p-3 transition focus-within:ring-2 focus-within:ring-[#5865e8] focus-within:ring-offset-2 ${
        checked ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white"
      } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:border-slate-300"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[#5865e8]"
      />
      <span>
        <span className="block text-xs font-black text-slate-900">{label}</span>
        <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
          {description}
        </span>
      </span>
    </label>
  );
}

export function AdvancedOptimizationPanel({
  mode,
  onModeChange,
  losslessImageOptions,
  onLosslessImageOptionsChange,
  videoStreamSelection,
  onVideoStreamSelectionChange,
  videoQualitySearch,
  onVideoQualitySearchChange,
  mediaKinds,
  videoDeletionPreview,
  disabled = false,
  className,
}: AdvancedOptimizationPanelProps) {
  const modeName = useId();
  const losslessNoticeId = useId();
  const vmafNoticeId = useId();
  const hasImages = mediaKinds.includes("image");
  const hasVideos = mediaKinds.includes("video");
  const hasAudio = mediaKinds.includes("audio");
  const selectedCodecCount = codecSettings.filter(
    (setting) => videoQualitySearch[setting.key],
  ).length;
  const qualitySearchEnabled =
    mode === "high-quality-optimization" || mode === "size-priority";
  const hasVideoDeletionSelection =
    videoStreamSelection.keepPrimaryAudioOnly ||
    videoStreamSelection.removeSubtitles ||
    videoStreamSelection.removeAttachments ||
    videoStreamSelection.removeChapters ||
    videoStreamSelection.stripPrivacyMetadata;

  return (
    <section
      className={`rounded-[24px] border border-indigo-200 bg-indigo-50/35 p-4 sm:p-6 ${className ?? ""}`}
      aria-labelledby={`${modeName}-title`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-100 text-[#5865e8]">
          <SlidersHorizontal size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 id={`${modeName}-title`} className="text-sm font-black text-slate-900">
            高度な最適化
          </h2>
          <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
            複数の候補を実際に生成・検証し、条件を満たす最小サイズを選びます。
          </p>
        </div>
      </div>

      <fieldset disabled={disabled} className="mt-5">
        <legend className="mb-3 text-xs font-black text-slate-700">最適化モード</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {modes.map((item) => {
            const Icon = item.icon;
            const selected = mode === item.id;
            return (
              <label
                key={item.id}
                className={`relative cursor-pointer rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-[#5865e8] focus-within:ring-offset-2 ${
                  selected
                    ? "border-indigo-400 bg-white ring-1 ring-indigo-300"
                    : "border-indigo-100 bg-white/75 hover:border-indigo-200"
                } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
              >
                <input
                  type="radio"
                  name={modeName}
                  value={item.id}
                  checked={selected}
                  disabled={disabled}
                  aria-describedby={
                    item.id === "strict-lossless"
                      ? losslessNoticeId
                      : item.id === "high-quality-optimization"
                        ? vmafNoticeId
                        : undefined
                  }
                  onChange={() => onModeChange(item.id)}
                  className="sr-only"
                />
                <span className="flex items-start gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                      selected
                        ? "bg-indigo-100 text-[#5865e8]"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-black text-slate-900">
                      {item.label}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-indigo-700">
                      {item.description}
                    </span>
                    <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                      {item.detail}
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        <p
          id={losslessNoticeId}
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] font-bold leading-5 text-emerald-800"
        >
          <BadgeCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          無劣化はデコード後の画素・映像・音声データの検証成功時のみ表示します。メタデータやコンテナ構造は変わる場合があります。
        </p>
        <p
          id={vmafNoticeId}
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800"
        >
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          VMAFは完全な画質保証ではありません。「高画質基準を満たした候補」として提示し、最終確認は比較プレビューで行ってください。
        </p>
      </div>

      <details className="group mt-5 rounded-2xl border border-slate-200 bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-black text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5865e8] [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-[#5865e8]" aria-hidden="true" />
            高度な最適化設定
          </span>
          <span className="text-[10px] font-bold text-slate-500">
            <span className="group-open:hidden">開く</span>
            <span className="hidden group-open:inline">閉じる</span>
          </span>
        </summary>

        <div className="space-y-6 border-t border-slate-200 p-4 sm:p-5">
          {hasImages && (
            <fieldset disabled={disabled}>
              <legend className="flex items-center gap-2 text-xs font-black text-slate-800">
                <ImageIcon size={15} className="text-violet-600" aria-hidden="true" />
                画像の可逆候補
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {losslessImageSettings.map((setting) => (
                  <ToggleCard
                    key={setting.key}
                    checked={losslessImageOptions[setting.key]}
                    disabled={disabled}
                    label={setting.label}
                    description={setting.description}
                    onChange={(checked) =>
                      onLosslessImageOptionsChange({ [setting.key]: checked })
                    }
                  />
                ))}
              </div>
              {losslessImageOptions.enableJpegXl && (
                <p
                  role="status"
                  className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800"
                >
                  JPEG
                  XL（JXL）はブラウザや画像編集ソフトによって表示できない場合があります。元ファイルを残したまま互換性を確認してください。
                </p>
              )}
            </fieldset>
          )}

          {hasVideos && (
            <fieldset disabled={disabled}>
              <legend className="flex items-center gap-2 text-xs font-black text-slate-800">
                <Film size={15} className="text-orange-600" aria-hidden="true" />
                動画ストリームの整理
              </legend>
              <p className="mt-1 text-[10px] font-medium leading-4 text-slate-500">
                選択した字幕・副音声などは出力から失われます。必要なストリームを確認してください。
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {streamSettings.map((setting) => (
                  <ToggleCard
                    key={setting.key}
                    checked={videoStreamSelection[setting.key]}
                    disabled={disabled}
                    label={setting.label}
                    description={setting.description}
                    onChange={(checked) =>
                      onVideoStreamSelectionChange({ [setting.key]: checked })
                    }
                  />
                ))}
              </div>
              <div
                className={`mt-3 rounded-xl border p-3 ${
                  hasVideoDeletionSelection && videoDeletionPreview?.length
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-slate-50"
                }`}
                role={
                  hasVideoDeletionSelection && videoDeletionPreview?.length
                    ? "alert"
                    : "status"
                }
              >
                <p className="flex items-center gap-2 text-[10px] font-black text-slate-800">
                  {hasVideoDeletionSelection && videoDeletionPreview?.length ? (
                    <AlertTriangle
                      size={14}
                      className="text-amber-700"
                      aria-hidden="true"
                    />
                  ) : (
                    <Info size={14} className="text-slate-500" aria-hidden="true" />
                  )}
                  実行前の削除対象
                </p>
                {!hasVideoDeletionSelection ? (
                  <p className="mt-1 text-[10px] font-medium text-slate-500">
                    現在、削除するストリームや情報は選択されていません。
                  </p>
                ) : videoDeletionPreview === undefined ? (
                  <p className="mt-1 text-[10px] font-medium text-slate-600">
                    動画解析後に対象を表示します。
                  </p>
                ) : videoDeletionPreview.length === 0 ? (
                  <p className="mt-1 text-[10px] font-medium text-slate-600">
                    選択条件に一致する削除対象はありません。
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-[10px] font-bold leading-5 text-amber-800">
                      次のストリームまたは情報は出力から削除され、元に戻せません。
                    </p>
                    <ul
                      className="mt-2 flex flex-wrap gap-1.5"
                      aria-label="削除予定の項目"
                    >
                      {videoDeletionPreview.map((item, index) => (
                        <li
                          key={`${item}-${index}`}
                          className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[9px] font-black text-amber-800"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </fieldset>
          )}

          {hasVideos && qualitySearchEnabled && (
            <fieldset disabled={disabled} aria-describedby={vmafNoticeId}>
              <legend className="flex items-center gap-2 text-xs font-black text-slate-800">
                <Gauge size={15} className="text-sky-600" aria-hidden="true" />
                VMAF品質探索
              </legend>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="flex items-center justify-between gap-3 text-xs font-black text-slate-800">
                    平均VMAFしきい値
                    <output className="tabular-nums text-[#5865e8]">
                      {videoQualitySearch.vmafThreshold}
                    </output>
                  </span>
                  <input
                    type="range"
                    min={80}
                    max={100}
                    step={1}
                    value={videoQualitySearch.vmafThreshold}
                    aria-label="平均VMAFしきい値"
                    aria-valuetext={`${videoQualitySearch.vmafThreshold}点`}
                    onChange={(event) =>
                      onVideoQualitySearchChange({
                        vmafThreshold: Number(event.target.value),
                      })
                    }
                    className="mt-3 w-full accent-[#5865e8]"
                  />
                  <span className="mt-1 flex justify-between text-[9px] font-bold text-slate-400">
                    <span>80</span>
                    <span>100</span>
                  </span>
                </label>

                <label className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="flex items-center justify-between gap-3 text-xs font-black text-slate-800">
                    最低フレームしきい値
                    <output className="tabular-nums text-[#5865e8]">
                      {videoQualitySearch.minimumFrameThreshold}
                    </output>
                  </span>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    step={1}
                    value={videoQualitySearch.minimumFrameThreshold}
                    aria-label="最低フレームVMAFしきい値"
                    aria-valuetext={`${videoQualitySearch.minimumFrameThreshold}点`}
                    onChange={(event) =>
                      onVideoQualitySearchChange({
                        minimumFrameThreshold: Number(event.target.value),
                      })
                    }
                    className="mt-3 w-full accent-[#5865e8]"
                  />
                  <span className="mt-1 flex justify-between text-[9px] font-bold text-slate-400">
                    <span>50</span>
                    <span>100</span>
                  </span>
                </label>
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-[0.7fr_1.3fr]">
                <label className="text-xs font-black text-slate-700">
                  探索プリセット
                  <select
                    value={videoQualitySearch.preset}
                    onChange={(event) =>
                      onVideoQualitySearchChange({
                        preset: event.target.value as VideoQualitySearchOptions["preset"],
                      })
                    }
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-4 focus:ring-indigo-100"
                  >
                    <option value="medium">medium（標準）</option>
                    <option value="slow">slow（高圧縮）</option>
                    <option value="slower">slower（最も時間がかかる）</option>
                  </select>
                </label>

                <div>
                  <p className="text-xs font-black text-slate-700">比較するコーデック</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {codecSettings.map((setting) => {
                      const checked = videoQualitySearch[setting.key];
                      const lastSelected = checked && selectedCodecCount === 1;
                      return (
                        <ToggleCard
                          key={setting.key}
                          checked={checked}
                          disabled={disabled || lastSelected}
                          label={setting.label}
                          description={
                            lastSelected ? "最低1つは選択が必要です" : setting.description
                          }
                          onChange={(next) =>
                            onVideoQualitySearchChange({ [setting.key]: next })
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </fieldset>
          )}

          {hasVideos && !qualitySearchEnabled && (
            <p className="rounded-xl bg-slate-50 p-3 text-[10px] font-medium leading-5 text-slate-600">
              VMAF品質探索は「高画質最適化」または「容量優先」で使用します。完全無劣化とアーカイブでは可逆性・元データ維持を優先します。
            </p>
          )}

          {hasAudio && !hasVideos && !hasImages && (
            <p className="rounded-xl bg-sky-50 p-3 text-[10px] font-medium leading-5 text-sky-800">
              音声は可逆コーデック、ストリームコピー、または品質設定済みの圧縮候補を比較します。
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
