"use client";

import { FileOutput } from "lucide-react";

import { createCompressedFileName } from "@/shared/files/create-compressed-file-name";
import { getOutputFormatDefinition } from "@/shared/media/output-formats";

interface OutputFileNamePreviewProps {
  originalFileName: string;
  outputFormat: string;
}

export function OutputFileNamePreview({
  originalFileName,
  outputFormat,
}: OutputFileNamePreviewProps) {
  const definition = getOutputFormatDefinition(outputFormat);
  if (!definition) return null;
  const fileName = createCompressedFileName(originalFileName, definition.extension);
  return (
    <p className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-700">
      <FileOutput size={14} className="shrink-0 text-indigo-600" />
      <span className="truncate">保存予定名: {fileName}</span>
    </p>
  );
}
