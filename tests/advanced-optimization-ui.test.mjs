import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const read = (path) => readFile(new URL(path, root), "utf8");

test("高度最適化パネルは共有型と4モードを使用する", async () => {
  const source = await read("components/advanced-optimization-panel.tsx");
  for (const typeName of [
    "AdvancedOptimizationMode",
    "LosslessImageOptions",
    "VideoStreamSelectionOptions",
    "VideoQualitySearchOptions",
  ]) {
    assert.match(source, new RegExp(typeName));
  }
  for (const mode of [
    "strict-lossless",
    "high-quality-optimization",
    "size-priority",
    "archive",
  ]) {
    assert.match(source, new RegExp(`id: "${mode}"`));
  }
});

test("モード説明は無劣化とVMAFを保証しすぎない", async () => {
  const source = await read("components/advanced-optimization-panel.tsx");
  assert.match(source, /データを変更せずに削減/);
  assert.match(source, /見た目を維持しながら削減/);
  assert.match(source, /検証成功時のみ表示/);
  assert.match(source, /VMAFは完全な画質保証ではありません/);
  assert.match(source, /高画質基準を満たした候補/);
  assert.match(
    source,
    /JPEG\s+XL（JXL）はブラウザや画像編集ソフトによって表示できない場合があります/,
  );
});

test("画像・動画の高度設定は段階開示され、入力操作にaria説明を持つ", async () => {
  const source = await read("components/advanced-optimization-panel.tsx");
  assert.match(source, /<details/);
  assert.match(source, /高度な最適化設定/);
  assert.match(source, /type="radio"/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /type="range"/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /aria-valuetext/);
  for (const option of [
    "compareWebpLossless",
    "enableJpegXl",
    "keepPrimaryAudioOnly",
    "removeSubtitles",
    "removeAttachments",
    "removeChapters",
    "includeAv1",
    "includeH265",
    "includeH264",
  ]) {
    assert.match(source, new RegExp(option));
  }
  assert.match(source, /videoDeletionPreview\?: string\[\]/);
  assert.match(source, /実行前の削除対象/);
  assert.match(source, /動画解析後に対象を表示します/);
  assert.match(source, /削除予定の項目/);
});

test("最適化レポートは判断根拠と不採用候補を表示する", async () => {
  const source = await read("components/optimization-report-card.tsx");
  for (const field of [
    "originalSize",
    "outputSize",
    "reductionPercent",
    "losslessVerification",
    "qualityAssessment",
    "selectedFormat",
    "selectedCodec",
    "candidates",
    "keptOriginal",
    "decisionReason",
  ]) {
    assert.match(source, new RegExp(`report\\.${field}`));
  }
  assert.match(source, /無劣化検証/);
  assert.match(source, /高画質基準を満たした候補/);
  assert.match(source, /VMAFは完全な画質保証ではありません/);
  assert.match(source, /不採用候補/);
  assert.match(source, /元ファイルを維持しました/);
});

test("容量増加と低品質区間を明示する", async () => {
  const source = await read("components/optimization-report-card.tsx");
  assert.match(source, /容量が増加しました/);
  assert.match(source, /lowQualitySegments/);
  assert.match(source, /しきい値を下回った区間/);
  assert.match(source, /candidate\.reason/);
  assert.match(source, /candidate\.status === "unavailable"/);
});
