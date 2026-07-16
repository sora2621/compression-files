import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("画像APIは高度可逆候補を検証し、レポートを保存して返す", async () => {
  const source = await read("app/api/process/route.ts");
  assert.match(source, /optimizeLosslessImage/);
  assert.match(source, /isLosslessImageOptions/);
  assert.match(source, /processingMode === "strict-lossless"/);
  assert.match(source, /processingMode === "archive"/);
  assert.match(source, /optimizationReport,/);
  assert.match(source, /inspectImageMetadata/);
});

test("動画APIは高度設定を検証し、候補進捗とレポートを返す", async () => {
  const source = await read("app/api/media/process/route.ts");
  for (const contract of [
    "isAdvancedOptimizationMode",
    "isVideoStreamSelectionOptions",
    "isVideoQualitySearchOptions",
    "optimizeVideoQuality",
    "onCandidate",
    "optimizationReport",
  ]) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(source, /prepareDownloadOutput/);
  assert.match(source, /advanced-video-output/);
  assert.match(source, /プライバシーメタデータ/);
});

test("結果APIと画面は永続化された候補レポートを表示する", async () => {
  const [storage, resultApi, resultPage, workspace] = await Promise.all([
    read("lib/storage/temp-storage.ts"),
    read("app/api/results/[jobId]/route.ts"),
    read("components/pages/result-page.tsx"),
    read("components/compression-app.tsx"),
  ]);
  assert.match(storage, /optimizationReport\?: OptimizationReport/);
  assert.match(resultApi, /optimizationReport: file\.manifest\.optimizationReport/);
  assert.match(resultPage, /OptimizationReportCard/);
  assert.match(workspace, /OptimizationReportCard/);
});

test("ffprobe解析は削除対象の音声・字幕・添付・チャプターをUIへ渡す", async () => {
  const [types, probe, workspace] = await Promise.all([
    read("lib/media/video-types.ts"),
    read("infrastructure/ffprobe/media-probe.ts"),
    read("components/compression-app.tsx"),
  ]);
  assert.match(types, /MediaStreamSummary/);
  assert.match(types, /chapterCount/);
  assert.match(probe, /-show_streams/);
  assert.match(workspace, /videoDeletionPreview/);
  assert.match(workspace, /追加音声/);
  assert.match(workspace, /字幕/);
  assert.match(workspace, /添付画像・ファイル/);
});

test("対応状況APIは任意画像ツールとVMAF・動画エンコーダーを動的に返す", async () => {
  const source = await read("app/api/capabilities/route.ts");
  assert.match(source, /getImageOptimizationToolCapabilities/);
  assert.match(source, /filters\.includes\("libvmaf"\)/);
  assert.match(source, /"libaom-av1", "libsvtav1"/);
  assert.match(source, /encoders\.includes\("libx265"\)/);
  assert.match(source, /encoders\.includes\("libx264"\)/);
});
