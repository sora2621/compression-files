import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";

import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import sharp from "sharp";
import ts from "typescript";

import { runCommand } from "./process-runner.mjs";

const root = process.cwd();
const labelIndex = process.argv.indexOf("--label");
const label = labelIndex >= 0 ? process.argv[labelIndex + 1] : "manual";
const speedIndex = process.argv.indexOf("--speed");
const speedPreset = speedIndex >= 0 ? process.argv[speedIndex + 1] : "balanced";
const hardwareIndex = process.argv.indexOf("--hardware");
const hardwareEncoder = hardwareIndex >= 0 ? process.argv[hardwareIndex + 1] : undefined;
if (!/^[a-z0-9_-]{1,32}$/i.test(label ?? "")) throw new Error("invalid benchmark label");
if (!["fast", "balanced", "maximum-compression"].includes(speedPreset)) {
  throw new Error("invalid speed preset");
}
if (!ffmpegPath || !ffprobeStatic.path) throw new Error("FFmpeg/ffprobe is unavailable");

const fixtureDirectory = join(root, ".benchmark", "fixtures");
const workDirectory = join(root, ".benchmark", "work", label);
const resultDirectory = join(root, "benchmarks", "results");
const resultPath = join(resultDirectory, `${label}.jsonl`);
const fixtures = {
  smallJpeg: join(fixtureDirectory, "small-jpeg.jpg"),
  largeJpeg: join(fixtureDirectory, "large-jpeg.jpg"),
  transparentPng: join(fixtureDirectory, "transparent.png"),
  webp: join(fixtureDirectory, "source.webp"),
  video10s: join(fixtureDirectory, "video-1080p-10s.mp4"),
  video60s: join(fixtureDirectory, "video-1080p-60s.mp4"),
  video4k: join(fixtureDirectory, "video-4k-5s.mp4"),
  audio: join(fixtureDirectory, "audio-30s.wav"),
  aiImage: join(fixtureDirectory, "ai-source.png"),
};

const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();
function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const source = nativeRequire("node:fs").readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const localRequire = (specifier) => {
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
    loadedModule,
    loadedModule.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return loadedModule.exports;
}

const records = [];
function record(value) {
  const entry = Object.freeze({ benchmark: label, ...value });
  records.push(entry);
  console.log(JSON.stringify(entry));
}

function benchmarkArgs(args) {
  const next = [...args];
  const logLevelIndex = next.indexOf("-loglevel");
  if (logLevelIndex >= 0) next[logLevelIndex + 1] = "info";
  next.splice(1, 0, "-benchmark", "-benchmark_all");
  return next;
}

function ffmpegBenchMilliseconds(stderr, stage) {
  const expression = new RegExp(
    `bench:\\s+\\d+ user\\s+\\d+ sys\\s+(\\d+) real ${stage}`,
    "g",
  );
  let totalMicroseconds = 0;
  for (const match of stderr.matchAll(expression)) totalMicroseconds += Number(match[1]);
  return Number((totalMicroseconds / 1_000).toFixed(3));
}

function averageProgressValue(stdout, key, suffix = "") {
  const expression = new RegExp(`^${key}=([0-9.]+)${suffix}$`, "gm");
  const values = [...stdout.matchAll(expression)].map((match) => Number(match[1]));
  if (values.length === 0) return undefined;
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3),
  );
}

async function measure(caseId, stage, operation, details = {}) {
  const startedAt = performance.now();
  try {
    const value = await operation();
    const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
    record({
      type: "benchmark-stage",
      caseId,
      stage,
      elapsedMs,
      status: "ok",
      ...details,
    });
    return { value, elapsedMs };
  } catch (error) {
    const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
    record({
      type: "benchmark-stage",
      caseId,
      stage,
      elapsedMs,
      status: "error",
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
      ...details,
    });
    throw error;
  }
}

function baseVideoOptions(mode = "compress") {
  return {
    mode,
    resolution: mode === "compress" ? "720" : "original",
    customHeight: null,
    codec: "h264",
    quality: "balanced",
    audio: "copy",
    removeMetadata: true,
    outputContainer: "mp4",
    enhancements: {
      denoise: mode === "compress" ? "hqdn3d" : "none",
      sharpen: mode === "compress" ? "unsharp" : "none",
      brightness: 0,
      contrast: 1,
      saturation: 1,
      colorCorrection: false,
    },
    upscaleMode: "simple",
    frameRate: "original",
    speedPreset,
  };
}

async function calculatePsnr(sourcePath, outputPath) {
  const [source, output] = await Promise.all([
    sharp(sourcePath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    source.info.width !== output.info.width ||
    source.info.height !== output.info.height ||
    source.data.length !== output.data.length
  )
    return null;
  let squaredError = 0;
  for (let index = 0; index < source.data.length; index += 1) {
    const difference = source.data[index] - output.data[index];
    squaredError += difference * difference;
  }
  if (squaredError === 0) return "infinite";
  const mse = squaredError / source.data.length;
  return Number((10 * Math.log10((255 * 255) / mse)).toFixed(3));
}

async function pixelsEqual(sourcePath, outputPath) {
  const [source, output] = await Promise.all([
    sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  return (
    source.info.width === output.info.width &&
    source.info.height === output.info.height &&
    source.data.equals(output.data)
  );
}

async function removeBenchmarkWork() {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(workDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 125 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function videoSsim(sourcePath, outputPath) {
  const result = await runCommand(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-i",
    sourcePath,
    "-i",
    outputPath,
    "-lavfi",
    "[0:v]scale=-2:720:flags=lanczos[reference];[reference][1:v]ssim",
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const match = result.stderr
    .match(/All:([0-9.]+)/g)
    ?.at(-1)
    ?.match(/All:([0-9.]+)/);
  return match ? Number(match[1]) : null;
}

async function probe(path) {
  const result = await runCommand(ffprobeStatic.path, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-show_chapters",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(result.stdout);
}

await mkdir(workDirectory, { recursive: true });
await mkdir(resultDirectory, { recursive: true });
for (const [fixtureId, path] of Object.entries(fixtures)) {
  const info = await stat(path);
  record({ type: "benchmark-fixture", fixtureId, bytes: info.size, status: "ready" });
}
record({
  type: "benchmark-environment",
  node: process.version,
  platform: process.platform,
  cpuCount: nativeRequire("node:os").availableParallelism(),
  totalMemoryBytes: nativeRequire("node:os").totalmem(),
  sharpConcurrency: sharp.concurrency(),
  sharpVersion: sharp.versions.sharp,
  libvipsVersion: sharp.versions.vips,
  speedPreset,
  hardwareEncoder: hardwareEncoder ?? null,
});

const benchmarkStartedAt = performance.now();
const validator = loadTypeScriptModule(
  "features/workspace/validate-processing-settings.ts",
);
const validationInput = {
  items: [
    {
      kind: "video",
      inspectionStatus: "ready",
      uploadId: "fixture-video",
      status: "queued",
    },
  ],
  processingMode: "reduce-size",
  outputFormat: "webp",
  encoding: "lossy",
  quality: 88,
  videoOptions: baseVideoOptions(),
  audioOptions: {
    processingMode: "reduce-size",
    outputFormat: "mp3",
    quality: "balanced",
    removeMetadata: true,
  },
  targetSizeOptions: {
    enabled: false,
    presetId: "custom",
    targetBytes: null,
    targetRatio: null,
    safetyMarginRatio: 0.03,
    audioMode: "auto",
    allowLossyForPng: false,
    jpegBackground: "#ffffff",
    minimumQuality: { jpeg: 60, webp: 55, avif: 45, videoHeight: 480, audioKbps: 64 },
  },
};
await measure("settings", "settings_validation", async () => {
  for (let index = 0; index < 1_000; index += 1) {
    const result = validator.validateProcessingSettings(validationInput);
    if (!result.isValid) throw new Error("valid settings rejected");
  }
});

const savedInput = join(workDirectory, "saved-input.bin");
await measure("small-jpeg", "file_save", () => copyFile(fixtures.smallJpeg, savedInput));
await measure("video-1080p-10s", "ffprobe", () => probe(fixtures.video10s));
await measure("large-jpeg", "metadata_analysis", () =>
  sharp(fixtures.largeJpeg).metadata(),
);
await measure("large-jpeg", "decode", () => sharp(fixtures.largeJpeg).raw().toBuffer());
await measure("large-jpeg", "resize", () =>
  sharp(fixtures.largeJpeg).resize({ width: 1920, fit: "inside" }).raw().toBuffer(),
);
await measure("large-jpeg", "noise_reduction", () =>
  sharp(fixtures.largeJpeg).median(3).raw().toBuffer(),
);
await measure("large-jpeg", "sharpen", () =>
  sharp(fixtures.largeJpeg).sharpen({ sigma: 1, m1: 1.2, m2: 2 }).raw().toBuffer(),
);

const imageOutput = join(workDirectory, "large-output.webp");
await measure("large-jpeg", "image_encode", () =>
  sharp(fixtures.largeJpeg, { sequentialRead: true })
    .autoOrient()
    .toColourspace("srgb")
    .webp({
      lossless: false,
      quality: 88,
      effort: speedPreset === "fast" ? 3 : 6,
      smartSubsample: true,
    })
    .toFile(imageOutput),
);
await measure("large-jpeg", "output_validation", () => sharp(imageOutput).metadata());
record({
  type: "benchmark-quality",
  caseId: "large-jpeg",
  metric: "psnr",
  value: await calculatePsnr(fixtures.largeJpeg, imageOutput),
});

const transparentOutput = join(workDirectory, "transparent-output.webp");
await measure("transparent-png", "lossless_encode", () =>
  sharp(fixtures.transparentPng, { sequentialRead: true })
    .webp({ lossless: true, effort: speedPreset === "fast" ? 3 : 6 })
    .toFile(transparentOutput),
);
record({
  type: "benchmark-quality",
  caseId: "transparent-png",
  metric: "pixel_equal",
  value: await pixelsEqual(fixtures.transparentPng, transparentOutput),
});

await measure("webp", "image_encode_single", () =>
  sharp(fixtures.webp)
    .webp({
      quality: 88,
      effort: speedPreset === "fast" ? 3 : 6,
      smartSubsample: true,
    })
    .toFile(join(workDirectory, "batch-single.webp")),
);
await measure(
  "webp",
  "image_encode_batch_4",
  () =>
    Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        sharp(fixtures.webp)
          .webp({
            quality: 88,
            effort: speedPreset === "fast" ? 3 : 6,
            smartSubsample: true,
          })
          .toFile(join(workDirectory, `batch-${index}.webp`)),
      ),
    ),
  { concurrentJobs: 4 },
);

const videoArguments = loadTypeScriptModule("infrastructure/ffmpeg/video-arguments.ts");
const copyOutput = join(workDirectory, "metadata-clean.mp4");
const copyCommand = videoArguments.buildFfmpegArgs(
  fixtures.video10s,
  copyOutput,
  baseVideoOptions("copy"),
);
await measure(
  "video-1080p-10s",
  "metadata_stream_copy",
  () => runCommand(ffmpegPath, copyCommand.args),
  { ffmpegProcesses: 1, reencoded: copyCommand.shouldReencode },
);
await measure("video-1080p-10s", "stream_copy_validation", () => probe(copyOutput));

const videoOutput = join(workDirectory, "video-output.mp4");
const transcodeCommand = videoArguments.buildFfmpegArgs(
  fixtures.video10s,
  videoOutput,
  baseVideoOptions("compress"),
  hardwareEncoder ? { hardwareEncoder, sourceHeight: 1080 } : { sourceHeight: 1080 },
);
const videoEncoding = await measure(
  "video-1080p-10s",
  "video_filter_encode_audio",
  () => runCommand(ffmpegPath, benchmarkArgs(transcodeCommand.args)),
  { ffmpegProcesses: 1, filterChain: "scale,denoise,sharpen" },
);
const videoValidation = await measure("video-1080p-10s", "video_output_validation", () =>
  probe(videoOutput),
);
record({
  type: "video-performance-metrics",
  jobId: "benchmark-video-1080p-10s",
  encoder: hardwareEncoder ?? "libx264",
  processingMode: "compress",
  inputDurationSeconds: 10,
  decodingMilliseconds: ffmpegBenchMilliseconds(
    videoEncoding.value.stderr,
    "decode_video",
  ),
  filteringMilliseconds: undefined,
  encodingMilliseconds: videoEncoding.elapsedMs,
  audioEncodingMilliseconds: 0,
  containerMilliseconds: undefined,
  outputValidationMilliseconds: videoValidation.elapsedMs,
  totalMilliseconds: Number(
    (videoEncoding.elapsedMs + videoValidation.elapsedMs).toFixed(3),
  ),
  averageEncodingFps: averageProgressValue(videoEncoding.value.stdout, "fps"),
  averageSpeedRatio: averageProgressValue(videoEncoding.value.stdout, "speed", "x"),
});
record({
  type: "benchmark-output",
  caseId: "video-1080p-10s",
  bytes: (await stat(videoOutput)).size,
  codec: hardwareEncoder ?? "libx264",
});
record({
  type: "benchmark-quality",
  caseId: "video-1080p-10s",
  metric: "ssim",
  value: await videoSsim(fixtures.video10s, videoOutput),
});

await measure("video-1080p-60s", "ffprobe", () => probe(fixtures.video60s));
await measure("video-4k-5s", "ffprobe", () => probe(fixtures.video4k));

const passlog = join(workDirectory, "target-passlog");
const targetOutput = join(workDirectory, "target-output.mp4");
const useTwoPass = speedPreset === "maximum-compression";
const targetPreset =
  speedPreset === "fast"
    ? "veryfast"
    : speedPreset === "maximum-compression"
      ? "slow"
      : "medium";
if (useTwoPass) {
  await measure("video-target-size", "target_pass_1", () =>
    runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      fixtures.video10s,
      "-map",
      "0:v:0",
      "-c:v",
      "libx264",
      "-b:v",
      "1800k",
      "-preset",
      targetPreset,
      "-pass",
      "1",
      "-passlogfile",
      passlog,
      "-an",
      "-f",
      "null",
      process.platform === "win32" ? "NUL" : "/dev/null",
    ]),
  );
}
await measure(
  "video-target-size",
  useTwoPass ? "target_pass_2" : "target_single_pass",
  () =>
    runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      fixtures.video10s,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-b:v",
      "1800k",
      "-preset",
      targetPreset,
      ...(useTwoPass ? ["-pass", "2", "-passlogfile", passlog] : []),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      targetOutput,
    ]),
);
await measure("video-target-size", "output_validation", () => probe(targetOutput));
record({
  type: "benchmark-output",
  caseId: "video-target-size",
  bytes: (await stat(targetOutput)).size,
  passes: useTwoPass ? 2 : 1,
});

const audioOutput = join(workDirectory, "audio-output.m4a");
await measure("audio-30s", "audio_processing", () =>
  runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-i",
    fixtures.audio,
    "-map",
    "0:a:0",
    "-vn",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    audioOutput,
  ]),
);
await measure("audio-30s", "output_validation", () => probe(audioOutput));

const capabilities = await measure("runtime", "feature_discovery_cold", async () => {
  const [version, encoders, decoders, filters, formats, hwaccels] = await Promise.all([
    runCommand(ffmpegPath, ["-version"]),
    runCommand(ffmpegPath, ["-hide_banner", "-encoders"]),
    runCommand(ffmpegPath, ["-hide_banner", "-decoders"]),
    runCommand(ffmpegPath, ["-hide_banner", "-filters"]),
    runCommand(ffmpegPath, ["-hide_banner", "-formats"]),
    runCommand(ffmpegPath, ["-hide_banner", "-hwaccels"]),
  ]);
  return { version, encoders, decoders, filters, formats, hwaccels };
});
record({
  type: "benchmark-capability",
  caseId: "runtime",
  gpuApis: ["cuda", "qsv", "d3d11va", "dxva2"].filter((name) =>
    capabilities.value.hwaccels.stdout.includes(name),
  ),
  hardwareEncoders: ["h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv"].filter((name) =>
    capabilities.value.encoders.stdout.includes(name),
  ),
});

let ai = { realEsrgan: false, gpu: false };
try {
  const aiCapability = await measure("ai-image", "ai_capability_check", () =>
    runCommand(
      process.env.AI_PYTHON_PATH ?? "python",
      [process.env.AI_WORKER_PATH ?? "workers/ai_image_worker.py", "--capabilities"],
      { timeoutMs: 30_000 },
    ),
  );
  const aiLine = aiCapability.value.stdout
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("{"));
  ai = aiLine ? JSON.parse(aiLine) : ai;
} catch {
  // AI is an optional, independent processing path. An unavailable Python
  // worker must not discard otherwise valid image/video benchmark results.
}
for (const stage of ["ai_model_load", "ai_inference"]) {
  record({
    type: "benchmark-stage",
    caseId: "ai-image",
    stage,
    elapsedMs: null,
    status: ai.realEsrgan ? "not-measured" : "unavailable",
  });
}
record({
  type: "benchmark-capability",
  caseId: "ai-image",
  gpu: ai.gpu === true,
  ready: ai.realEsrgan === true,
});

await measure("benchmark", "temporary_file_cleanup", removeBenchmarkWork);
record({
  type: "benchmark-summary",
  stage: "total_processing_time",
  elapsedMs: Number((performance.now() - benchmarkStartedAt).toFixed(3)),
  status: "ok",
});
await writeFile(
  resultPath,
  `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
);
