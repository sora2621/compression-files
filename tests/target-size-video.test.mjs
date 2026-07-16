import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
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
    if (specifier === "@/lib/capabilities/runtime-capabilities") {
      return {
        getRuntimeCapabilities: async () => ({
          ffmpeg: { available: true, encoders: ["libx264", "aac"], muxers: ["mp4"] },
        }),
      };
    }
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
  const execute = new Function(
    "require",
    "module",
    "exports",
    "__filename",
    "__dirname",
    outputText,
  );
  execute(localRequire, module, module.exports, absolutePath, dirname(absolutePath));
  return module.exports;
}

const targetSize = loadTypeScriptModule("lib/target-size/video-target.ts");

const videoProbe = {
  kind: "video",
  duration: 120,
  size: 100_000_000,
  formatName: "mov,mp4",
  totalBitrateKbps: 6667,
  videoBitrateKbps: 6100,
  audioBitrateKbps: 512,
  width: 3840,
  height: 2160,
  fps: 30,
  videoCodec: "h264",
  audioCodecs: ["aac", "aac"],
  audioTrackCount: 2,
};

const audioProbe = {
  kind: "audio",
  duration: 10,
  size: 200_000,
  formatName: "mp3",
  totalBitrateKbps: 160,
  videoBitrateKbps: null,
  audioBitrateKbps: 160,
  width: null,
  height: null,
  fps: null,
  videoCodec: null,
  audioCodecs: ["mp3"],
  audioTrackCount: 1,
};

const capabilities = {
  ffmpegAvailable: true,
  encoders: ["libx264", "libx265", "libaom-av1", "aac"],
  muxers: ["mp4"],
};

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

test("ffprobeから動画・音声ビットレート、解像度、FPS、codec、音声本数を取得する", async () => {
  const result = await targetSize.probeTargetMedia("source.bin", "ffprobe", async () => ({
    stdout: JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "hevc",
          bit_rate: "5000000",
          width: 1920,
          height: 1080,
          avg_frame_rate: "30000/1001",
        },
        { codec_type: "audio", codec_name: "aac", bit_rate: "192000" },
        { codec_type: "audio", codec_name: "opus", bit_rate: "96000" },
      ],
      format: {
        format_name: "matroska,webm",
        duration: "92.5",
        size: "480000000",
        bit_rate: "5290000",
      },
    }),
    stderr: "",
  }));
  assert.equal(result.kind, "video");
  assert.equal(result.duration, 92.5);
  assert.equal(result.size, 480_000_000);
  assert.equal(result.videoBitrateKbps, 5000);
  assert.equal(result.audioBitrateKbps, 288);
  assert.equal(result.audioTrackCount, 2);
  assert.deepEqual(result.audioCodecs, ["aac", "opus"]);
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.fps, 29.97);
});

test("目標bpsから安全margin・overhead・音声を差し引き、必要時だけ音声を段階低下する", () => {
  const targetBytes = 15 * 1024 * 1024;
  const plan = targetSize.calculateTargetBitratePlan(videoProbe, targetBytes, {
    audioMode: "auto",
    minimumAudioKbps: 64,
    safetyMarginRatio: 0.03,
    containerOverheadRatio: 0.015,
  });
  assert.equal(
    plan.grossBitrateKbps,
    Number(((targetBytes * 8) / 120 / 1000).toFixed(1)),
  );
  assert.equal(
    plan.usableBitrateKbps,
    Number(
      (
        plan.grossBitrateKbps -
        plan.safetyMarginKbps -
        plan.containerOverheadKbps
      ).toFixed(1),
    ),
  );
  assert.equal(plan.audioBitrateKbpsPerTrack, 256, "元の256kbps/trackを上げない");
  assert.equal(plan.audioBitrateKbpsTotal, 512);
  assert.equal(plan.videoBitrateKbps, Math.floor(plan.usableBitrateKbps - 512));
  assert.equal(plan.feasible, true);

  const difficult = targetSize.calculateTargetBitratePlan(videoProbe, 4 * 1024 * 1024, {
    audioMode: "auto",
    minimumAudioKbps: 64,
  });
  assert.equal(difficult.audioBitrateKbpsPerTrack, 64);
  assert.equal(difficult.feasible, false);

  const withoutAudio = targetSize.calculateTargetBitratePlan(videoProbe, targetBytes, {
    audioMode: "remove",
  });
  assert.equal(withoutAudio.removeAudio, true);
  assert.equal(withoutAudio.audioBitrateKbpsTotal, 0);
});

test("0秒・0バイト・不正な目標容量を計算前に拒否する", () => {
  assert.throws(
    () =>
      targetSize.calculateTargetBitratePlan({ ...videoProbe, duration: 0 }, 1000, {
        audioMode: "auto",
      }),
    (error) => error.code === "ZERO_DURATION",
  );
  assert.throws(
    () =>
      targetSize.calculateTargetBitratePlan({ ...videoProbe, size: 0 }, 1000, {
        audioMode: "auto",
      }),
    (error) => error.code === "EMPTY_FILE",
  );
  assert.throws(
    () => targetSize.calculateTargetBitratePlan(videoProbe, 0, { audioMode: "auto" }),
    (error) => error.code === "INVALID_TARGET_SIZE",
  );
});

test("解像度候補は元より高くせず、変更未許可なら提案だけで元解像度を維持する", () => {
  const recommendation = targetSize.resolutionRecommendations(videoProbe, 1000, {
    codec: "h264",
    allowResolutionChange: false,
    minimumHeight: 480,
  });
  assert.equal(
    recommendation.candidates.every((item) => item.height <= 2160),
    true,
  );
  assert.equal(recommendation.selectedHeight, 2160);
  assert.equal(recommendation.willChangeResolution, false);
  assert.ok(recommendation.recommendedHeight <= 720);
  assert.match(recommendation.reason, /自動変更は行いません/);

  const allowed = targetSize.resolutionRecommendations(videoProbe, 1000, {
    codec: "h264",
    allowResolutionChange: true,
    minimumHeight: 480,
  });
  assert.equal(allowed.selectedHeight, allowed.recommendedHeight);
  assert.equal(allowed.willChangeResolution, true);
});

test("2パス引数はcodec allowlist、OS別null、job passlog、音声設定を安全に組み立てる", () => {
  const windows = targetSize.buildTwoPassArgs({
    inputPath: "source.bin",
    outputPath: "output.tmp.mp4",
    passlogPath: "job-dir/job-passlog",
    codec: "h265",
    videoBitrateKbps: 2500,
    audioBitrateKbpsPerTrack: 128,
    removeAudio: false,
    targetHeight: 720,
    sourceHeight: 1080,
    preset: "slower",
    platform: "win32",
  });
  assert.equal(windows.encoder, "libx265");
  assert.equal(windows.nullOutput, "NUL");
  assert.equal(windows.pass1Args.at(-1), "NUL");
  assert.equal(argumentValue(windows.pass1Args, "-pass"), "1");
  assert.equal(argumentValue(windows.pass2Args, "-pass"), "2");
  assert.equal(argumentValue(windows.pass2Args, "-passlogfile"), "job-dir/job-passlog");
  assert.equal(argumentValue(windows.pass2Args, "-c:a"), "aac");
  assert.equal(argumentValue(windows.pass2Args, "-b:a"), "128k");
  assert.equal(argumentValue(windows.pass2Args, "-vf"), "scale=-2:720:flags=lanczos");
  assert.equal(windows.pass2Args.includes("-r"), false, "元FPSを維持する");

  const linux = targetSize.buildTwoPassArgs({
    inputPath: "source.bin",
    outputPath: "output.tmp.mp4",
    passlogPath: "job-passlog",
    codec: "av1",
    videoBitrateKbps: 1800,
    audioBitrateKbpsPerTrack: null,
    removeAudio: true,
    targetHeight: null,
    sourceHeight: 1080,
    platform: "linux",
  });
  assert.equal(linux.encoder, "libaom-av1");
  assert.equal(linux.nullOutput, "/dev/null");
  assert.equal(linux.pass2Args.includes("-an"), true);
  assert.throws(
    () => targetSize.buildTwoPassArgs({ ...linux, codec: "vp9" }),
    /動画コーデック/,
  );
});

test("先頭・中間・終盤のサンプル位置と全尺容量を推定する", () => {
  assert.deepEqual(targetSize.sampleExtractionWindows(100, 3), [
    { startSeconds: 0, durationSeconds: 3 },
    { startSeconds: 48.5, durationSeconds: 3 },
    { startSeconds: 97, durationSeconds: 3 },
  ]);
  const estimate = targetSize.estimateFromSamples(
    [
      { startSeconds: 0, durationSeconds: 3, outputBytes: 300_000, processingSeconds: 1 },
      {
        startSeconds: 48.5,
        durationSeconds: 3,
        outputBytes: 330_000,
        processingSeconds: 1.1,
      },
      {
        startSeconds: 97,
        durationSeconds: 3,
        outputBytes: 270_000,
        processingSeconds: 0.9,
      },
    ],
    {
      totalDuration: 100,
      targetBytes: 11_000_000,
      originalBytes: 20_000_000,
      codec: "h265",
      recommendedHeight: 720,
      sourceHeight: 1080,
    },
  );
  assert.equal(estimate.estimatedOutputBytes, 10_000_000);
  assert.equal(estimate.feasibility, "achievable");
  assert.equal(estimate.resolutionChange, true);
});

function compactVideoProbe(size = 2_000_000) {
  return {
    ...videoProbe,
    duration: 10,
    size,
    width: 640,
    height: 480,
    audioBitrateKbps: 128,
    audioTrackCount: 1,
    audioCodecs: ["aac"],
  };
}

function outputProbeJson(kind, size) {
  return JSON.stringify({
    streams:
      kind === "video"
        ? [
            {
              codec_type: "video",
              codec_name: "h264",
              bit_rate: "600000",
              width: 640,
              height: 480,
              avg_frame_rate: "30/1",
            },
            { codec_type: "audio", codec_name: "aac", bit_rate: "128000" },
          ]
        : [{ codec_type: "audio", codec_name: "aac", bit_rate: "64000" }],
    format: {
      format_name: kind === "video" ? "mov,mp4" : "mov,mp4,m4a",
      duration: "10",
      size: String(size),
      bit_rate: kind === "video" ? "728000" : "64000",
    },
  });
}

function videoRunner(directory, outputBytes, { cancelAtPass1 = false } = {}) {
  return async (executable, args, commandOptions = {}) => {
    if (executable === "ffprobe") {
      return { stdout: outputProbeJson("video", outputBytes), stderr: "" };
    }
    const pass = argumentValue(args, "-pass");
    if (pass === "1") {
      const prefix = argumentValue(args, "-passlogfile");
      await writeFile(`${prefix}-0.log`, "stats");
      await writeFile(`${prefix}-0.log.mbtree`, "tree");
      if (cancelAtPass1) {
        assert.equal(commandOptions.signal?.aborted, true);
        await writeFile(join(directory, "cancel-job-target.tmp.mp4"), "partial");
        throw new Error("cancelled");
      }
      return { stdout: "", stderr: "" };
    }
    if (pass === "2") {
      await writeFile(args.at(-1), Buffer.alloc(outputBytes));
      return { stdout: "", stderr: "" };
    }
    if (args.includes("-ss")) {
      await writeFile(args.at(-1), Buffer.alloc(50_000));
      return { stdout: "", stderr: "" };
    }
    if (args.at(-1)?.endsWith(".mp4")) {
      await writeFile(args.at(-1), Buffer.alloc(outputBytes));
      return { stdout: "", stderr: "" };
    }
    throw new Error("unexpected command");
  };
}

test("動画2パス成功時に実サンプル推定・進捗・ffprobe検証を返しpasslog/tempを削除する", async () => {
  const directory = join(tmpdir(), `target-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const progress = [];
  try {
    const result = await targetSize.optimizeVideoToTargetSize({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      jobId: "video-job",
      targetBytes: 1_000_000,
      audioMode: "auto",
      codec: "h264",
      allowResolutionChange: false,
      minimumVideoHeight: 480,
      speedPreset: "maximum-compression",
      runSampleEstimate: true,
      probe: compactVideoProbe(),
      capabilities,
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe",
      runner: videoRunner(directory, 900_000),
      onProgress: (value, stage, attempt) => progress.push({ value, stage, attempt }),
    });
    assert.equal(result.result.achieved, true);
    assert.equal(result.result.actualBytes, 900_000);
    assert.equal(result.result.attempts, 1);
    assert.ok(result.estimate.estimatedOutputBytes > 0);
    assert.equal(progress.at(-1).value, 100);
    assert.deepEqual(progress.at(-1).attempt, { attempt: 1, maxAttempts: 1 });
    assert.equal(
      progress.some((item) => /サンプル/.test(item.stage)),
      true,
    );
    await access(result.selectedOutputPath);
    const files = await readdir(directory);
    assert.equal(
      files.some((name) => name.includes("passlog")),
      false,
    );
    assert.equal(
      files.some((name) => name.includes(".tmp")),
      false,
    );
    assert.equal(
      files.some((name) => name.includes("sample-")),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("目標超過を成功扱いせず、返却元サイズと結果actualBytesを一致させて一時物を削除する", async () => {
  const directory = join(tmpdir(), `target-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const result = await targetSize.optimizeVideoToTargetSize({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      jobId: "over-job",
      targetBytes: 1_000_000,
      audioMode: "auto",
      codec: "h264",
      allowResolutionChange: false,
      minimumVideoHeight: 480,
      probe: compactVideoProbe(),
      capabilities,
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe",
      runner: videoRunner(directory, 1_100_000),
    });
    assert.equal(result.selectedOutputPath, join(directory, "source.bin"));
    assert.equal(result.result.achieved, false);
    assert.equal(result.result.actualBytes, 2_000_000);
    assert.equal(result.result.savedBytes, 0);
    assert.equal(result.result.recommendation.minimumAchievableBytes, 1_100_000);
    assert.equal((await readdir(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("失敗・キャンセル相当でもpasslogと一時出力をfinally削除する", async () => {
  const directory = join(tmpdir(), `target-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      targetSize.optimizeVideoToTargetSize({
        inputPath: join(directory, "source.bin"),
        outputDirectory: directory,
        jobId: "cancel-job",
        targetBytes: 1_000_000,
        audioMode: "auto",
        codec: "h264",
        allowResolutionChange: false,
        minimumVideoHeight: 480,
        speedPreset: "maximum-compression",
        probe: compactVideoProbe(),
        capabilities,
        ffmpegExecutable: "ffmpeg",
        signal: controller.signal,
        runner: videoRunner(directory, 900_000, { cancelAtPass1: true }),
      }),
      /cancelled/,
    );
    assert.equal((await readdir(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("音声は元音質以下の段階候補で目標化し、64kbpsでも不可能なら実行しない", async () => {
  const directory = join(tmpdir(), `target-audio-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    await assert.rejects(
      targetSize.optimizeAudioToTargetSize({
        inputPath: "empty.bin",
        outputDirectory: directory,
        jobId: "empty-audio",
        targetBytes: 1000,
        audioMode: "auto",
        probe: { ...audioProbe, size: 0 },
        capabilities,
        ffmpegExecutable: "ffmpeg",
      }),
      (error) => error.code === "EMPTY_FILE",
    );
    let invoked = false;
    const difficult = await targetSize.optimizeAudioToTargetSize({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      jobId: "audio-hard",
      targetBytes: 50_000,
      audioMode: "auto",
      probe: audioProbe,
      capabilities,
      ffmpegExecutable: "ffmpeg",
      runner: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    });
    assert.equal(invoked, false);
    assert.equal(difficult.result.achieved, false);
    assert.equal(difficult.result.recommendation.recommendedAudioKbps, 64);

    const progress = [];
    const achieved = await targetSize.optimizeAudioToTargetSize({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      jobId: "audio-ok",
      targetBytes: 100_000,
      audioMode: "auto",
      probe: audioProbe,
      capabilities,
      ffmpegExecutable: "ffmpeg",
      ffprobeExecutable: "ffprobe",
      runner: async (executable, args) => {
        if (executable === "ffprobe") {
          return { stdout: outputProbeJson("audio", 90_000), stderr: "" };
        }
        await writeFile(args.at(-1), Buffer.alloc(90_000));
        return { stdout: "", stderr: "" };
      },
      onProgress: (value, stage, attempt) => progress.push({ value, stage, attempt }),
    });
    assert.equal(achieved.result.achieved, true);
    assert.equal(achieved.result.actualBytes, 90_000);
    assert.equal(achieved.result.selectedAudioKbps, 64);
    assert.equal(progress.at(-1).value, 100);
    await access(achieved.selectedOutputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("外部実行はshell:false・引数配列で、passlog名は安全なjob IDから生成する", () => {
  const application = readFileSync(
    resolve(root, "lib/target-size/video-target.ts"),
    "utf8",
  );
  const processRunner = readFileSync(
    resolve(root, "infrastructure/process/command-runner.ts"),
    "utf8",
  );
  assert.match(processRunner, /shell: false/);
  assert.match(processRunner, /spawn\([^,]+, \[\.\.\.args\]/s);
  assert.match(application, /value\.replace\(\/\[\^a-zA-Z0-9_-\]\//);
  assert.doesNotMatch(`${application}\n${processRunner}`, /exec\(|execSync\(/);
});
