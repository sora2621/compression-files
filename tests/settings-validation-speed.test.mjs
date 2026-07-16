import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();
const read = (path) => readFileSync(resolve(root, path), "utf8");

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
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
  new Function("require", "module", "exports", outputText)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

const validation = loadTypeScriptModule(
  "features/workspace/validate-processing-settings.ts",
);
const inspectionQueue = loadTypeScriptModule("features/upload/inspection-queue.ts");

const videoOptions = {
  mode: "copy",
  resolution: "original",
  customHeight: null,
  codec: "h264",
  quality: "balanced",
  audio: "copy",
  removeMetadata: true,
  outputContainer: "source",
};
const audioOptions = {
  processingMode: "reduce-size",
  outputFormat: "mp3",
  quality: "balanced",
  removeMetadata: true,
};
const targetSizeOptions = {
  enabled: false,
  presetId: "custom",
  targetBytes: 1_000_000,
  targetRatio: null,
  unit: "MB",
  audioMode: "auto",
  allowResolutionChange: false,
  allowLossyForPng: false,
  jpegBackground: null,
  minimumQuality: {
    jpeg: 60,
    webp: 55,
    avif: 45,
    videoHeight: 480,
    audioKbps: 64,
  },
};

test("設定確認は外部処理を含まない純粋関数で即時に完了する", () => {
  const source = read("features/workspace/validate-processing-settings.ts");
  assert.doesNotMatch(
    source,
    /child_process|spawn\(|execFile|ffprobe|ffmpeg|sharp|Real-ESRGAN|GFPGAN|VMAF/i,
  );
  const startedAt = performance.now();
  const result = validation.validateProcessingSettings({
    items: [
      {
        kind: "video",
        inspectionStatus: "ready",
        uploadId: "job-1",
        status: "queued",
      },
    ],
    processingMode: "metadata-only",
    outputFormat: "webp",
    encoding: "lossless",
    quality: 88,
    videoOptions,
    audioOptions,
    targetSizeOptions,
  });
  assert.equal(result.isValid, true);
  assert.ok(performance.now() - startedAt < 100, "validation should stay well under 1s");
});

test("不正な設定は具体的なエラーを同期的に返す", () => {
  const result = validation.validateProcessingSettings({
    items: [
      {
        kind: "video",
        inspectionStatus: "ready",
        uploadId: "job-2",
        status: "queued",
      },
    ],
    processingMode: "target-size",
    outputFormat: "webp",
    encoding: "lossy",
    quality: 101,
    videoOptions: { ...videoOptions, resolution: "custom", customHeight: 721 },
    audioOptions,
    targetSizeOptions: {
      ...targetSizeOptions,
      enabled: true,
      targetBytes: 0,
    },
  });
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((message) => message.includes("解像度")));
  assert.ok(result.errors.some((message) => message.includes("目標容量")));
});

test("ファイル解析は指定した同時実行数を超えない", async () => {
  const limit = inspectionQueue.createTaskLimiter(2);
  let active = 0;
  let maximum = 0;
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      limit(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        active -= 1;
        return index;
      }),
    ),
  );
  assert.equal(maximum, 2);
});

test("メディア開始APIは202受付後にバックグラウンド処理へ分離される", () => {
  const route = read("app/api/media/process/route.ts");
  assert.match(route, /after\(runJob\)/);
  assert.match(route, /status:\s*202/);
  assert.match(route, /status:\s*"queued"/);
  assert.doesNotMatch(route, /new ReadableStream/);
  assert.match(route, /status:\s*"analyzing-media"/);
  assert.match(route, /status:\s*"estimating-output"/);
});

test("ffprobe解析結果とFFmpeg機能一覧は再利用される", () => {
  const processRoute = read("app/api/media/process/route.ts");
  const estimateRoute = read("app/api/media/target-estimate/route.ts");
  const capabilities = read("lib/capabilities/runtime-capabilities.ts");
  assert.match(processRoute, /targetProbeFromInspection/);
  assert.match(processRoute, /videoOptimizationProbeFromInspection/);
  assert.match(processRoute, /runSampleEstimate:\s*false/);
  assert.match(estimateRoute, /targetProbeFromInspection/);
  assert.doesNotMatch(estimateRoute, /await probeTargetMedia/);
  assert.match(capabilities, /compressionFilesRuntimeCapabilitiesCache/);
  assert.match(capabilities, /expiresAt:\s*Number\.POSITIVE_INFINITY/);
  assert.match(capabilities, /Promise\.all\(\[aiPromise, ffmpegPromise\]\)/);
});

test("開始タイムアウトとSSE非依存のポーリングが実装されている", () => {
  const client = read("features/upload/media-client.ts");
  assert.match(client, /JOB_CREATION_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(client, /controller\.abort\(\)/);
  assert.match(client, /waitForProcessingResult/);
  assert.match(client, /job\.statusUrl/);
  assert.match(client, /job\.resultUrl/);
  assert.match(client, /処理の準備に時間がかかっています/);
});
