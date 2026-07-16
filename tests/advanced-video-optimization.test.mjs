import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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
          ffmpeg: { available: false, encoders: [], filters: [], muxers: [] },
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

const optimization = loadTypeScriptModule("lib/optimization/video-quality.ts");

const streamSelection = {
  keepPrimaryAudioOnly: true,
  removeSubtitles: true,
  removeAttachments: true,
  removeChapters: true,
  stripPrivacyMetadata: true,
};

const qualitySearch = {
  vmafThreshold: 95,
  minimumFrameThreshold: 80,
  preset: "slow",
  includeAv1: false,
  includeH265: false,
  includeH264: true,
};

const probe = {
  formatName: "matroska,webm",
  size: 1000,
  duration: 10,
  width: 3840,
  height: 2160,
  fps: 30,
  videoCodec: "hevc",
  pixelFormat: "yuv420p10le",
  bitsPerRawSample: 10,
  colorPrimaries: "bt2020",
  colorTransfer: "smpte2084",
  colorSpace: "bt2020nc",
  colorRange: "tv",
  sampleAspectRatio: "1:1",
  displayAspectRatio: "16:9",
  rotation: 90,
  hdr: true,
  streams: [
    { index: 0, codecType: "video", codecName: "hevc" },
    { index: 1, codecType: "audio", codecName: "aac", tags: { title: "日本語" } },
    { index: 2, codecType: "audio", codecName: "aac", tags: { title: "English" } },
    { index: 3, codecType: "subtitle", codecName: "ass", tags: { language: "jpn" } },
    {
      index: 4,
      codecType: "attachment",
      codecName: "ttf",
      tags: { filename: "font.ttf" },
    },
  ],
  chapterCount: 4,
  formatTags: { creation_time: "2026-01-01", location: "+35+139/" },
};

const capabilities = {
  ffmpegAvailable: true,
  encoders: ["libaom-av1", "libx265", "libx264"],
  filters: ["libvmaf"],
  muxers: ["matroska"],
};

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

test("無劣化コピーは選択されたストリームだけを固定引数で保持する", () => {
  const args = optimization.buildStrictLosslessCopyArgs(
    "source.bin",
    "output.mkv",
    streamSelection,
  );
  assert.deepEqual(args.slice(args.indexOf("-map"), args.indexOf("-c")), [
    "-map",
    "0:V?",
    "-map",
    "0:a:0?",
    "-map",
    "0:d?",
  ]);
  assert.equal(argumentValue(args, "-c"), "copy");
  assert.equal(argumentValue(args, "-map_metadata"), "-1");
  assert.equal(argumentValue(args, "-map_chapters"), "-1");
  assert.equal(args.includes("0:s?"), false);
  assert.equal(args.includes("0:t?"), false);
  assert.equal(args.includes("-map_metadata:s:v"), false);
  assert.equal(args.includes("-bsf:v"), false);
  assert.equal(args.includes("rotate=0"), false);
  assert.equal(args.includes("-progress"), true);
});

test("保持指定では全音声・字幕・添付・data・チャプター・メタデータをmapする", () => {
  const keepEverything = Object.fromEntries(
    Object.keys(streamSelection).map((key) => [key, false]),
  );
  const args = optimization.buildStrictLosslessCopyArgs(
    "source.bin",
    "output.mkv",
    keepEverything,
  );
  for (const mapping of ["0:v?", "0:a?", "0:s?", "0:t?", "0:d?"]) {
    assert.equal(args.includes(mapping), true);
  }
  assert.equal(argumentValue(args, "-map_metadata"), "0");
  assert.equal(argumentValue(args, "-map_chapters"), "0");
});

test("実行前プレビューは削除対象と保持する技術情報を区別する", () => {
  const preview = optimization.previewVideoStreamRemovals(probe, streamSelection);
  assert.equal(preview.willRemove, true);
  assert.deepEqual(
    preview.items.map((item) => [item.category, item.count]),
    [
      ["audio", 1],
      ["subtitle", 1],
      ["attachment", 1],
      ["chapter", 4],
      ["metadata", 2],
    ],
  );
  assert.match(preview.preservedTechnicalData.join(" "), /HDR side data/);
  assert.match(preview.preservedTechnicalData.join(" "), /回転.*アスペクト比.*FPS/);
});

test("AV1/H.265は複数CRF、H.264は高品質CRFを動的能力付きで列挙する", () => {
  const candidates = optimization.buildVideoQualityCandidates(
    { ...qualitySearch, includeAv1: true, includeH265: true },
    capabilities,
  );
  assert.deepEqual(
    candidates.filter((item) => item.codec === "av1").map((item) => item.crf),
    [18, 22, 26, 30],
  );
  assert.deepEqual(
    candidates.filter((item) => item.codec === "h265").map((item) => item.crf),
    [18, 21, 24, 27],
  );
  assert.deepEqual(
    candidates.filter((item) => item.codec === "h264").map((item) => item.crf),
    [16, 18, 20],
  );
  assert.equal(
    candidates.every((item) => item.available),
    true,
  );

  const unavailable = optimization.buildVideoQualityCandidates(qualitySearch, {
    ...capabilities,
    encoders: [],
  });
  assert.equal(
    unavailable.every((item) => !item.available),
    true,
  );
  assert.match(unavailable[0].unavailableReason, /libx264/);

  const invalidPreset = optimization.buildVideoQualityCandidates(
    { ...qualitySearch, preset: "ultrafast;delete" },
    capabilities,
  );
  assert.equal(
    invalidPreset.every((item) => item.preset === "medium"),
    true,
  );
});

test("候補エンコードは元解像度/FPS/音声を維持し、10bit・HDR・回転を明示する", () => {
  const definition = optimization.buildVideoQualityCandidates(
    qualitySearch,
    capabilities,
  )[0];
  const args = optimization.buildVideoQualityCandidateArgs(
    "source.bin",
    "candidate.mkv",
    definition,
    probe,
    streamSelection,
  );
  assert.equal(args.includes("-vf"), false);
  assert.equal(args.includes("-r"), false);
  assert.equal(argumentValue(args, "-fps_mode:v:0"), "passthrough");
  assert.equal(argumentValue(args, "-pix_fmt"), "yuv420p10le");
  assert.equal(argumentValue(args, "-color_primaries"), "bt2020");
  assert.equal(argumentValue(args, "-color_trc"), "smpte2084");
  assert.equal(argumentValue(args, "-colorspace"), "bt2020nc");
  assert.equal(argumentValue(args, "-color_range"), "tv");
  assert.equal(argumentValue(args, "-aspect:v:0"), "16:9");
  assert.equal(argumentValue(args, "-metadata:s:v:0"), "rotate=90");
  assert.equal(argumentValue(args, "-c:a"), "copy");
  assert.equal(argumentValue(args, "-preset"), "slow");
});

test("VMAF JSONから平均・最低値と連続する低品質区間を解析する", () => {
  const assessment = optimization.parseVmafJson(
    JSON.stringify({
      frames: [
        { frameNum: 0, metrics: { vmaf: 98 } },
        { frameNum: 1, metrics: { vmaf: 79 } },
        { frameNum: 2, metrics: { vmaf: 75 } },
        { frameNum: 3, metrics: { vmaf: 97 } },
        { frameNum: 6, metrics: { vmaf: 78 } },
      ],
      pooled_metrics: { vmaf: { mean: 95.4, min: 75 } },
    }),
    80,
    2,
  );
  assert.equal(assessment.mean, 95.4);
  assert.equal(assessment.min, 75);
  assert.deepEqual(assessment.lowQualitySegments, [
    { startSeconds: 0.5, endSeconds: 1.5, score: 75 },
    { startSeconds: 3, endSeconds: 3.5, score: 78 },
  ]);
});

test("libvmaf未対応時は全候補をunavailableにして元ファイルを採用する", async () => {
  let invoked = false;
  const result = await optimization.optimizeVideoQuality({
    inputPath: "source.bin",
    outputDirectory: ".",
    mode: "high-quality-optimization",
    streamSelection,
    qualitySearch,
    probe,
    capabilities: { ...capabilities, filters: [] },
    ffmpegExecutable: "ffmpeg",
    runner: async () => {
      invoked = true;
      throw new Error("runner should not be called");
    },
  });
  assert.equal(invoked, false);
  assert.equal(result.selectedOutputPath, "source.bin");
  assert.equal(result.report.keptOriginal, true);
  assert.equal(result.report.qualityAssessment, undefined);
  assert.equal(
    result.report.candidates
      .filter((candidate) => candidate.id !== "original")
      .every((candidate) => candidate.status === "unavailable"),
    true,
  );
  assert.match(result.report.decisionReason, /虚偽の高画質表示をせず/);
});

test("完全無劣化モードはstreamhash一致後だけ出力を採用する", async () => {
  const directory = join(tmpdir(), `advanced-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const result = await optimization.optimizeVideoQuality({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      mode: "strict-lossless",
      streamSelection,
      qualitySearch,
      probe,
      ffmpegExecutable: "ffmpeg",
      runner: async (_executable, args) => {
        if (argumentValue(args, "-f") === "streamhash") {
          return { stdout: "0,v,SHA256=abc\n1,a,SHA256=def\n", stderr: "" };
        }
        await writeFile(args.at(-1), Buffer.alloc(800));
        return { stdout: "", stderr: "" };
      },
    });
    assert.equal(result.report.selectedCandidateId, "strict-lossless-copy");
    assert.equal(result.report.losslessVerification.status, "passed");
    assert.equal(result.report.losslessVerification.method, "FFmpeg streamhash SHA-256");
    assert.equal(result.report.outputSize, 800);
    assert.equal(result.report.reductionPercent, 20);
    assert.match(result.selectedOutputPath, /strict-lossless\.webm$/);
    await access(result.selectedOutputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("無劣化出力が大きい場合は削除要否に応じて元保持または削除指定を優先する", async () => {
  const directory = join(tmpdir(), `advanced-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const runner = async (_executable, args) => {
    if (argumentValue(args, "-f") === "streamhash") {
      return { stdout: "0,v,SHA256=abc\n1,a,SHA256=def\n", stderr: "" };
    }
    await writeFile(args.at(-1), Buffer.alloc(1200));
    return { stdout: "", stderr: "" };
  };
  try {
    const keepOptions = {
      keepPrimaryAudioOnly: false,
      removeSubtitles: false,
      removeAttachments: false,
      removeChapters: false,
      stripPrivacyMetadata: false,
    };
    const kept = await optimization.optimizeVideoQuality({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      mode: "strict-lossless",
      streamSelection: keepOptions,
      qualitySearch,
      probe,
      ffmpegExecutable: "ffmpeg",
      runner,
    });
    assert.equal(kept.selectedOutputPath, join(directory, "source.bin"));
    assert.equal(kept.report.keptOriginal, true);
    assert.match(kept.report.decisionReason, /容量が増えるため元ファイル/);
    await assert.rejects(access(join(directory, "strict-lossless.webm")));

    const removed = await optimization.optimizeVideoQuality({
      inputPath: join(directory, "source.bin"),
      outputDirectory: directory,
      mode: "strict-lossless",
      streamSelection,
      qualitySearch,
      probe,
      ffmpegExecutable: "ffmpeg",
      runner,
    });
    assert.equal(removed.report.keptOriginal, false);
    assert.equal(removed.report.outputSize, 1200);
    assert.match(removed.report.decisionReason, /削除を容量より優先/);
    await access(removed.selectedOutputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function vmafPayload() {
  return JSON.stringify({
    frames: [
      { frameNum: 0, metrics: { vmaf: 96 } },
      { frameNum: 1, metrics: { vmaf: 97 } },
    ],
    pooled_metrics: { vmaf: { mean: 96.5, min: 96 } },
  });
}

function mockOptimizationRunner(sizes) {
  return async (_executable, args, options = {}) => {
    const filter = argumentValue(args, "-lavfi");
    if (filter) {
      const logFile = /log_path=([^:;]+)/.exec(filter)?.[1];
      assert.ok(logFile);
      await writeFile(join(options.cwd, logFile), vmafPayload());
      return { stdout: "", stderr: "" };
    }
    const outputPath = args.at(-1);
    const id = /([^\\/]+)\.mkv$/.exec(outputPath)?.[1];
    assert.ok(id);
    await writeFile(outputPath, Buffer.alloc(sizes[id]));
    return { stdout: "", stderr: "" };
  };
}

test("VMAF合格候補のうち容量最小を選び、非選択候補を削除する", async () => {
  const directory = join(tmpdir(), `advanced-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const result = await optimization.optimizeVideoQuality({
      inputPath: "source.bin",
      outputDirectory: directory,
      mode: "high-quality-optimization",
      streamSelection,
      qualitySearch,
      probe,
      capabilities,
      ffmpegExecutable: "ffmpeg",
      runner: mockOptimizationRunner({
        "h264-crf-16": 850,
        "h264-crf-18": 700,
        "h264-crf-20": 600,
      }),
    });
    assert.equal(result.report.selectedCandidateId, "h264-crf-20");
    assert.equal(result.report.outputSize, 600);
    assert.equal(result.report.reductionPercent, 40);
    assert.equal(result.report.qualityAssessment.vmafMean, 96.5);
    assert.equal(result.report.candidates.at(-1).status, "selected");
    await access(result.selectedOutputPath);
    await assert.rejects(access(join(directory, "h264-crf-16.mkv")));
    await assert.rejects(access(join(directory, "h264-crf-18.mkv")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("VMAF合格でも候補が元より大きければ全候補を削除して元を採用する", async () => {
  const directory = join(tmpdir(), `advanced-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const result = await optimization.optimizeVideoQuality({
      inputPath: "source.bin",
      outputDirectory: directory,
      mode: "high-quality-optimization",
      streamSelection,
      qualitySearch,
      probe,
      capabilities,
      ffmpegExecutable: "ffmpeg",
      runner: mockOptimizationRunner({
        "h264-crf-16": 1100,
        "h264-crf-18": 1200,
        "h264-crf-20": 1300,
      }),
    });
    assert.equal(result.selectedOutputPath, "source.bin");
    assert.equal(result.report.keptOriginal, true);
    assert.equal(result.report.selectedCandidateId, "original");
    assert.match(result.report.decisionReason, /元ファイルより小さい候補がない/);
    for (const id of ["h264-crf-16", "h264-crf-18", "h264-crf-20"]) {
      await assert.rejects(access(join(directory, `${id}.mkv`)));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("外部実行はshell:falseかつ引数配列で行い、VMAFログ名は固定IDから生成する", () => {
  const source = readFileSync(resolve(root, "lib/optimization/video-quality.ts"), "utf8");
  assert.match(source, /shell: false/);
  assert.match(source, /spawn\([^,]+, \[\.\.\.args\]/s);
  assert.match(source, /const vmafFileName = `\$\{definition\.id\}-vmaf\.json`/);
  assert.doesNotMatch(source, /exec\(|execSync\(/);
});
