import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import ffmpegStatic from "ffmpeg-static";
import { NextResponse } from "next/server";

import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { AppError, errorResponse } from "@/lib/errors";
import { getStagedMedia } from "@/lib/storage/temp-storage";
import { TARGET_SIZE_LIMITS } from "@/lib/target-size/config";
import { targetProbeFromInspection } from "@/lib/target-size/inspection-probe";
import {
  isTargetSizeOptions,
  resolveTargetBytes,
  type TargetSizeOptions,
} from "@/lib/target-size/types";
import {
  buildSampleExtractionArgs,
  calculateTargetBitratePlan,
  defaultTargetCommandRunner,
  estimateFromSamples,
  resolutionRecommendations,
  sampleExtractionWindows,
  type TargetSample,
  type TargetVideoCodec,
} from "@/lib/target-size/video-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface EstimateRequest {
  uploadId?: unknown;
  targetSizeOptions?: unknown;
  codec?: unknown;
}

function requestedCodec(value: unknown): TargetVideoCodec {
  return value === "h265" || value === "av1" ? value : "h264";
}

export async function POST(request: Request) {
  let body: EstimateRequest;
  try {
    body = (await request.json()) as EstimateRequest;
  } catch {
    return NextResponse.json(
      { error: "推定設定を読み取れませんでした。", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  try {
    if (typeof body.uploadId !== "string") {
      throw new AppError("動画アップロードIDがありません。", 400, "UPLOAD_ID_REQUIRED");
    }
    if (!isTargetSizeOptions(body.targetSizeOptions) || !body.targetSizeOptions.enabled) {
      throw new AppError("目標容量を指定してください。", 400, "TARGET_SIZE_REQUIRED");
    }
    const targetOptions = body.targetSizeOptions as TargetSizeOptions;
    const staged = await getStagedMedia(body.uploadId);
    if (staged.manifest.mediaInfo.kind !== "video") {
      throw new AppError("サンプル推定は動画で利用できます。", 415, "VIDEO_REQUIRED");
    }
    const executable = process.env.FFMPEG_PATH ?? ffmpegStatic;
    if (!executable) {
      throw new AppError("FFmpegを利用できません。", 503, "FFMPEG_UNAVAILABLE");
    }
    const probe = targetProbeFromInspection(
      staged.manifest.mediaInfo,
      staged.manifest.size,
    );
    const targetBytes = resolveTargetBytes(targetOptions, staged.manifest.size);
    const plan = calculateTargetBitratePlan(probe, targetBytes, {
      audioMode: targetOptions.audioMode,
      minimumAudioKbps: targetOptions.minimumQuality.audioKbps,
    });
    const runtimeCapabilities = await getRuntimeCapabilities();
    const requested = requestedCodec(body.codec);
    const encoder =
      requested === "h264" ? "libx264" : requested === "h265" ? "libx265" : "libaom-av1";
    const codec: TargetVideoCodec = runtimeCapabilities.ffmpeg.encoders.includes(encoder)
      ? requested
      : "h264";
    if (!runtimeCapabilities.ffmpeg.encoders.includes("libx264") && codec === "h264") {
      throw new AppError(
        "サンプル推定に利用できる動画エンコーダーがありません。",
        503,
        "ENCODER_UNAVAILABLE",
      );
    }
    const resolution = resolutionRecommendations(probe, plan.videoBitrateKbps, {
      codec,
      allowResolutionChange: targetOptions.allowResolutionChange,
      minimumHeight: targetOptions.minimumQuality.videoHeight,
    });
    const windows = sampleExtractionWindows(
      probe.duration,
      TARGET_SIZE_LIMITS.sampleSeconds,
    );
    const samplePaths: string[] = [];
    try {
      const samples: TargetSample[] = [];
      for (let index = 0; index < windows.length; index += 1) {
        const window = windows[index];
        const samplePath = join(
          /*turbopackIgnore: true*/ staged.directory,
          `target-estimate-${index + 1}.mp4`,
        );
        samplePaths.push(samplePath);
        const startedAt = Date.now();
        await defaultTargetCommandRunner(
          executable,
          buildSampleExtractionArgs(
            staged.inputPath,
            samplePath,
            window.startSeconds,
            window.durationSeconds,
            codec,
            plan.videoBitrateKbps,
            resolution.willChangeResolution ? resolution.selectedHeight : null,
            probe.height ?? resolution.sourceHeight,
          ),
          { timeoutMs: 120_000, signal: request.signal },
        );
        const sampleBytes = (await stat(samplePath)).size;
        const audioBytes = Math.round(
          (plan.audioBitrateKbpsTotal * 1_000 * window.durationSeconds) / 8,
        );
        samples.push({
          ...window,
          outputBytes: sampleBytes + audioBytes,
          processingSeconds: Math.max(0.001, (Date.now() - startedAt) / 1_000),
        });
      }
      const estimate = estimateFromSamples(samples, {
        totalDuration: probe.duration,
        targetBytes,
        originalBytes: staged.manifest.size,
        outputFormat: "MP4",
        codec,
        recommendedHeight: resolution.recommendedHeight,
        sourceHeight: probe.height,
      });
      return NextResponse.json({
        estimate,
        plan: {
          grossBitrateKbps: plan.grossBitrateKbps,
          videoBitrateKbps: plan.videoBitrateKbps,
          audioBitrateKbps: plan.audioBitrateKbpsPerTrack,
          safetyMarginKbps: plan.safetyMarginKbps,
          containerOverheadKbps: plan.containerOverheadKbps,
        },
        sampledSections: windows.length,
      });
    } finally {
      await Promise.all(samplePaths.map((path) => unlink(path).catch(() => undefined)));
    }
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
