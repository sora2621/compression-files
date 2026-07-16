import { AppError } from "@/lib/errors";
import {
  AUDIO_BITRATE_CANDIDATES_KBPS,
  TARGET_SIZE_LIMITS,
  VIDEO_HEIGHT_CANDIDATES,
} from "@/lib/target-size/config";

import type { TargetAudioMode } from "@/lib/target-size/types";

export type DomainTargetVideoCodec = "h264" | "h265" | "av1";

export interface TargetMediaFacts {
  kind: "video" | "audio";
  duration: number;
  size: number;
  audioBitrateKbps: number | null;
  audioTrackCount: number;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface TargetBitratePlan {
  targetBytes: number;
  durationSeconds: number;
  grossBitrateKbps: number;
  usableBitrateKbps: number;
  safetyMarginKbps: number;
  containerOverheadKbps: number;
  videoBitrateKbps: number;
  audioBitrateKbpsPerTrack: number | null;
  audioBitrateKbpsTotal: number;
  audioTrackCount: number;
  removeAudio: boolean;
  feasible: boolean;
  reason: string;
}

export interface ResolutionCandidate {
  height: number;
  width: number;
  estimatedMinimumVideoKbps: number;
  sourceResolution: boolean;
}

export interface ResolutionRecommendation {
  candidates: ResolutionCandidate[];
  sourceHeight: number;
  selectedHeight: number;
  recommendedHeight: number | null;
  willChangeResolution: boolean;
  reason: string;
}

export function boundedTargetRatio(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 && value <= 0.25 ? value : fallback;
}

export function calculateGrossTargetBitrate(
  targetBytes: number,
  durationSeconds: number,
) {
  return (targetBytes * 8) / durationSeconds / 1000;
}

export function calculateSafetyMargin(grossBitrateKbps: number, ratio: number) {
  return grossBitrateKbps * ratio;
}

export function calculateAvailableVideoBitrate(options: {
  grossBitrateKbps: number;
  safetyMarginKbps: number;
  containerOverheadKbps: number;
  audioBitrateKbpsTotal: number;
}) {
  return Math.max(
    0,
    options.grossBitrateKbps -
      options.safetyMarginKbps -
      options.containerOverheadKbps -
      options.audioBitrateKbpsTotal,
  );
}

function audioCandidateStart(probe: TargetMediaFacts, audioMode: TargetAudioMode) {
  if (audioMode !== "auto" && audioMode !== "remove") {
    return Number(audioMode);
  }
  const perTrack =
    probe.audioBitrateKbps && probe.audioTrackCount > 0
      ? probe.audioBitrateKbps / probe.audioTrackCount
      : 320;
  return AUDIO_BITRATE_CANDIDATES_KBPS.find((candidate) => candidate <= perTrack) ?? 64;
}

export function allowedAudioBitrateCandidates(start: number, minimum: number) {
  const floor = AUDIO_BITRATE_CANDIDATES_KBPS.includes(
    minimum as (typeof AUDIO_BITRATE_CANDIDATES_KBPS)[number],
  )
    ? minimum
    : 64;
  const candidates = AUDIO_BITRATE_CANDIDATES_KBPS.filter(
    (candidate) => candidate <= start && candidate >= floor,
  );
  return candidates.length ? candidates : [floor];
}

export function calculateAudioBitrate(
  probe: TargetMediaFacts,
  options: {
    audioMode: TargetAudioMode;
    minimumAudioKbps: number;
    usableBitrateKbps: number;
    minimumVideoKbps: number;
  },
) {
  const removeAudio = options.audioMode === "remove" || probe.audioTrackCount === 0;
  const trackCount = removeAudio ? 0 : Math.max(1, probe.audioTrackCount);
  if (removeAudio) {
    return { perTrackKbps: null, totalKbps: 0, trackCount, removeAudio };
  }

  const candidates = allowedAudioBitrateCandidates(
    audioCandidateStart(probe, options.audioMode),
    options.minimumAudioKbps,
  );
  let perTrackKbps = candidates.at(-1) ?? 64;
  for (const candidate of candidates) {
    if (options.usableBitrateKbps - candidate * trackCount >= options.minimumVideoKbps) {
      perTrackKbps = candidate;
      break;
    }
  }
  return {
    perTrackKbps,
    totalKbps: perTrackKbps * trackCount,
    trackCount,
    removeAudio,
  };
}

export function calculateTargetVideoBitrate(
  usableBitrateKbps: number,
  audioBitrateKbpsTotal: number,
  minimumVideoKbps: number,
) {
  return Math.max(
    minimumVideoKbps,
    Math.floor(usableBitrateKbps - audioBitrateKbpsTotal),
  );
}

export function calculateTargetBitratePlan(
  probe: TargetMediaFacts,
  targetBytes: number,
  options: {
    audioMode: TargetAudioMode;
    minimumAudioKbps?: number;
    safetyMarginRatio?: number;
    containerOverheadRatio?: number;
  },
): TargetBitratePlan {
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new AppError("再生時間が0秒のファイルは処理できません。", 422, "ZERO_DURATION");
  }
  if (!Number.isFinite(probe.size) || probe.size <= 0) {
    throw new AppError("0バイトのファイルは処理できません。", 422, "EMPTY_FILE");
  }
  if (!Number.isSafeInteger(targetBytes) || targetBytes <= 0) {
    throw new AppError("目標容量が正しくありません。", 400, "INVALID_TARGET_SIZE");
  }

  const safetyRatio = boundedTargetRatio(
    options.safetyMarginRatio ?? TARGET_SIZE_LIMITS.safetyMarginRatio,
    0.03,
  );
  const overheadRatio = boundedTargetRatio(
    options.containerOverheadRatio ?? TARGET_SIZE_LIMITS.containerOverheadRatio,
    0.015,
  );
  const grossBitrateKbps = calculateGrossTargetBitrate(targetBytes, probe.duration);
  const safetyMarginKbps = calculateSafetyMargin(grossBitrateKbps, safetyRatio);
  const containerOverheadKbps = calculateSafetyMargin(grossBitrateKbps, overheadRatio);
  const usableBitrateKbps = calculateAvailableVideoBitrate({
    grossBitrateKbps,
    safetyMarginKbps,
    containerOverheadKbps,
    audioBitrateKbpsTotal: 0,
  });
  const audio = calculateAudioBitrate(probe, {
    audioMode: options.audioMode,
    minimumAudioKbps: options.minimumAudioKbps ?? 64,
    usableBitrateKbps,
    minimumVideoKbps: TARGET_SIZE_LIMITS.minimumVideoKbps,
  });
  const availableVideoKbps = calculateAvailableVideoBitrate({
    grossBitrateKbps,
    safetyMarginKbps,
    containerOverheadKbps,
    audioBitrateKbpsTotal: audio.totalKbps,
  });
  const videoBitrateKbps = calculateTargetVideoBitrate(
    usableBitrateKbps,
    audio.totalKbps,
    TARGET_SIZE_LIMITS.minimumVideoKbps,
  );
  const feasible =
    probe.kind === "audio"
      ? usableBitrateKbps >= (audio.perTrackKbps ?? 64)
      : availableVideoKbps >= TARGET_SIZE_LIMITS.minimumVideoKbps;

  return {
    targetBytes,
    durationSeconds: probe.duration,
    grossBitrateKbps: Number(grossBitrateKbps.toFixed(1)),
    usableBitrateKbps: Number(usableBitrateKbps.toFixed(1)),
    safetyMarginKbps: Number(safetyMarginKbps.toFixed(1)),
    containerOverheadKbps: Number(containerOverheadKbps.toFixed(1)),
    videoBitrateKbps,
    audioBitrateKbpsPerTrack: audio.perTrackKbps,
    audioBitrateKbpsTotal: audio.totalKbps,
    audioTrackCount: audio.trackCount,
    removeAudio: audio.removeAudio,
    feasible,
    reason: feasible
      ? "安全マージンとコンテナオーバーヘッド、音声容量を差し引いて算出しました。"
      : "最低品質を維持できるビットレートが残らないため、現在の条件では達成困難です。",
  };
}

function codecEfficiency(codec: DomainTargetVideoCodec) {
  return codec === "av1" ? 0.48 : codec === "h265" ? 0.62 : 1;
}

export function minimumBitrateForHeight(
  height: number,
  codec: DomainTargetVideoCodec,
  fps: number,
) {
  const h264Base =
    height >= 2160
      ? 12_000
      : height >= 1440
        ? 7_000
        : height >= 1080
          ? 4_000
          : height >= 720
            ? 2_000
            : 900;
  const fpsFactor = Math.min(2, Math.max(0.75, fps / 30));
  return Math.round(h264Base * codecEfficiency(codec) * fpsFactor);
}

export function generateResolutionCandidates(
  probe: Pick<TargetMediaFacts, "width" | "height" | "fps">,
  options: { codec: DomainTargetVideoCodec; minimumHeight: number },
) {
  if (!probe.width || !probe.height) {
    throw new AppError("動画の解像度を取得できません。", 422, "VIDEO_INFO_INCOMPLETE");
  }
  const sourceHeight = probe.height;
  const heights = [
    sourceHeight,
    ...VIDEO_HEIGHT_CANDIDATES.filter(
      (height) => height < sourceHeight && height >= options.minimumHeight,
    ),
  ].filter((height, index, values) => values.indexOf(height) === index);
  return heights.map((height): ResolutionCandidate => ({
    height,
    width: Math.max(2, Math.round((probe.width! * height) / sourceHeight / 2) * 2),
    estimatedMinimumVideoKbps: minimumBitrateForHeight(
      height,
      options.codec,
      probe.fps ?? 30,
    ),
    sourceResolution: height === sourceHeight,
  }));
}

export function resolutionRecommendations(
  probe: TargetMediaFacts,
  videoBitrateKbps: number,
  options: {
    codec: DomainTargetVideoCodec;
    allowResolutionChange: boolean;
    minimumHeight: number;
  },
): ResolutionRecommendation {
  const candidates = generateResolutionCandidates(probe, options);
  const sourceHeight = probe.height!;
  const sourceSustainable = videoBitrateKbps >= candidates[0].estimatedMinimumVideoKbps;
  const lower = sourceSustainable
    ? undefined
    : (candidates
        .slice(1)
        .find((candidate) => videoBitrateKbps >= candidate.estimatedMinimumVideoKbps) ??
      (candidates.length > 1 ? candidates.at(-1) : undefined));
  const recommendedHeight = lower?.height ?? null;
  const selectedHeight =
    options.allowResolutionChange && recommendedHeight ? recommendedHeight : sourceHeight;
  return {
    candidates,
    sourceHeight,
    selectedHeight,
    recommendedHeight,
    willChangeResolution: selectedHeight < sourceHeight,
    reason: sourceSustainable
      ? "元の解像度を維持できる見込みです。"
      : options.allowResolutionChange
        ? recommendedHeight
          ? `${recommendedHeight}pへの変更で画質低下を抑えやすくなります。`
          : "最低解像度でも品質維持が難しいため、目標容量の変更を提案します。"
        : recommendedHeight
          ? `${recommendedHeight}pへの変更を提案しますが、自動変更は行いません。`
          : "解像度は自動変更せず、目標容量の変更を提案します。",
  };
}
