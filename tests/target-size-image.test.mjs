import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
  const module = { exports: {} };
  cache.set(absolutePath, module);
  const { outputText } = ts.transpileModule(readFileSync(absolutePath, "utf8"), {
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
    module,
    module.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return module.exports;
}

const calculations = loadTypeScriptModule("lib/target-size/calculations.ts");
const optimizer = loadTypeScriptModule("lib/target-size/image-target.ts");

function targetOptions(overrides = {}) {
  return {
    enabled: true,
    presetId: "custom",
    targetBytes: 10_000,
    targetRatio: null,
    unit: "KB",
    audioMode: "auto",
    allowResolutionChange: false,
    allowLossyForPng: false,
    jpegBackground: null,
    minimumQuality: {
      jpeg: 35,
      webp: 30,
      avif: 25,
      videoHeight: 480,
      audioKbps: 64,
    },
    ...overrides,
  };
}

function noisyRgb(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  let state = 0x12345678;
  for (let index = 0; index < pixels.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pixels[index] = state >>> 24;
  }
  return pixels;
}

async function makeNoisyJpeg(width = 256, height = 256) {
  return sharp(noisyRgb(width, height), {
    raw: { width, height, channels: 3 },
  })
    .jpeg({ quality: 98, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

async function cleanup(directory) {
  sharp.cache(false);
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}

test("容量単位変換、目標解決、共通達成可能性推定を行う", () => {
  assert.equal(calculations.targetSizeValueToBytes(1, "KB"), 1024);
  assert.equal(calculations.targetSizeValueToBytes(1.5, "MB"), 1_572_864);
  assert.equal(calculations.bytesToTargetSizeValue(2_147_483_648, "GB"), 2);
  assert.equal(
    calculations.resolveRequestedTargetBytes(
      { targetBytes: null, targetRatio: 0.5 },
      1001,
    ),
    500,
  );
  assert.equal(calculations.targetNeedsReduction(1000, 1200), false);
  const feasible = calculations.estimateTargetSizeFeasibility({
    originalBytes: 1_000_000,
    targetBytes: 700_000,
    estimatedMinimumBytes: 300_000,
    outputFormat: "webp",
  });
  assert.equal(feasible.feasibility, "achievable");
  const difficult = calculations.estimateTargetSizeFeasibility({
    originalBytes: 1_000_000,
    targetBytes: 100_000,
    estimatedMinimumBytes: 400_000,
    outputFormat: "h265",
  });
  assert.equal(difficult.feasibility, "difficult");
});

test("JPEG品質を二分探索し、目標以下で確認できた最高品質を選ぶ", async () => {
  const directory = join(tmpdir(), `target-image-search-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.jpg");
    const source = await makeNoisyJpeg();
    await writeFile(inputPath, source);
    const decoded = await sharp(source).raw().toBuffer({ resolveWithObject: true });
    const reference = await sharp(decoded.data, { raw: decoded.info })
      .jpeg({ quality: 72, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer();
    const progress = [];
    const result = await optimizer.optimizeImageToTargetSize({
      inputPath,
      directory,
      originalName: "photo.jpg",
      outputFormat: "jpeg",
      options: targetOptions({ targetBytes: reference.length }),
      onProgress: (value) => progress.push(value),
    });
    assert.equal(result.report.achieved, true);
    assert.ok(result.report.attempts >= 3);
    assert.ok(result.report.attempts <= 8);
    const fittingQualities = result.candidates
      .filter(
        (candidate) =>
          candidate.kind === "quality-search" &&
          candidate.withinTarget &&
          candidate.smallerThanOriginal,
      )
      .map((candidate) => candidate.quality);
    assert.equal(result.report.selectedQuality, Math.max(...fittingQualities));
    assert.ok(progress.length > 0);
    const output = await readFile(result.selectedOutputPath);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg");
  } finally {
    await cleanup(directory);
  }
});

test("最低品質でも超過する場合はそこで停止し、未達と改善案を返す", async () => {
  const directory = join(tmpdir(), `target-image-floor-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.jpg");
    await writeFile(inputPath, await makeNoisyJpeg(192, 192));
    const result = await optimizer.optimizeImageToTargetSize({
      inputPath,
      directory,
      outputFormat: "jpeg",
      options: targetOptions({
        targetBytes: 1,
        minimumQuality: {
          jpeg: 63,
          webp: 30,
          avif: 25,
          videoHeight: 480,
          audioKbps: 64,
        },
      }),
    });
    assert.equal(result.report.achieved, false);
    assert.equal(result.report.attempts, 1);
    assert.equal(result.attempts[0].quality, 63);
    assert.equal(result.report.selectedQuality, 63);
    assert.ok(result.report.recommendation);
    assert.match(result.report.reason, /成功扱いにはしていません/);
  } finally {
    await cleanup(directory);
  }
});

test("0バイト画像を拒否し、元より大きい目標では圧縮しない", async () => {
  const emptyDirectory = join(tmpdir(), `target-image-empty-${randomUUID()}`);
  await mkdir(emptyDirectory, { recursive: true });
  try {
    const emptyPath = join(emptyDirectory, "empty.png");
    await writeFile(emptyPath, Buffer.alloc(0));
    await assert.rejects(
      optimizer.optimizeImageToTargetSize({
        inputPath: emptyPath,
        directory: emptyDirectory,
        options: targetOptions(),
      }),
      (error) => error?.code === "EMPTY_FILE",
    );
  } finally {
    await cleanup(emptyDirectory);
  }

  const directory = join(tmpdir(), `target-image-large-goal-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.jpg");
    const source = await makeNoisyJpeg(64, 64);
    await writeFile(inputPath, source);
    const result = await optimizer.optimizeImageToTargetSize({
      inputPath,
      directory,
      originalName: "source.jpg",
      options: targetOptions({ targetBytes: source.length + 1000 }),
    });
    assert.equal(result.selectedOutputPath, inputPath);
    assert.equal(result.report.achieved, true);
    assert.equal(result.report.attempts, 0);
    assert.match(result.report.reason, /圧縮は不要/);
  } finally {
    await cleanup(directory);
  }
});

test("PNGは可逆候補を順番に試し、非可逆禁止時は未達を成功扱いしない", async () => {
  const directory = join(tmpdir(), `target-image-png-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.png");
    const png = await sharp(noisyRgb(64, 64), {
      raw: { width: 64, height: 64, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await writeFile(inputPath, png);
    const result = await optimizer.optimizeImageToTargetSize({
      inputPath,
      directory,
      options: targetOptions({
        targetBytes: 1,
        allowLossyForPng: false,
      }),
    });
    assert.equal(result.report.achieved, false);
    assert.deepEqual(
      result.attempts.map((attempt) => [attempt.format, attempt.encoding]),
      [
        ["png", "lossless"],
        ["webp", "lossless"],
        ["avif", "lossless"],
      ],
    );
    assert.ok(result.report.recommendation);
  } finally {
    await cleanup(directory);
  }
});
