import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("ワークスペース画面は表示とイベント配線に集中している", () => {
  const source = read("components/compression-app.tsx");

  for (const dependency of [
    "inspectMediaFile",
    "processInspectedMedia",
    "processImage",
    "estimateWorkspaceOutput",
    "buildCurrentProgressEvent",
    "buildProcessingDetails",
    "toFileProgressItem",
  ]) {
    assert.match(source, new RegExp(`\\b${dependency}\\b`), dependency);
  }
  assert.doesNotMatch(source, /new TextDecoder\(/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /interface (QueueItem|ProcessResult)/);
});

test("アップロードクライアントは202受付・状態確認とエラー分類を担当する", () => {
  const source = read("features/upload/media-client.ts");

  assert.match(source, /export async function parseNdjsonStream/);
  assert.match(source, /buffer\.split\(\/\\r\?\\n\/\)/);
  assert.match(source, /UPLOAD_EXPIRED/);
  assert.match(source, /NOT_FOUND/);
  assert.match(source, /waitForProcessingResult/);
  assert.match(source, /JOB_CREATION_TIMEOUT_MS/);
});

test("進捗接続、復元、純粋な表示モデル変換を分離している", () => {
  const progress = read("features/workspace/progress.ts");
  const connection = read("features/workspace/use-job-progress.ts");
  const recovery = read("features/workspace/use-active-job-recovery.ts");

  assert.match(progress, /export function applyProgressToItem/);
  assert.match(progress, /export function buildCurrentProgressEvent/);
  assert.match(progress, /export function buildProcessingDetails/);
  assert.match(connection, /new EventSource/);
  assert.match(connection, /progressEventFromMessage/);
  assert.match(recovery, /createRecoveredQueueItem/);
  assert.match(recovery, /readStoredActiveJobs/);
});

test("主要な操作文言をリファクタリング後も維持する", () => {
  const source = read("components/compression-app.tsx");

  for (const label of [
    "ファイルを最適化",
    "最大10ファイルまで順番に処理します",
    "ファイルを最適化する",
    "キャンセル",
    "ダウンロード",
  ]) {
    assert.match(source, new RegExp(label), label);
  }
});
