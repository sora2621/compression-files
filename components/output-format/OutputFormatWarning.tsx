"use client";

import { AlertTriangle } from "lucide-react";

interface OutputFormatWarningProps {
  transparencyToJpeg?: boolean;
  photoToPng?: boolean;
  codecChangedReason?: string | null;
}

export function OutputFormatWarning({
  transparencyToJpeg = false,
  photoToPng = false,
  codecChangedReason,
}: OutputFormatWarningProps) {
  const messages = [
    transparencyToJpeg
      ? "JPEGは透過に対応していません。透明部分には指定した背景色が適用されます"
      : null,
    photoToPng ? "PNGへ変換するとファイルサイズが大きくなる可能性があります" : null,
    codecChangedReason,
  ].filter((message): message is string => Boolean(message));
  if (messages.length === 0) return null;

  return (
    <div role="alert" className="grid gap-2">
      {messages.map((message) => (
        <p
          key={message}
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold leading-5 text-amber-900"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {message}
        </p>
      ))}
    </div>
  );
}
