import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("画像APIは目標容量設定を検証し、試行進捗と結果を保存する", async () => {
  const source = await read("app/api/process/route.ts");
  assert.match(source, /isTargetSizeOptions/);
  assert.match(source, /optimizeImageToTargetSize/);
  assert.match(source, /processingMode === "target-size"/);
  assert.match(source, /attempt: details\.attempt/);
  assert.match(source, /maxAttempts: details\.maximumAttempts/);
  assert.match(source, /targetSizeResult,/);
});

test("動画・音声APIは目標容量を個別サービスへ渡して達成結果を返す", async () => {
  const source = await read("app/api/media/process/route.ts");
  assert.match(source, /optimizeVideoToTargetSize/);
  assert.match(source, /optimizeAudioToTargetSize/);
  assert.match(source, /resolveTargetBytes/);
  assert.match(source, /runSampleEstimate: false/);
  assert.match(source, /probe: cachedTargetProbe/);
  assert.match(source, /targetSizeResult && !targetSizeResult\.achieved/);
});

test("サンプル推定APIは先頭・中間・終盤を処理し、一時ファイルを削除する", async () => {
  const source = await read("app/api/media/target-estimate/route.ts");
  for (const contract of [
    "sampleExtractionWindows",
    "buildSampleExtractionArgs",
    "estimateFromSamples",
    "target-estimate-${index + 1}.mp4",
    "Promise.all(samplePaths.map",
  ]) {
    assert.equal(source.includes(contract), true, contract);
  }
  assert.match(source, /request\.signal/);
});

test("結果APIと2つの結果画面は目標容量の達否を表示する", async () => {
  const [storage, api, resultPage, workspace] = await Promise.all([
    read("lib/storage/temp-storage.ts"),
    read("app/api/results/[jobId]/route.ts"),
    read("components/pages/result-page.tsx"),
    read("components/compression-app.tsx"),
  ]);
  assert.match(storage, /targetSizeResult\?: TargetSizeResult/);
  assert.match(api, /targetSizeResult: file\.manifest\.targetSizeResult/);
  assert.match(resultPage, /TargetSizeResultCard/);
  assert.match(workspace, /TargetSizeResultCard/);
});

test("進捗イベントは現在の試行回数を処理画面へ渡す", async () => {
  const [types, details, page] = await Promise.all([
    read("lib/progress/types.ts"),
    read("components/progress/processing-details.tsx"),
    read("components/pages/processing-page.tsx"),
  ]);
  assert.match(types, /attempt\?: number/);
  assert.match(types, /maxAttempts\?: number/);
  assert.match(details, /現在の試行/);
  assert.match(page, /attempt: event\.attempt/);
});

test("目標容量プリセットはコンポーネントではなく設定ファイルへ集約される", async () => {
  const [config, preset] = await Promise.all([
    read("lib/target-size/config.ts"),
    read("components/target-size/TargetSizePreset.tsx"),
  ]);
  for (const id of [
    "email",
    "social",
    "website",
    "smartphone",
    "cloud",
    "half",
    "under-100mb",
    "custom",
  ]) {
    assert.match(config, new RegExp(`${JSON.stringify(id)}|${id}:`));
  }
  assert.match(preset, /TARGET_SIZE_PRESETS/);
  assert.doesNotMatch(preset, /100 \* 1024 \* 1024/);
});
