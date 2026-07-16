import {
  Bot,
  Clock3,
  FileCog,
  Film,
  Gauge,
  Image as ImageIcon,
  ScanSearch,
} from "lucide-react";

import { formatBytes, formatMediaTime } from "@/components/progress/utils";

import type { MediaKind, ProcessingDetailData } from "@/components/progress/types";
import type { ReactNode } from "react";

export interface ProcessingDetailsProps {
  kind: MediaKind;
  data: ProcessingDetailData;
  title?: string;
  className?: string;
}

interface DetailRow {
  label: string;
  value: ReactNode;
  visible: boolean;
  icon?: ReactNode;
}

const metadataLabels: Record<
  NonNullable<ProcessingDetailData["metadataRemoval"]>,
  string
> = {
  pending: "削除を確認中",
  removed: "削除済み",
  kept: "保持",
  "not-found": "対象なし",
};

function joinPair(before?: string, after?: string) {
  if (!before && !after) return "--";
  return `${before ?? "不明"} → ${after ?? "不明"}`;
}

export function ProcessingDetails({
  kind,
  data,
  title = "詳細な処理状況",
  className,
}: ProcessingDetailsProps) {
  const videoRows: DetailRow[] = [
    {
      label: "現在の試行",
      value: `${data.attempt ?? "--"} / ${data.maxAttempts ?? "--"}`,
      visible: data.attempt !== undefined || data.maxAttempts !== undefined,
      icon: <FileCog size={14} aria-hidden="true" />,
    },
    {
      label: "フレーム",
      value: `${data.currentFrame?.toLocaleString() ?? "--"} / ${data.totalFrames?.toLocaleString() ?? "--"}`,
      visible: data.currentFrame !== undefined || data.totalFrames !== undefined,
      icon: <Film size={14} aria-hidden="true" />,
    },
    {
      label: "処理位置",
      value: `${formatMediaTime(data.processedTime)} / ${formatMediaTime(data.totalDuration)}`,
      visible: data.processedTime !== undefined || data.totalDuration !== undefined,
      icon: <Clock3 size={14} aria-hidden="true" />,
    },
    {
      label: "処理速度",
      value: data.speed ?? "計測中",
      visible: data.speed !== undefined,
      icon: <Gauge size={14} aria-hidden="true" />,
    },
    {
      label: "FPS",
      value: data.fps === undefined ? "計測中" : data.fps.toFixed(1),
      visible: data.fps !== undefined,
    },
    {
      label: "解像度",
      value: joinPair(data.originalResolution, data.outputResolution),
      visible: Boolean(data.originalResolution || data.outputResolution),
    },
    {
      label: "コーデック",
      value: joinPair(data.originalCodec, data.outputCodec),
      visible: Boolean(data.originalCodec || data.outputCodec),
    },
    {
      label: "エンコーダー",
      value: data.encoder ?? "選択中",
      visible: Boolean(data.encoder),
      icon: <FileCog size={14} aria-hidden="true" />,
    },
    {
      label: "ファイルサイズ",
      value: `${data.originalSize === undefined ? "不明" : formatBytes(data.originalSize)} → ${
        data.estimatedOutputSize !== undefined
          ? `推定 ${formatBytes(data.estimatedOutputSize)}`
          : data.currentOutputSize !== undefined
            ? `現在 ${formatBytes(data.currentOutputSize)}`
            : "推定中"
      }`,
      visible:
        data.originalSize !== undefined ||
        data.currentOutputSize !== undefined ||
        data.estimatedOutputSize !== undefined,
    },
  ];

  const imageRows: DetailRow[] = [
    {
      label: "現在の試行",
      value: `${data.attempt ?? "--"} / ${data.maxAttempts ?? "--"}`,
      visible: data.attempt !== undefined || data.maxAttempts !== undefined,
      icon: <FileCog size={14} aria-hidden="true" />,
    },
    {
      label: "現在の処理",
      value: data.currentOperation ?? "準備中",
      visible: Boolean(data.currentOperation),
      icon: <FileCog size={14} aria-hidden="true" />,
    },
    {
      label: "画像サイズ",
      value: `${data.originalSize === undefined ? "不明" : formatBytes(data.originalSize)} → ${
        data.currentOutputSize === undefined
          ? "処理中"
          : formatBytes(data.currentOutputSize)
      }`,
      visible: data.originalSize !== undefined || data.currentOutputSize !== undefined,
      icon: <ImageIcon size={14} aria-hidden="true" />,
    },
    {
      label: "解像度",
      value: joinPair(data.originalResolution, data.outputResolution),
      visible: Boolean(data.originalResolution || data.outputResolution),
    },
    {
      label: "形式",
      value: joinPair(data.originalFormat, data.outputFormat),
      visible: Boolean(data.originalFormat || data.outputFormat),
    },
    {
      label: "AI高画質化",
      value: data.aiScale ? `${data.aiScale}倍` : "使用しない",
      visible: data.aiScale !== undefined,
      icon: <Bot size={14} aria-hidden="true" />,
    },
    {
      label: "メタデータ",
      value: data.metadataRemoval
        ? metadataLabels[data.metadataRemoval]
        : "確認していません",
      visible: data.metadataRemoval !== undefined,
      icon: <ScanSearch size={14} aria-hidden="true" />,
    },
  ];

  const audioRows: DetailRow[] = [
    {
      label: "処理位置",
      value: `${formatMediaTime(data.processedTime)} / ${formatMediaTime(data.totalDuration)}`,
      visible: data.processedTime !== undefined || data.totalDuration !== undefined,
      icon: <Clock3 size={14} aria-hidden="true" />,
    },
    {
      label: "形式",
      value: joinPair(data.originalFormat, data.outputFormat),
      visible: Boolean(data.originalFormat || data.outputFormat),
    },
    {
      label: "コーデック",
      value: joinPair(data.originalCodec, data.outputCodec),
      visible: Boolean(data.originalCodec || data.outputCodec),
    },
    {
      label: "ファイルサイズ",
      value: `${data.originalSize === undefined ? "不明" : formatBytes(data.originalSize)} → ${
        data.estimatedOutputSize !== undefined
          ? `推定 ${formatBytes(data.estimatedOutputSize)}`
          : data.currentOutputSize !== undefined
            ? `現在 ${formatBytes(data.currentOutputSize)}`
            : "推定中"
      }`,
      visible:
        data.originalSize !== undefined ||
        data.currentOutputSize !== undefined ||
        data.estimatedOutputSize !== undefined,
    },
  ];

  const rows = (
    kind === "video" ? videoRows : kind === "image" ? imageRows : audioRows
  ).filter((row) => row.visible);

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 ${className ?? ""}`}
    >
      <h3 className="font-black text-slate-900">{title}</h3>
      {rows.length > 0 ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="rounded-xl bg-slate-50 px-3.5 py-3">
              <dt className="flex items-center gap-1.5 text-[10px] font-black text-slate-500">
                {row.icon}
                {row.label}
              </dt>
              <dd className="mt-1 break-words text-sm font-black tabular-nums text-slate-900">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-4 text-xs font-medium text-slate-500">
          詳細情報を取得しています。
        </p>
      )}
    </section>
  );
}
