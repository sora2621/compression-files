import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("目標容量入力は数値、共有単位、上限文言を提供する", async () => {
  const source = await read("components/target-size/TargetSizeInput.tsx");
  assert.match(source, /TARGET_SIZE_UNITS/);
  assert.match(source, /type="number"/);
  assert.match(source, /以下にする/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /aria-label="目標容量の単位"/);
});

test("8種のプリセットは設定ファイルから動的に描画する", async () => {
  const source = await read("components/target-size/TargetSizePreset.tsx");
  const config = await read("lib/target-size/config.ts");
  assert.match(source, /TARGET_SIZE_PRESETS/);
  assert.match(source, /Object\.values\(TARGET_SIZE_PRESETS\)/);
  assert.match(source, /presets\.map/);
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
  assert.doesNotMatch(source, /TARGET_PRESET_EMAIL_MB|TARGET_PRESET_SOCIAL_MB/);
});

test("推定は全項目と4段階の達成可能性を色・アイコン・文言で示す", async () => {
  const source = await read("components/target-size/TargetSizeEstimate.tsx");
  for (const state of [
    "achievable",
    "settings-recommended",
    "quality-risk",
    "difficult",
  ]) {
    assert.ok(
      source.includes(`${state}:`) || source.includes(`${JSON.stringify(state)}:`),
      state,
    );
  }
  for (const label of [
    "元の容量",
    "目標容量",
    "約出力容量",
    "約削減率",
    "約処理時間",
    "画質への影響",
    "解像度",
    "形式・コーデック",
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /FeasibilityIcon/);
  assert.match(source, /aria-live="polite"/);
});

test("パネルは音声選択、品質下限、PNG非可逆、JPEG背景、再エンコード注意を備える", async () => {
  const [panel, warning] = await Promise.all([
    read("components/target-size/TargetSizePanel.tsx"),
    read("components/target-size/TargetSizeWarning.tsx"),
  ]);
  assert.match(panel, /AUDIO_BITRATE_CANDIDATES_KBPS\.map/);
  assert.match(panel, /VIDEO_HEIGHT_CANDIDATES\.map/);
  assert.match(panel, /value="auto"/);
  assert.match(panel, /value="remove"/);
  assert.match(panel, /音声を削除すると音声ストリーム分の容量を削減/);
  assert.match(panel, /PNGの非可逆圧縮を許可/);
  assert.match(panel, /透過画像をJPEGにする背景色を指定/);
  assert.match(panel, /品質下限と変換許可/);
  assert.match(panel, /<details/);
  assert.match(warning, /元ファイル以上のため圧縮は不要/);
  assert.match(warning, /完全無劣化モードとは別/);
  assert.match(warning, /再エンコード/);
});

test("解像度変更は提案と確認チェックを分離する", async () => {
  const source = await read("components/target-size/TargetSizeRecommendation.tsx");
  assert.match(source, /解像度変更の提案/);
  assert.match(source, /自動では適用しません/);
  assert.match(source, /type="checkbox"/);
  assert.match(source, /onAllowResolutionChangeChange/);
});

test("結果カードは達成結果、超過理由、代替案の全フィールドを表示する", async () => {
  const source = await read("components/target-size/TargetSizeResultCard.tsx");
  for (const field of [
    "requestedBytes",
    "actualBytes",
    "differenceBytes",
    "achieved",
    "originalBytes",
    "savedBytes",
    "reductionPercent",
    "attempts",
    "selectedQuality",
    "selectedResolution",
    "selectedCodec",
    "selectedAudioKbps",
    "reason",
    "recommendation",
  ])
    assert.match(source, new RegExp(`result\\.${field}`));
  assert.match(source, /超過した理由/);
  assert.match(source, /代替選択肢/);
  assert.match(source, /minimumAchievableBytes/);
  assert.match(source, /alternatives\.map/);
});

test("target-sizeの公開入口は全UI部品をexportする", async () => {
  const source = await read("components/target-size/index.ts");
  for (const name of [
    "TargetSizeInput",
    "TargetSizePreset",
    "TargetSizeEstimate",
    "TargetSizeWarning",
    "TargetSizeRecommendation",
    "TargetSizePanel",
    "TargetSizeResultCard",
  ])
    assert.match(source, new RegExp(name));
});
