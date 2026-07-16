"use client";

import { AlertTriangle, Cpu, ImageIcon, Sparkles, Zap } from "lucide-react";
import { useId } from "react";

import type { RuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import type { ImageAiOptions } from "@/lib/media/image-types";

export interface RealEsrganPanelProps {
  value: ImageAiOptions;
  onChange: (update: Partial<ImageAiOptions>) => void;
  capability: Pick<RuntimeCapabilities["ai"], "realEsrgan" | "gfpgan" | "gpu" | "reason">;
  disabled?: boolean;
  disabledReason?: string;
}

const strengths: Array<{
  id: ImageAiOptions["strength"];
  label: string;
  description: string;
}> = [
  { id: "weak", label: "弱い", description: "原画を優先" },
  { id: "standard", label: "標準", description: "自然な補正" },
  { id: "strong", label: "強い", description: "AI結果を優先" },
];

export function RealEsrganPanel({
  value,
  onChange,
  capability,
  disabled = false,
  disabledReason,
}: RealEsrganPanelProps) {
  const id = useId();
  const available = capability.realEsrgan;
  const panelDisabled = disabled || !available;
  const controlsDisabled = panelDisabled || !value.enabled;
  const reason = disabledReason ?? (!available ? capability.reason : null);

  return (
    <section className="overflow-hidden rounded-[24px] border border-fuchsia-200 bg-white">
      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-sm font-black">
              <Sparkles size={18} aria-hidden="true" /> AI高画質化
            </div>
            <p className="mt-1 text-xs font-medium leading-5 text-violet-100">
              Real-ESRGANで解像感を補いながら2倍・4倍に拡大します。
            </p>
          </div>

          <span
            className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-black ${
              available
                ? "border-white/25 bg-white/15 text-white"
                : "border-white/15 bg-slate-950/20 text-violet-100"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${available ? "bg-emerald-300" : "bg-amber-300"}`}
              aria-hidden="true"
            />
            {available ? "Real-ESRGAN 利用可能" : "現在の環境では利用不可"}
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {reason && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-800"
          >
            <Cpu className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
            {reason}
          </div>
        )}

        <label
          htmlFor={`${id}-enabled`}
          className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${
            value.enabled && available
              ? "border-fuchsia-300 bg-fuchsia-50"
              : "border-slate-200 bg-slate-50"
          } ${panelDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        >
          <span>
            <span className="block text-xs font-black text-slate-900">
              AI高画質化を使用する
            </span>
            <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
              通常補正より処理時間とメモリを多く使用します。
            </span>
          </span>
          <span className="relative shrink-0">
            <input
              id={`${id}-enabled`}
              type="checkbox"
              checked={value.enabled}
              disabled={panelDisabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              className="peer sr-only"
            />
            <span className="block h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-fuchsia-600 peer-focus-visible:ring-4 peer-focus-visible:ring-fuchsia-200 peer-disabled:opacity-60" />
            <span className="absolute left-1 top-1 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </span>
        </label>

        <fieldset
          disabled={controlsDisabled}
          className={`mt-5 space-y-5 ${controlsDisabled ? "opacity-50" : ""}`}
        >
          <legend className="sr-only">Real-ESRGAN設定</legend>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">拡大倍率</p>
            <div className="grid grid-cols-2 gap-2">
              {([2, 4] as const).map((scale) => (
                <label
                  key={scale}
                  className={`cursor-pointer rounded-xl border p-3 text-center transition ${
                    value.scale === scale
                      ? "border-fuchsia-400 bg-fuchsia-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-scale`}
                    value={scale}
                    checked={value.scale === scale}
                    onChange={() => onChange({ scale })}
                    className="sr-only"
                  />
                  <span className="block text-sm font-black text-slate-900">
                    {scale}×
                  </span>
                  <span className="mt-1 block text-[9px] font-bold text-slate-500">
                    幅・高さをそれぞれ{scale}倍
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">AIモデル</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                {
                  id: "photo" as const,
                  label: "写真向け",
                  detail: "人物・風景・商品写真など自然な画像に",
                  icon: ImageIcon,
                },
                {
                  id: "anime" as const,
                  label: "アニメ・イラスト向け",
                  detail: "線画やフラットな塗りの画像に",
                  icon: Zap,
                },
              ].map((model) => {
                const Icon = model.icon;
                return (
                  <label
                    key={model.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      value.model === model.id
                        ? "border-fuchsia-400 bg-fuchsia-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${id}-model`}
                      value={model.id}
                      checked={value.model === model.id}
                      onChange={() => onChange({ model: model.id })}
                      className="sr-only"
                    />
                    <Icon
                      className="mt-0.5 shrink-0 text-fuchsia-600"
                      size={17}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-xs font-black text-slate-900">
                        {model.label}
                      </span>
                      <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                        {model.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-black text-slate-700">AI補正強度</p>
            <div className="grid grid-cols-3 gap-2">
              {strengths.map((strength) => (
                <label
                  key={strength.id}
                  className={`cursor-pointer rounded-xl border p-3 text-center transition ${
                    value.strength === strength.id
                      ? "border-fuchsia-400 bg-fuchsia-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-strength`}
                    value={strength.id}
                    checked={value.strength === strength.id}
                    onChange={() => onChange({ strength: strength.id })}
                    className="sr-only"
                  />
                  <span className="block text-xs font-black text-slate-900">
                    {strength.label}
                  </span>
                  <span className="mt-1 block text-[9px] font-medium text-slate-500">
                    {strength.description}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-black text-slate-700">GFPGAN 顔補正</p>
              <span
                className={`rounded-full px-2 py-1 text-[9px] font-black ${capability.gfpgan ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
              >
                {capability.gfpgan ? "利用可能" : "未導入"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["off", "なし"],
                  ["weak", "弱い"],
                  ["standard", "標準"],
                  ["strong", "強い"],
                ] as const
              ).map(([faceCorrection, label]) => (
                <label
                  key={faceCorrection}
                  className={`rounded-xl border p-2 text-center ${
                    value.faceCorrection === faceCorrection
                      ? "border-fuchsia-400 bg-fuchsia-50"
                      : "border-slate-200 bg-white"
                  } ${faceCorrection !== "off" && !capability.gfpgan ? "cursor-not-allowed opacity-45" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name={`${id}-face`}
                    value={faceCorrection}
                    checked={value.faceCorrection === faceCorrection}
                    disabled={faceCorrection !== "off" && !capability.gfpgan}
                    onChange={() => onChange({ faceCorrection })}
                    className="sr-only"
                  />
                  <span className="text-[10px] font-black text-slate-800">{label}</span>
                </label>
              ))}
            </div>
            {!capability.gfpgan && (
              <p className="mt-2 text-[9px] font-bold leading-4 text-slate-500">
                gfpganパッケージとGFPGAN_MODEL_PATHを設定すると選択できます。
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <input
              type="checkbox"
              checked={value.removeCompressionNoise}
              onChange={(event) =>
                onChange({ removeCompressionNoise: event.target.checked })
              }
              className="mt-0.5 size-4 shrink-0 accent-fuchsia-600"
            />
            <span>
              <span className="block text-xs font-black text-slate-900">
                圧縮ノイズを除去
              </span>
              <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-500">
                JPEGなどに見られるブロック状のノイズを軽減してから高画質化します。
              </span>
            </span>
          </label>
        </fieldset>

        {available && !capability.gpu && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-[10px] font-bold leading-5 text-sky-800">
            <Cpu className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
            GPUを検出できませんでした。CPUでも処理できますが、完了まで時間がかかる場合があります。
          </div>
        )}

        <div
          role="note"
          className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[10px] font-bold leading-5 text-rose-800"
        >
          <AlertTriangle className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
          AI高画質化は、元画像に存在しない細部を推測して生成する場合があります。正確な記録画像や証拠資料では、処理前後を必ず比較してください。
        </div>
      </div>
    </section>
  );
}
