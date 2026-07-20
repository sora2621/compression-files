import { USE_CASE_PRESETS } from "./config";

import type {
  FileAnalysisSummary,
  ResolvedUseCasePreset,
  UseCaseId,
  UseCasePresetDefinition,
} from "./types";

const MB = 1024 * 1024;

function formatMb(bytes: number) {
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)}MB`;
}

function targetFor(preset: UseCasePresetDefinition, analysis: FileAnalysisSummary) {
  const imagesOnly = analysis.kinds.length === 1 && analysis.kinds[0] === "image";
  if (imagesOnly && analysis.files.length === 1) return preset.targetMegabytes.image;
  if (imagesOnly) return preset.targetMegabytes.multipleImages;
  return preset.targetMegabytes.mediaTotal;
}

function outputSummary(preset: UseCasePresetDefinition, analysis: FileAnalysisSummary) {
  const formats: string[] = [];
  if (analysis.kinds.includes("image")) {
    formats.push(
      `画像 ${analysis.hasTransparency ? preset.image.transparentFormat : preset.image.photoFormat}`,
    );
  }
  if (analysis.kinds.includes("video"))
    formats.push(`動画 ${preset.video.outputContainer}`);
  if (analysis.kinds.includes("audio")) formats.push(`音声 ${preset.audio.outputFormat}`);
  return formats.join(" / ").toUpperCase();
}

export function recommendUseCase(analysis: FileAnalysisSummary): UseCaseId {
  if (analysis.kinds.includes("video") || analysis.kinds.includes("audio")) {
    return analysis.totalBytes > 20 * MB ? "smartphone" : "social";
  }
  if ((analysis.maxLongEdge ?? 0) >= 4000 && analysis.totalBytes < 12 * MB)
    return "print";
  return "web";
}

export function resolvePreset(
  preset: UseCasePresetDefinition,
  analysis: FileAnalysisSummary,
): ResolvedUseCasePreset {
  const targetMb = targetFor(preset, analysis);
  const targetBytes = targetMb === null ? null : targetMb * MB;
  const needsTarget = targetBytes !== null && analysis.totalBytes > targetBytes;
  const midpoint = (preset.reductionRange[0] + preset.reductionRange[1]) / 2;
  const resizeBoost =
    preset.image.maxLongEdge !== null &&
    (analysis.maxLongEdge ?? 0) > preset.image.maxLongEdge
      ? 8
      : 0;
  const targetReduction = needsTarget ? (1 - targetBytes / analysis.totalBytes) * 100 : 0;
  const estimatedReductionPercent = Math.round(
    Math.min(
      90,
      Math.max(preset.reductionRange[0], midpoint + resizeBoost, targetReduction),
    ),
  );
  const estimatedOutputBytes = Math.min(
    analysis.totalBytes,
    Math.round(analysis.totalBytes * (1 - estimatedReductionPercent / 100)),
  );
  const targetRatio = needsTarget
    ? Math.max(0.01, Math.min(0.99, targetBytes / analysis.totalBytes))
    : 0.5;
  const imageFormat = analysis.hasTransparency
    ? preset.image.transparentFormat
    : preset.image.photoFormat;
  const isLosslessImage =
    imageFormat === "png" ||
    imageFormat === "tiff" ||
    preset.image.encoding === "lossless";
  const effectiveImageMax =
    preset.image.maxLongEdge !== null &&
    (analysis.maxLongEdge ?? 0) > preset.image.maxLongEdge
      ? preset.image.maxLongEdge
      : null;
  const resolutionParts: string[] = [];
  if (analysis.kinds.includes("image")) {
    resolutionParts.push(
      effectiveImageMax ? `画像 長辺${effectiveImageMax}px` : "画像 元サイズ",
    );
  }
  if (analysis.kinds.includes("video")) {
    resolutionParts.push(
      preset.video.resolution === "original"
        ? "動画 元の解像度"
        : `動画 最大${preset.video.resolution}p`,
    );
  }
  const reasons = [
    `${outputSummary(preset, analysis)}は${preset.label}で扱いやすい形式です`,
  ];
  if (analysis.hasTransparency)
    reasons.push("透過を検出したため、透過対応形式を選びました");
  if (effectiveImageMax)
    reasons.push(`表示用途に対して大きいため、長辺${effectiveImageMax}pxまで縮小します`);
  else if (analysis.kinds.includes("image"))
    reasons.push("解像度を下げなくても十分な削減が期待できます");
  if (needsTarget) reasons.push(`${targetMb}MBの目安に収まるよう容量探索を有効にします`);
  if (preset.image.removeMetadata)
    reasons.push("不要な撮影情報を削除し、表示用ICCプロファイルは維持します");

  return {
    id: preset.id,
    label: preset.label,
    description: preset.description,
    optimization: preset.optimization,
    estimatedReductionPercent,
    estimatedOutputBytes,
    estimatedSeconds: Math.max(
      2,
      Math.round(
        (analysis.totalBytes / MB) * preset.secondsPerMb +
          (analysis.maxDuration ?? 0) * 0.18,
      ),
    ),
    settings: {
      processingMode: needsTarget ? "target-size" : preset.processingMode,
      imageFormat,
      imageEncoding: isLosslessImage ? "lossless" : preset.image.encoding,
      imageQuality: preset.image.quality,
      imageMaxDimension: effectiveImageMax,
      speedPreset: preset.speedPreset,
      videoOptions: {
        ...preset.video,
        mode:
          preset.video.resolution === "original" && preset.processingMode === "archive"
            ? "copy"
            : "compress",
        customHeight: null,
      },
      audioOptions: {
        ...preset.audio,
        processingMode: needsTarget ? "target-size" : preset.processingMode,
      },
      targetSizeOptions: {
        enabled: needsTarget,
        presetId:
          preset.id === "email"
            ? "email"
            : preset.id === "web"
              ? "website"
              : preset.id === "social"
                ? "social"
                : preset.id === "smartphone"
                  ? "smartphone"
                  : "custom",
        targetBytes: null,
        targetRatio,
        unit: "MB",
        allowResolutionChange: needsTarget,
        allowLossyForPng: !analysis.hasTransparency,
      },
    },
    summaryRows: [
      { label: "出力形式", value: outputSummary(preset, analysis) },
      ...(analysis.kinds.includes("image")
        ? [
            {
              label: "画質",
              value: isLosslessImage
                ? "可逆（画質を維持）"
                : String(preset.image.quality),
            },
          ]
        : []),
      { label: "解像度", value: resolutionParts.join(" / ") || "元のサイズを維持" },
      ...(analysis.kinds.includes("video")
        ? [
            {
              label: "映像・音声",
              value: `${preset.video.codec.toUpperCase()} / ${preset.video.audio.toUpperCase()}`,
            },
          ]
        : []),
      {
        label: "メタデータ",
        value: preset.image.removeMetadata ? "不要な情報を削除" : "保持を優先",
      },
      ...(analysis.kinds.includes("image")
        ? [{ label: "透過", value: analysis.hasTransparency ? "維持" : "なし" }]
        : []),
      ...(needsTarget && targetBytes
        ? [{ label: "目標容量", value: `${formatMb(targetBytes)}以下` }]
        : []),
    ],
    reasons,
  };
}

export function resolveAllPresets(analysis: FileAnalysisSummary) {
  return USE_CASE_PRESETS.map((preset) => resolvePreset(preset, analysis));
}
