import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("6ページの操作フローが実装されている", () => {
  for (const route of [
    "app/page.tsx",
    "app/optimize/page.tsx",
    "app/processing/[jobId]/page.tsx",
    "app/result/[jobId]/page.tsx",
    "app/history/page.tsx",
    "app/settings/page.tsx",
  ])
    assert.equal(existsSync(new URL(`../${route}`, import.meta.url)), true, route);
});

test("アップロードはドラッグ、複数選択、クリップボード、個別拒否に対応する", () => {
  const source = read("components/workspace/file-dropzone.tsx");
  assert.match(source, /onDrop=/);
  assert.match(source, /multiple/);
  assert.match(source, /addEventListener\("paste"/);
  assert.match(source, /RejectedFile/);
  assert.match(source, /実行ファイルは安全のため/);
});

test("高度最適化4モード、品質プリセット、おすすめ確認を表示する", () => {
  const source = read("components/pages/optimize-page.tsx");
  for (const label of ["完全無劣化", "高画質最適化", "容量優先", "アーカイブ"])
    assert.match(source, new RegExp(label));
  assert.match(source, /useState<GuidedMode>\("high-quality-optimization"\)/);
  assert.match(source, /useState<QualityPreset>\("balanced"\)/);
  assert.match(source, /RecommendationCard/);
});

test("基本設定と詳細設定を段階的に開示する", () => {
  const guided = read("components/workspace/settings-sections.tsx");
  const app = read("components/compression-app.tsx");
  assert.match(guided, /BasicSettings/);
  assert.match(guided, /<details/);
  assert.match(app, /詳細設定/);
  assert.match(app, /hasImages/);
  assert.match(app, /hasVideos/);
  assert.match(app, /hasAudio/);
});

test("ファイル一覧は選択、削除、種類フィルターを提供する", () => {
  const source = read("components/workspace/file-list.tsx");
  assert.match(source, /すべて選択/);
  assert.match(source, /選択を削除/);
  assert.match(source, /ファイル種別で絞り込む/);
});

test("固定アクションバーは件数と容量推定、主要操作を表示する", () => {
  const source = read("components/workspace/sticky-action-bar.tsx");
  assert.match(source, /sticky bottom-0/);
  assert.match(source, /estimatedOutputSize/);
  assert.match(source, /estimatedSavedSize/);
});

test("進捗画面は復元、SSE、キャンセル、結果への遷移に対応する", () => {
  const source = read("components/pages/processing-page.tsx");
  assert.match(source, /\/api\/jobs\/\$\{jobId\}/);
  assert.match(source, /EventSource/);
  assert.match(source, /pollWhileDisconnected/);
  assert.match(source, /CancelProcessingDialog/);
  assert.match(source, /router\.replace\(`\/result\/\$\{jobId\}`\)/);
});

test("結果画面は容量、比較、ダウンロード、再処理を表示する", () => {
  const source = read("components/pages/result-page.tsx");
  assert.match(source, /CompressionSummary/);
  assert.match(source, /BeforeAfterImage/);
  assert.match(source, /BeforeAfterVideo/);
  assert.match(source, /CompressionComparison/);
  assert.match(source, /downloadUrl/);
});

test("履歴と設定を端末内へ保存し、保存期間を処理へ反映する", () => {
  const provider = read("components/app/workspace-provider.tsx");
  const imageRoute = read("app/api/process/route.ts");
  const mediaRoute = read("app/api/media/process/route.ts");
  assert.match(provider, /compression-files:history:v1/);
  assert.match(provider, /compression-files:preferences:v1/);
  assert.match(imageRoute, /retentionMinutes/);
  assert.match(mediaRoute, /retentionMinutes/);
});

test("専門用語ヘルプはキーボードとaria-describedbyに対応する", () => {
  const source = read("components/workspace/setting-help.tsx");
  assert.match(source, /<details/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /aria-label/);
});

test("ダイアログはEscapeとフォーカス復帰に対応する", () => {
  const source = read("components/ui/confirm-dialog.tsx");
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /previous\?\.focus/);
  assert.match(source, /aria-modal="true"/);
});

test("進捗と状態はスクリーンリーダーへ通知される", () => {
  const circular = read("components/progress/circular-progress.tsx");
  const overall = read("components/progress/overall-progress-card.tsx");
  assert.match(circular, /role="progressbar"/);
  assert.match(circular, /aria-valuenow/);
  assert.match(circular, /aria-valuetext/);
  assert.match(overall, /aria-live="polite"/);
});

test("ダークモードと動きの抑制、モバイル固定操作に対応する", () => {
  const css = read("app/globals.css");
  const home = read("components/pages/home-page.tsx");
  assert.match(css, /\.dark/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(home, /fixed inset-x-0 bottom-0/);
});

test("処理中のページ離脱に確認を表示する", () => {
  const workspace = read("components/compression-app.tsx");
  const processing = read("components/pages/processing-page.tsx");
  assert.match(workspace, /beforeunload/);
  assert.match(processing, /beforeunload/);
});

test("指定された再利用コンポーネントを公開する", () => {
  const source = read("components/ui/index.ts");
  for (const name of [
    "AppHeader",
    "FileDropzone",
    "FileCard",
    "FileList",
    "ProcessingModeCard",
    "QualityPresetCard",
    "RecommendationCard",
    "BasicSettings",
    "AdvancedSettings",
    "SettingHelp",
    "StickyActionBar",
    "OverallProgress",
    "ProcessingSteps",
    "FileProgressCard",
    "ResultSummary",
    "BeforeAfterImage",
    "BeforeAfterVideo",
    "CompressionComparison",
    "UserFriendlyError",
    "ConfirmDialog",
    "EmptyState",
    "LoadingSkeleton",
    "Toast",
  ])
    assert.match(source, new RegExp(name));
});
