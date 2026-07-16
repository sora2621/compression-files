import { readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import ffmpegStatic from "ffmpeg-static";

import {
  calculateTargetBitratePlan,
  resolutionRecommendations,
  type ResolutionCandidate,
  type ResolutionRecommendation,
  type TargetBitratePlan,
} from "@/features/target-size/domain/video-bitrate";
import {
  defaultTargetCommandRunner,
  TARGET_PROCESS_TIMEOUT_MS,
  type TargetCommandOptions,
  type TargetCommandRunner,
} from "@/infrastructure/ffmpeg/target-command-runner";
import {
  buildSampleExtractionArgs,
  buildTwoPassArgs,
  targetEncoderFor,
  type TargetVideoCodec,
  type TwoPassArguments,
  type TwoPassBuildOptions,
} from "@/infrastructure/ffmpeg/target-size-arguments";
import { LOCAL_MEDIA_PROTOCOLS } from "@/infrastructure/ffmpeg/video-arguments";
import {
  probeTargetMedia,
  type TargetMediaProbe,
} from "@/infrastructure/ffprobe/target-media-probe";
import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError } from "@/lib/errors";
import {
  normalizeProcessingSpeedPreset,
  usesTwoPassVideoEncoding,
} from "@/lib/processing/types";

import { AUDIO_BITRATE_CANDIDATES_KBPS, TARGET_SIZE_LIMITS } from "./config";

import type {
  TargetAudioMode,
  TargetSizeEstimate,
  TargetSizeRecommendationData,
  TargetSizeResult,
} from "./types";

const PROCESS_TIMEOUT_MS = TARGET_PROCESS_TIMEOUT_MS;

export {
  buildSampleExtractionArgs,
  buildTwoPassArgs,
  calculateTargetBitratePlan,
  defaultTargetCommandRunner,
  probeTargetMedia,
  resolutionRecommendations,
};
export type {
  ResolutionCandidate,
  ResolutionRecommendation,
  TargetCommandOptions,
  TargetCommandRunner,
  TargetMediaProbe,
  TargetBitratePlan,
  TargetVideoCodec,
  TwoPassArguments,
  TwoPassBuildOptions,
};

export interface TargetSizeCapabilities {
  ffmpegAvailable: boolean;
  encoders: readonly string[];
  muxers: readonly string[];
}

export interface TargetSample {
  startSeconds: number;
  durationSeconds: number;
  outputBytes: number;
  processingSeconds?: number;
}

interface CommonTargetOptions {
  inputPath: string;
  outputDirectory: string;
  jobId: string;
  targetBytes: number;
  audioMode: TargetAudioMode;
  minimumAudioKbps?: number;
  probe?: TargetMediaProbe;
  capabilities?: TargetSizeCapabilities;
  ffmpegExecutable?: string;
  ffprobeExecutable?: string;
  runner?: TargetCommandRunner;
  signal?: AbortSignal;
  onProgress?: (
    progress: number,
    stage: string,
    attempt: { attempt: number; maxAttempts: number },
  ) => void;
}

export interface OptimizeVideoTargetOptions extends CommonTargetOptions {
  codec?: TargetVideoCodec;
  allowResolutionChange: boolean;
  minimumVideoHeight: number;
  preset?: "veryfast" | "medium" | "slow" | "slower";
  speedPreset?: import("@/lib/processing/types").ProcessingSpeedPreset;
  runSampleEstimate?: boolean;
}

export type OptimizeAudioTargetOptions = CommonTargetOptions;

function boundedRatio(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 && value <= 0.25 ? value : fallback;
}

function safeJobId(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return safe || "target-job";
}

function audioCandidateStart(probe: TargetMediaProbe, audioMode: TargetAudioMode) {
  if (audioMode !== "auto" && audioMode !== "remove") return Number(audioMode);
  const perTrack =
    probe.audioBitrateKbps && probe.audioTrackCount > 0
      ? probe.audioBitrateKbps / probe.audioTrackCount
      : 320;
  return AUDIO_BITRATE_CANDIDATES_KBPS.find((candidate) => candidate <= perTrack) ?? 64;
}

function allowedAudioCandidates(start: number, minimum: number) {
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

export function sampleExtractionWindows(duration: number, sampleSeconds: number) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const length = Math.min(Math.max(0.5, sampleSeconds), duration);
  const starts = [
    0,
    Math.max(0, duration / 2 - length / 2),
    Math.max(0, duration - length),
  ];
  return starts
    .map((start) => Number(start.toFixed(3)))
    .filter((start, index, values) => values.indexOf(start) === index)
    .map((start) => ({ startSeconds: start, durationSeconds: length }));
}

export function estimateFromSamples(
  samples: readonly TargetSample[],
  options: {
    totalDuration: number;
    targetBytes: number;
    originalBytes: number;
    outputFormat?: string;
    codec?: string | null;
    recommendedHeight?: number | null;
    sourceHeight?: number | null;
  },
): TargetSizeEstimate {
  const sampledSeconds = samples.reduce((sum, sample) => sum + sample.durationSeconds, 0);
  const sampledBytes = samples.reduce((sum, sample) => sum + sample.outputBytes, 0);
  if (sampledSeconds <= 0 || options.totalDuration <= 0 || options.originalBytes <= 0) {
    throw new AppError(
      "サンプル推定に必要な情報がありません。",
      422,
      "INVALID_SAMPLE_DATA",
    );
  }
  const estimatedOutputBytes = Math.max(
    1,
    Math.round((sampledBytes / sampledSeconds) * options.totalDuration),
  );
  const ratio = estimatedOutputBytes / options.targetBytes;
  const processingPerSecond =
    samples.reduce((sum, sample) => sum + (sample.processingSeconds ?? 0), 0) /
    sampledSeconds;
  const resolutionChange = Boolean(
    options.recommendedHeight &&
    options.sourceHeight &&
    options.recommendedHeight < options.sourceHeight,
  );
  return {
    originalBytes: options.originalBytes,
    targetBytes: options.targetBytes,
    estimatedOutputBytes,
    estimatedReductionPercent: Number(
      (
        ((options.originalBytes - estimatedOutputBytes) / options.originalBytes) *
        100
      ).toFixed(1),
    ),
    estimatedProcessingSeconds: Math.max(
      1,
      Math.round(
        processingPerSecond > 0
          ? processingPerSecond * options.totalDuration
          : options.totalDuration,
      ),
    ),
    qualityImpact: ratio <= 0.85 ? "small" : ratio <= 1.05 ? "moderate" : "large",
    feasibility:
      ratio <= 1 ? "achievable" : ratio <= 1.1 ? "settings-recommended" : "difficult",
    resolutionChange,
    recommendedHeight: options.recommendedHeight ?? null,
    outputFormat: options.outputFormat ?? "MP4",
    codec: options.codec ?? null,
    message:
      ratio <= 1
        ? "サンプル推定では目標容量を達成できる見込みです。"
        : "サンプル推定では目標を超える可能性があります。設定変更を検討してください。",
  };
}

async function detectCapabilities(): Promise<TargetSizeCapabilities> {
  const runtime = await getRuntimeCapabilities();
  return {
    ffmpegAvailable: runtime.ffmpeg.available,
    encoders: runtime.ffmpeg.encoders,
    muxers: runtime.ffmpeg.muxers,
  };
}

function chooseCodec(
  requested: TargetVideoCodec | undefined,
  capabilities: TargetSizeCapabilities,
) {
  const preferred = requested ? [requested] : (["av1", "h265", "h264"] as const);
  for (const codec of preferred) {
    if (capabilities.encoders.includes(targetEncoderFor(codec))) return codec;
  }
  throw new AppError(
    "H.264、H.265、AV1の利用可能なエンコーダーがありません。",
    503,
    "TARGET_VIDEO_ENCODER_UNAVAILABLE",
  );
}

function targetResult(
  requestedBytes: number,
  originalBytes: number,
  actualBytes: number,
  achieved: boolean,
  details: Partial<TargetSizeResult>,
): TargetSizeResult {
  return {
    requestedBytes,
    actualBytes,
    differenceBytes: actualBytes - requestedBytes,
    achieved,
    originalBytes,
    savedBytes: originalBytes - actualBytes,
    reductionPercent: Number(
      (((originalBytes - actualBytes) / originalBytes) * 100).toFixed(1),
    ),
    attempts: details.attempts ?? 0,
    selectedQuality: details.selectedQuality ?? null,
    selectedResolution: details.selectedResolution ?? null,
    selectedCodec: details.selectedCodec ?? null,
    selectedAudioKbps: details.selectedAudioKbps ?? null,
    reason: details.reason ?? "",
    recommendation: details.recommendation,
  };
}

function recommendation(
  plan: TargetBitratePlan,
  height: number | null,
  codec: string | null,
): TargetSizeRecommendationData {
  return {
    minimumAchievableBytes: Math.ceil(
      ((TARGET_SIZE_LIMITS.minimumVideoKbps + plan.audioBitrateKbpsTotal) *
        1000 *
        plan.durationSeconds) /
        8,
    ),
    recommendedHeight: height,
    recommendedCodec: codec,
    recommendedAudioKbps: plan.audioBitrateKbpsPerTrack,
    impact: plan.reason,
    alternatives: ["lower-resolution", "lower-audio-quality", "change-target"],
  };
}

async function removePasslogs(directory: string, passlogPath: string) {
  const prefix = basename(passlogPath);
  const entries = await readdir(directory).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => unlink(join(directory, name)).catch(() => undefined)),
  );
}

async function safeUnlink(path: string) {
  await unlink(path).catch(() => undefined);
}

export async function optimizeVideoToTargetSize(options: OptimizeVideoTargetOptions) {
  const progress = (value: number, stage: string) =>
    options.onProgress?.(value, stage, { attempt: 1, maxAttempts: 1 });
  progress(0, "動画情報と目標容量を確認中");
  const runner = options.runner ?? defaultTargetCommandRunner;
  const executable = options.ffmpegExecutable ?? process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!executable)
    throw new AppError("FFmpegを利用できません。", 503, "FFMPEG_UNAVAILABLE");
  const probe =
    options.probe ??
    (await probeTargetMedia(
      options.inputPath,
      options.ffprobeExecutable,
      runner,
      options.signal,
    ));
  if (probe.kind !== "video" || !probe.height || !probe.width) {
    throw new AppError("動画ファイルではありません。", 415, "VIDEO_REQUIRED");
  }
  const plan = calculateTargetBitratePlan(probe, options.targetBytes, {
    audioMode: options.audioMode,
    minimumAudioKbps: options.minimumAudioKbps,
  });
  const capabilities = options.capabilities ?? (await detectCapabilities());
  const codec = chooseCodec(options.codec, capabilities);
  if (!capabilities.ffmpegAvailable || !capabilities.muxers.includes("mp4")) {
    throw new AppError(
      "MP4出力を利用できません。",
      503,
      "TARGET_VIDEO_OUTPUT_UNAVAILABLE",
    );
  }
  const resolutions = resolutionRecommendations(probe, plan.videoBitrateKbps, {
    codec,
    allowResolutionChange: options.allowResolutionChange,
    minimumHeight: options.minimumVideoHeight,
  });
  progress(5, "ビットレートと解像度の計画を作成しました");
  if (probe.size <= options.targetBytes) {
    return {
      selectedOutputPath: options.inputPath,
      plan,
      resolution: resolutions,
      result: targetResult(options.targetBytes, probe.size, probe.size, true, {
        selectedResolution: `${probe.width}x${probe.height}`,
        selectedCodec: probe.videoCodec,
        selectedAudioKbps: probe.audioBitrateKbps,
        reason: "元ファイルがすでに目標容量以下のため再エンコードしませんでした。",
      }),
      estimate: undefined,
    };
  }
  if (!plan.feasible) {
    progress(99, "最低品質を維持できないため設定変更が必要です");
    return {
      selectedOutputPath: options.inputPath,
      plan,
      resolution: resolutions,
      result: targetResult(options.targetBytes, probe.size, probe.size, false, {
        reason: plan.reason,
        selectedCodec: probe.videoCodec,
        recommendation: recommendation(plan, resolutions.recommendedHeight, codec),
      }),
      estimate: undefined,
    };
  }
  const jobId = safeJobId(options.jobId);
  const temporaryOutput = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `${jobId}-target.tmp.mp4`,
  );
  const finalOutput = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `${jobId}-target.mp4`,
  );
  const passlogPath = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `${jobId}-passlog`,
  );
  const speedPreset = normalizeProcessingSpeedPreset(options.speedPreset);
  const encoderPreset =
    speedPreset === "fast"
      ? "veryfast"
      : speedPreset === "maximum-compression"
        ? "slow"
        : "medium";
  const useTwoPass = usesTwoPassVideoEncoding(speedPreset);
  const twoPass = buildTwoPassArgs({
    inputPath: options.inputPath,
    outputPath: temporaryOutput,
    passlogPath,
    codec,
    videoBitrateKbps: plan.videoBitrateKbps,
    audioBitrateKbpsPerTrack: plan.audioBitrateKbpsPerTrack,
    removeAudio: plan.removeAudio,
    targetHeight: resolutions.willChangeResolution ? resolutions.selectedHeight : null,
    sourceHeight: probe.height,
    preset: encoderPreset,
    platform: process.platform,
  });
  let estimate: TargetSizeEstimate | undefined;
  const samplePaths: string[] = [];
  let attemptedBytes = probe.size;
  try {
    if (options.runSampleEstimate) {
      progress(8, "先頭・中間・終盤のサンプルを抽出中");
      const windows = sampleExtractionWindows(
        probe.duration,
        TARGET_SIZE_LIMITS.sampleSeconds,
      );
      const samples: TargetSample[] = [];
      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        const samplePath = join(
          /*turbopackIgnore: true*/ options.outputDirectory,
          `${jobId}-sample-${index + 1}.mp4`,
        );
        samplePaths.push(samplePath);
        const startedAt = Date.now();
        await runner(
          executable,
          buildSampleExtractionArgs(
            options.inputPath,
            samplePath,
            window.startSeconds,
            window.durationSeconds,
            codec,
            plan.videoBitrateKbps,
            resolutions.willChangeResolution ? resolutions.selectedHeight : null,
            probe.height,
          ),
          { timeoutMs: PROCESS_TIMEOUT_MS, signal: options.signal },
        );
        const videoBytes = (await stat(samplePath)).size;
        const projectedAudioBytes = Math.round(
          (plan.audioBitrateKbpsTotal * 1000 * window.durationSeconds) / 8,
        );
        samples.push({
          ...window,
          outputBytes: videoBytes + projectedAudioBytes,
          processingSeconds: Math.max(0.001, (Date.now() - startedAt) / 1000),
        });
        progress(
          8 + Math.round(((index + 1) / windows.length) * 12),
          "サンプルから容量を推定中",
        );
      }
      estimate = estimateFromSamples(samples, {
        totalDuration: probe.duration,
        targetBytes: options.targetBytes,
        originalBytes: probe.size,
        outputFormat: "MP4",
        codec,
        recommendedHeight: resolutions.recommendedHeight,
        sourceHeight: probe.height,
      });
      await Promise.all(samplePaths.map(safeUnlink));
    }
    if (!useTwoPass) {
      progress(
        options.runSampleEstimate ? 22 : 10,
        speedPreset === "fast"
          ? "高速目標ビットレートで1パス処理中"
          : "目標ビットレートで1パス処理中",
      );
      const singlePassArgs: string[] = [];
      for (let index = 0; index < twoPass.pass2Args.length; index += 1) {
        const value = twoPass.pass2Args[index];
        if (value === "-pass" || value === "-passlogfile") {
          index += 1;
          continue;
        }
        singlePassArgs.push(value);
      }
      await runner(executable, singlePassArgs, {
        cwd: options.outputDirectory,
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal: options.signal,
      });
    } else {
      progress(options.runSampleEstimate ? 22 : 10, "2パスエンコードの1回目を実行中");
      await runner(executable, twoPass.pass1Args, {
        cwd: options.outputDirectory,
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal: options.signal,
      });
      progress(48, "2パスエンコードの2回目を実行中");
      await runner(executable, twoPass.pass2Args, {
        cwd: options.outputDirectory,
        timeoutMs: PROCESS_TIMEOUT_MS,
        signal: options.signal,
      });
    }
    progress(90, "出力動画の容量と再生情報を検証中");
    const outputProbe = await probeTargetMedia(
      temporaryOutput,
      options.ffprobeExecutable,
      runner,
      options.signal,
    );
    attemptedBytes = (await stat(temporaryOutput)).size;
    if (
      outputProbe.kind !== "video" ||
      outputProbe.duration <= 0 ||
      attemptedBytes <= 0
    ) {
      throw new AppError("出力動画の検証に失敗しました。", 422, "TARGET_OUTPUT_INVALID");
    }
    const achieved = attemptedBytes <= options.targetBytes && attemptedBytes < probe.size;
    if (!achieved) {
      const retryRecommendation = recommendation(
        plan,
        resolutions.recommendedHeight,
        codec,
      );
      retryRecommendation.minimumAchievableBytes = attemptedBytes;
      progress(99, "目標容量を満たさなかったため元ファイルを保持します");
      return {
        selectedOutputPath: options.inputPath,
        plan,
        resolution: resolutions,
        estimate,
        result: targetResult(options.targetBytes, probe.size, probe.size, false, {
          attempts: 1,
          selectedResolution: `${outputProbe.width}x${outputProbe.height}`,
          selectedCodec: codec,
          selectedAudioKbps: plan.audioBitrateKbpsPerTrack,
          reason:
            attemptedBytes > options.targetBytes
              ? "出力が目標容量を超えたため成功扱いにせず、元ファイルを保持しました。"
              : "出力が元ファイル以上の容量になったため採用しませんでした。",
          recommendation: retryRecommendation,
        }),
      };
    }
    await safeUnlink(finalOutput);
    await rename(temporaryOutput, finalOutput);
    progress(100, "目標容量での動画出力が完了しました");
    return {
      selectedOutputPath: finalOutput,
      plan,
      resolution: resolutions,
      estimate,
      result: targetResult(options.targetBytes, probe.size, attemptedBytes, true, {
        attempts: 1,
        selectedResolution: `${outputProbe.width}x${outputProbe.height}`,
        selectedCodec: codec,
        selectedAudioKbps: plan.audioBitrateKbpsPerTrack,
        reason:
          "2パスエンコード後の実容量をffprobeで検証し、目標容量以下であることを確認しました。",
      }),
    };
  } finally {
    await removePasslogs(options.outputDirectory, passlogPath);
    await safeUnlink(temporaryOutput);
    await Promise.all(samplePaths.map(safeUnlink));
  }
}

function chooseAudioKbps(
  probe: TargetMediaProbe,
  targetBytes: number,
  audioMode: TargetAudioMode,
  minimumAudioKbps: number,
) {
  if (audioMode === "remove") return null;
  const gross = (targetBytes * 8) / probe.duration / 1000;
  const usable =
    gross *
    (1 -
      boundedRatio(TARGET_SIZE_LIMITS.safetyMarginRatio, 0.03) -
      boundedRatio(TARGET_SIZE_LIMITS.containerOverheadRatio, 0.015));
  const start = audioCandidateStart(probe, audioMode);
  const trackCount = Math.max(1, probe.audioTrackCount);
  return (
    allowedAudioCandidates(start, minimumAudioKbps).find(
      (candidate) => candidate * trackCount <= usable,
    ) ?? null
  );
}

export async function optimizeAudioToTargetSize(options: OptimizeAudioTargetOptions) {
  const progress = (value: number, stage: string) =>
    options.onProgress?.(value, stage, { attempt: 1, maxAttempts: 1 });
  progress(0, "音声情報と目標容量を確認中");
  const runner = options.runner ?? defaultTargetCommandRunner;
  const executable = options.ffmpegExecutable ?? process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!executable)
    throw new AppError("FFmpegを利用できません。", 503, "FFMPEG_UNAVAILABLE");
  const probe =
    options.probe ??
    (await probeTargetMedia(
      options.inputPath,
      options.ffprobeExecutable,
      runner,
      options.signal,
    ));
  if (probe.kind !== "audio") {
    throw new AppError("音声ファイルではありません。", 415, "AUDIO_REQUIRED");
  }
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
    throw new AppError("再生時間が0秒のファイルは処理できません。", 422, "ZERO_DURATION");
  }
  if (!Number.isFinite(probe.size) || probe.size <= 0) {
    throw new AppError("0バイトのファイルは処理できません。", 422, "EMPTY_FILE");
  }
  if (!Number.isSafeInteger(options.targetBytes) || options.targetBytes <= 0) {
    throw new AppError("目標容量が正しくありません。", 400, "INVALID_TARGET_SIZE");
  }
  if (probe.size <= options.targetBytes) {
    progress(100, "元音声がすでに目標容量以下です");
    return {
      selectedOutputPath: options.inputPath,
      result: targetResult(options.targetBytes, probe.size, probe.size, true, {
        selectedCodec: probe.audioCodecs[0] ?? null,
        selectedAudioKbps: probe.audioBitrateKbps,
        reason: "元ファイルがすでに目標容量以下のため再エンコードしませんでした。",
      }),
    };
  }
  const minimumAudio = Math.max(64, options.minimumAudioKbps ?? 64);
  const audioKbps = chooseAudioKbps(
    probe,
    options.targetBytes,
    options.audioMode,
    minimumAudio,
  );
  progress(10, "目標音声ビットレートを計算しました");
  if (options.audioMode === "remove" || audioKbps === null) {
    progress(99, "最低音質を維持できないため設定変更が必要です");
    const minimumBytes = Math.ceil(
      (64 * Math.max(1, probe.audioTrackCount) * 1000 * probe.duration) / 8,
    );
    return {
      selectedOutputPath: options.inputPath,
      result: targetResult(options.targetBytes, probe.size, probe.size, false, {
        reason:
          options.audioMode === "remove"
            ? "音声ファイルから唯一の音声を削除すると再生可能な出力にならないため処理しませんでした。"
            : "64kbpsでも目標容量を維持できないため処理しませんでした。",
        recommendation: {
          minimumAchievableBytes: minimumBytes,
          recommendedHeight: null,
          recommendedCodec: "AAC",
          recommendedAudioKbps: 64,
          impact: "音声品質の最低値64kbpsを下回る必要があります。",
          alternatives: ["lower-quality-floor", "change-target"],
        },
      }),
    };
  }
  const capabilities = options.capabilities ?? (await detectCapabilities());
  if (!capabilities.ffmpegAvailable || !capabilities.encoders.includes("aac")) {
    throw new AppError("AACエンコーダーを利用できません。", 503, "AAC_UNAVAILABLE");
  }
  const jobId = safeJobId(options.jobId);
  const temporaryOutput = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `${jobId}-audio.tmp.m4a`,
  );
  const finalOutput = join(
    /*turbopackIgnore: true*/ options.outputDirectory,
    `${jobId}-audio.m4a`,
  );
  let attemptedBytes = probe.size;
  try {
    progress(20, "音声を目標ビットレートでエンコード中");
    await runner(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-protocol_whitelist",
        LOCAL_MEDIA_PROTOCOLS,
        "-i",
        options.inputPath,
        "-map",
        "0:a?",
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        `${audioKbps}k`,
        "-map_metadata",
        "-1",
        temporaryOutput,
      ],
      { timeoutMs: PROCESS_TIMEOUT_MS, signal: options.signal },
    );
    progress(85, "出力音声の容量と再生情報を検証中");
    const outputProbe = await probeTargetMedia(
      temporaryOutput,
      options.ffprobeExecutable,
      runner,
      options.signal,
    );
    attemptedBytes = (await stat(temporaryOutput)).size;
    const achieved =
      outputProbe.kind === "audio" &&
      attemptedBytes > 0 &&
      attemptedBytes <= options.targetBytes &&
      attemptedBytes < probe.size;
    if (!achieved) {
      progress(99, "目標容量を満たさなかったため元ファイルを保持します");
      return {
        selectedOutputPath: options.inputPath,
        result: targetResult(options.targetBytes, probe.size, probe.size, false, {
          attempts: 1,
          selectedCodec: "AAC",
          selectedAudioKbps: audioKbps,
          reason:
            attemptedBytes > options.targetBytes
              ? "出力音声が目標容量を超えたため成功扱いにしませんでした。"
              : "出力音声が元ファイル以上の容量になったため採用しませんでした。",
          recommendation: {
            minimumAchievableBytes: attemptedBytes,
            recommendedHeight: null,
            recommendedCodec: "AAC",
            recommendedAudioKbps: audioKbps,
            impact: "実エンコード結果が目標容量を超えました。",
            alternatives: ["lower-audio-quality", "change-target"],
          },
        }),
      };
    }
    await safeUnlink(finalOutput);
    await rename(temporaryOutput, finalOutput);
    progress(100, "目標容量での音声出力が完了しました");
    return {
      selectedOutputPath: finalOutput,
      result: targetResult(options.targetBytes, probe.size, attemptedBytes, true, {
        attempts: 1,
        selectedCodec: "AAC",
        selectedAudioKbps: audioKbps,
        reason: "出力音声をffprobeで検証し、目標容量以下であることを確認しました。",
      }),
    };
  } finally {
    await safeUnlink(temporaryOutput);
  }
}
