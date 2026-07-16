import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const loaded = { exports: {} };
  moduleCache.set(absolutePath, loaded);
  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const localRequire = (specifier) => {
    if (specifier === "ffmpeg-static") return "ffmpeg";
    if (specifier === "ffprobe-static") return { path: "ffprobe" };
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) {
      return nativeRequire(specifier);
    }
    const base = specifier.startsWith("@/")
      ? resolve(root, specifier.slice(2))
      : resolve(dirname(absolutePath), specifier);
    return loadTypeScriptModule(extname(base) ? base : `${base}.ts`);
  };
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(
    localRequire,
    loaded,
    loaded.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return loaded.exports;
}

const paths = loadTypeScriptModule("lib/processing/path.ts");
const videoArguments = loadTypeScriptModule("infrastructure/ffmpeg/video-arguments.ts");
const hardware = loadTypeScriptModule("lib/capabilities/hardware-acceleration.ts");
const scheduler = loadTypeScriptModule("lib/jobs/processing-scheduler.ts");
const processingTypes = loadTypeScriptModule("lib/processing/types.ts");
const videoPerformance = loadTypeScriptModule("lib/performance/video-performance.ts");

const baseVideo = {
  mode: "compress",
  resolution: "720",
  customHeight: null,
  codec: "h264",
  quality: "balanced",
  audio: "copy",
  removeMetadata: true,
  outputContainer: "mp4",
  enhancements: {
    denoise: "hqdn3d",
    sharpen: "unsharp",
    brightness: 0,
    contrast: 1,
    saturation: 1,
    colorCorrection: false,
  },
  upscaleMode: "simple",
  frameRate: "original",
  speedPreset: "balanced",
};

test("処理経路は再エンコード不要・動画変換・AIを明示的に区別する", () => {
  assert.deepEqual(
    paths.decideVideoProcessingPath({
      ...baseVideo,
      mode: "copy",
      resolution: "original",
      enhancements: { ...baseVideo.enhancements, denoise: "none", sharpen: "none" },
    }),
    { type: "stream-copy" },
  );
  assert.deepEqual(paths.decideVideoProcessingPath(baseVideo), {
    type: "software-encode",
    encoder: "libx264",
  });
  assert.deepEqual(
    paths.decideVideoProcessingPath(baseVideo, { hardwareEncoder: "h264_nvenc" }),
    { type: "hardware-encode", encoder: "h264_nvenc" },
  );
  assert.deepEqual(paths.decideVideoProcessingPath({ ...baseVideo, upscaleMode: "ai" }), {
    type: "ai-enhancement",
  });
  assert.equal(
    paths.decideVideoProcessingPath(baseVideo, {
      originalBytes: 1_000,
      targetBytes: 1_000,
    }).type,
    "return-original",
  );
  assert.equal(
    paths.decideImageProcessingPath({ originalBytes: 100, targetBytes: 100 }).type,
    "return-original",
  );
});

test("速度プリセットはCRFを維持し、エンコーダー努力量だけを変更する", () => {
  const balanced = videoArguments.buildFfmpegArgs("input", "output.mp4", baseVideo);
  const fast = videoArguments.buildFfmpegArgs("input", "output.mp4", {
    ...baseVideo,
    speedPreset: "fast",
  });
  const maximum = videoArguments.buildFfmpegArgs("input", "output.mp4", {
    ...baseVideo,
    speedPreset: "maximum-compression",
  });
  const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];
  assert.equal(valueAfter(balanced.args, "-crf"), "23");
  assert.equal(valueAfter(fast.args, "-crf"), "23");
  assert.equal(valueAfter(maximum.args, "-crf"), "23");
  assert.equal(valueAfter(balanced.args, "-preset"), "medium");
  assert.equal(valueAfter(fast.args, "-preset"), "veryfast");
  assert.equal(valueAfter(maximum.args, "-preset"), "slow");
  assert.equal(fast.args.filter((value) => value === "-vf").length, 1);
  assert.match(valueAfter(fast.args, "-vf"), /scale=.*hqdn3d.*unsharp/);
  assert.equal(valueAfter(fast.args, "-c:a"), "copy");

  const qsv = videoArguments.buildFfmpegArgs(
    "input",
    "output.mp4",
    { ...baseVideo, speedPreset: "fast" },
    { hardwareEncoder: "h264_qsv" },
  );
  assert.equal(valueAfter(qsv.args, "-preset"), "veryfast");
  assert.equal(valueAfter(qsv.args, "-global_quality"), "23");
});

test("同じ解像度と無効な補正は不要なフィルターを追加しない", () => {
  const command = videoArguments.buildFfmpegArgs(
    "input.mp4",
    "output.mp4",
    {
      ...baseVideo,
      resolution: "1080",
      enhancements: {
        denoise: "none",
        sharpen: "none",
        brightness: 0,
        contrast: 1,
        saturation: 1,
        colorCorrection: false,
      },
    },
    { sourceHeight: 1080 },
  );
  assert.equal(command.args.includes("-vf"), false);
  assert.equal(command.args.includes("hqdn3d"), false);
  assert.equal(command.args.includes("unsharp"), false);
  assert.equal(command.args.filter((value) => value === "output.mp4").length, 1);
});

test("使用可能なGPUだけを採用し、非対応エンコーダーをCPU経路へ残さない", async () => {
  hardware.clearHardwareAccelerationCache();
  const result = await hardware.detectHardwareAcceleration({
    executable: "ffmpeg-performance-test",
    APIs: ["cuda", "qsv"],
    encoders: ["h264_nvenc", "h264_qsv"],
    force: true,
    runner: async (_executable, args) => {
      if (args.includes("h264_nvenc")) throw new Error("GPU unavailable");
      return { stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(result.usableEncoders, ["h264_qsv"]);
  assert.equal(hardware.selectHardwareEncoder("h264", result), "h264_qsv");
  assert.equal(hardware.selectHardwareEncoder("h265", result), undefined);

  assert.equal(
    hardware.selectHardwareEncoder("h264", {
      APIs: ["cuda"],
      compiledEncoders: ["h264_nvenc"],
      usableEncoders: ["h264_nvenc"],
      gpuCount: 1,
    }),
    "h264_nvenc",
  );
  assert.equal(
    hardware.selectHardwareEncoder("h264", {
      APIs: ["cuda"],
      compiledEncoders: ["h264_nvenc"],
      usableEncoders: [],
      gpuCount: 0,
    }),
    undefined,
  );
  assert.equal(
    hardware.selectHardwareEncoder("av1", {
      APIs: ["cuda"],
      compiledEncoders: ["av1_nvenc"],
      usableEncoders: ["av1_nvenc"],
      gpuCount: 1,
    }),
    "av1_nvenc",
  );
});

test("GPU初期化失敗時はCPU処理へ1回だけフォールバックする", async () => {
  const mediaVideo = loadTypeScriptModule("lib/media/video.ts");
  const calls = [];
  const result = await mediaVideo.runVideoEncoderWithFallback({
    hardwareEncoder: "h264_nvenc",
    runHardware: async () => {
      calls.push("gpu");
      throw new Error("GPU init failed");
    },
    runSoftware: async () => {
      calls.push("cpu");
      return "completed";
    },
  });
  assert.deepEqual(calls, ["gpu", "cpu"]);
  assert.equal(result.value, "completed");
  assert.equal(result.hardwareFallback, true);
});

test("CPU動画ジョブは直列化され、FIFOで後続ジョブが追い越さない", async () => {
  const order = [];
  let active = 0;
  let maximumActive = 0;
  await Promise.all(
    [1, 2, 3].map((id) =>
      scheduler.runScheduledProcessingJob("videoCpu", async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        order.push(`start-${id}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        order.push(`end-${id}`);
        active -= 1;
      }),
    ),
  );
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2", "start-3", "end-3"]);
});

test("AIワーカーは常駐しモデルを再利用し、推論モードと動的タイルを使う", () => {
  const worker = readFileSync(resolve(root, "workers/ai_image_worker.py"), "utf8");
  const client = readFileSync(resolve(root, "lib/ai/ai-worker-client.ts"), "utf8");
  assert.match(worker, /PROCESSOR_CACHE/);
  assert.match(worker, /torch\.inference_mode\(\)/);
  assert.match(worker, /get_device_properties/);
  assert.match(worker, /def serve\(\)/);
  assert.match(client, /compressionFilesAiWorker/);
  assert.match(client, /\[worker, "--serve"\]/);
  assert.match(client, /shell: false/);
});

test("高速・バランスは1パス、高圧縮だけが2パスを使用する", () => {
  const target = readFileSync(resolve(root, "lib/target-size/video-target.ts"), "utf8");
  assert.equal(processingTypes.usesTwoPassVideoEncoding("fast"), false);
  assert.equal(processingTypes.usesTwoPassVideoEncoding("balanced"), false);
  assert.equal(processingTypes.usesTwoPassVideoEncoding("maximum-compression"), true);
  assert.match(target, /if \(!useTwoPass\)/);
  assert.match(target, /目標ビットレートで1パス処理中/);
  assert.match(target, /2パスエンコードの1回目を実行中/);
  assert.match(target, /removePasslogs/);
});

test("動画性能メトリクスは個人情報なしで平均FPS・速度・検証時間を集計する", () => {
  const initial = videoPerformance.createVideoPerformanceMetrics({
    jobId: "job-1",
    encoder: "libx264",
    processingMode: "compress",
    inputDurationSeconds: 10,
    encodingMilliseconds: 4000,
    fpsSamples: [60, 120],
    speedSamples: [2, 4],
  });
  const completed = videoPerformance.withVideoOutputValidation(initial, 100);
  assert.equal(completed.averageEncodingFps, 90);
  assert.equal(completed.averageSpeedRatio, 3);
  assert.equal(completed.outputValidationMilliseconds, 100);
  assert.equal(completed.totalMilliseconds, 4100);
  assert.equal("fileName" in completed, false);
  assert.equal("path" in completed, false);
});

test("画像は既取得メタデータをSharpへ渡し、同じヘッダー解析を繰り返さない", () => {
  const media = readFileSync(resolve(root, "lib/media/image.ts"), "utf8");
  const sharpService = readFileSync(
    resolve(root, "infrastructure/sharp/image-service.ts"),
    "utf8",
  );
  assert.match(media, /encodeImage\(options, sourceMetadata\)/);
  assert.match(sharpService, /request\.sourceMetadata \?\?/);
});
