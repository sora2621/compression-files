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
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
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
    if (specifier === "ffprobe-static") return { path: "ffprobe" };
    if (specifier === "ffmpeg-static") return "ffmpeg";
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
    module,
    module.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return module.exports;
}

const filters = loadTypeScriptModule("infrastructure/ffmpeg/video-filters.ts");
const argumentsBuilder = loadTypeScriptModule("infrastructure/ffmpeg/video-arguments.ts");
const mediaProbe = loadTypeScriptModule("infrastructure/ffprobe/media-probe.ts");
const videoRunner = loadTypeScriptModule("infrastructure/ffmpeg/video-command-runner.ts");
const videoDomain = loadTypeScriptModule("features/target-size/domain/video-bitrate.ts");

const baseEnhancements = {
  denoise: "none",
  sharpen: "none",
  brightness: 0,
  contrast: 1,
  saturation: 1,
  colorCorrection: false,
};

const baseCompression = {
  mode: "copy",
  resolution: "original",
  customHeight: null,
  codec: "h264",
  quality: "balanced",
  audio: "copy",
  removeMetadata: true,
  outputContainer: "source",
  enhancements: baseEnhancements,
  frameRate: "original",
};

test("FFmpegフィルターを副作用なしで個別生成し、順序を保って連結する", () => {
  const enhancements = {
    denoise: "nlmeans",
    sharpen: "cas",
    brightness: 0.1,
    contrast: 1.2,
    saturation: 0.9,
    colorCorrection: true,
  };
  assert.equal(filters.buildScaleFilter(720), "scale=-2:720:flags=lanczos");
  assert.equal(filters.buildScaleFilter(null), null);
  assert.equal(filters.buildNoiseFilter(enhancements), "nlmeans=s=2:p=7:r=9");
  assert.equal(filters.buildSharpenFilter(enhancements), "cas=strength=0.5");
  assert.deepEqual(filters.buildColorFilters(enhancements), [
    "eq=brightness=0.1:contrast=1.2:saturation=0.9",
    "colorspace=all=bt709:fast=1",
  ]);
  assert.deepEqual(
    filters.buildVideoFilterChain({
      targetHeight: 720,
      frameRate: "30",
      enhancements,
    }),
    [
      "scale=-2:720:flags=lanczos",
      "fps=30",
      "nlmeans=s=2:p=7:r=9",
      "cas=strength=0.5",
      "eq=brightness=0.1:contrast=1.2:saturation=0.9",
      "colorspace=all=bt709:fast=1",
    ],
  );
});

test("動画引数はcopyと再エンコードの既存契約を維持する", () => {
  const copy = argumentsBuilder.buildFfmpegArgs(
    "source.bin",
    "output.mp4",
    baseCompression,
  );
  assert.equal(copy.shouldReencode, false);
  assert.deepEqual(copy.args.slice(copy.args.indexOf("-map"), -4), [
    "-map",
    "0",
    "-c",
    "copy",
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
  ]);
  assert.deepEqual(copy.args.slice(-4), [
    "-progress",
    "pipe:1",
    "-nostats",
    "output.mp4",
  ]);

  const encoded = argumentsBuilder.buildFfmpegArgs("source.bin", "output.mov", {
    ...baseCompression,
    mode: "compress",
    resolution: "720",
    codec: "h265",
    quality: "high",
    audio: "aac128",
    frameRate: "24",
  });
  assert.equal(encoded.shouldReencode, true);
  assert.equal(encoded.targetHeight, 720);
  assert.equal(
    encoded.args[encoded.args.indexOf("-vf") + 1],
    "scale=-2:720:flags=lanczos,fps=24",
  );
  assert.equal(encoded.args[encoded.args.indexOf("-c:v") + 1], "libx265");
  assert.equal(encoded.args[encoded.args.indexOf("-crf") + 1], "22");
  assert.equal(encoded.args[encoded.args.indexOf("-b:a") + 1], "128k");
  assert.equal(encoded.args.includes("hvc1"), true);
});

test("FFprobeは引数配列とAbortSignalを注入runnerへ渡して結果を解析する", async () => {
  const controller = new AbortController();
  let invocation;
  const result = await mediaProbe.probeMedia("source.bin", {
    executable: "ffprobe-test",
    signal: controller.signal,
    runner: async (executable, args, options) => {
      invocation = { executable, args, options };
      return {
        stdout: JSON.stringify({
          streams: [
            {
              index: 0,
              codec_type: "video",
              codec_name: "h264",
              width: 1920,
              height: 1080,
              avg_frame_rate: "30000/1001",
            },
            { index: 1, codec_type: "audio", codec_name: "aac" },
          ],
          format: { format_name: "mov,mp4", duration: "10", bit_rate: "1000000" },
        }),
        stderr: "",
      };
    },
  });
  assert.equal(invocation.executable, "ffprobe-test");
  assert.equal(Array.isArray(invocation.args), true);
  assert.equal(invocation.args.at(-1), "source.bin");
  assert.equal(invocation.options.signal, controller.signal);
  assert.equal(result.video.fps, 29.97);
  assert.equal(result.audioTrackCount, 1);
});

test("動画runnerは実行処理を差し替え可能で、引数と中断signalを保持する", async () => {
  const controller = new AbortController();
  const progress = [];
  let invocation;
  await videoRunner.runVideoCommand({
    executable: "ffmpeg-test",
    args: ["-i", "source.bin", "output.mp4"],
    duration: 10,
    fps: 30,
    signal: controller.signal,
    runner: async (executable, args, options) => {
      invocation = { executable, args, options };
      return { stdout: "", stderr: "" };
    },
    onProgress: (value) => progress.push(value),
  });
  assert.equal(invocation.executable, "ffmpeg-test");
  assert.deepEqual(invocation.args, ["-i", "source.bin", "output.mp4"]);
  assert.equal(invocation.options.signal, controller.signal);
  assert.equal(progress.at(-1), 99);
});

test("目標容量domainは余白・音声・映像bpsと解像度候補を純粋計算する", () => {
  assert.equal(videoDomain.calculateGrossTargetBitrate(15_000_000, 120), 1000);
  assert.equal(videoDomain.calculateSafetyMargin(1000, 0.03), 30);
  assert.equal(
    videoDomain.calculateAvailableVideoBitrate({
      grossBitrateKbps: 1000,
      safetyMarginKbps: 30,
      containerOverheadKbps: 15,
      audioBitrateKbpsTotal: 128,
    }),
    827,
  );
  assert.equal(videoDomain.calculateTargetVideoBitrate(955, 128, 180), 827);

  const probe = {
    kind: "video",
    duration: 120,
    size: 100_000_000,
    audioBitrateKbps: 192,
    audioTrackCount: 1,
    width: 1920,
    height: 1080,
    fps: 30,
  };
  assert.deepEqual(
    videoDomain.calculateAudioBitrate(probe, {
      audioMode: "auto",
      minimumAudioKbps: 64,
      usableBitrateKbps: 1000,
      minimumVideoKbps: 180,
    }),
    { perTrackKbps: 192, totalKbps: 192, trackCount: 1, removeAudio: false },
  );
  const candidates = videoDomain.generateResolutionCandidates(probe, {
    codec: "h264",
    minimumHeight: 480,
  });
  assert.deepEqual(
    candidates.map((candidate) => candidate.height),
    [1080, 720, 480],
  );
  assert.equal(
    candidates.every((candidate) => candidate.width % 2 === 0),
    true,
  );
});

test("共通process境界だけがshell:falseでspawnし、互換entryは再exportに留める", () => {
  const processSource = readFileSync(
    resolve(root, "infrastructure/process/command-runner.ts"),
    "utf8",
  );
  const videoEntry = readFileSync(resolve(root, "lib/media/video.ts"), "utf8");
  assert.match(processSource, /spawn\([^,]+, \[\.\.\.args\]/s);
  assert.match(processSource, /shell: false/);
  assert.doesNotMatch(processSource, /exec\(|execSync\(/);
  assert.match(
    videoEntry,
    /export \{ buildFfmpegArgs, probeAudio, probeMedia, probeVideo \}/,
  );
});
