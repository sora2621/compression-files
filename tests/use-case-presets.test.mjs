import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("用途別設定は7つの独立した設定ファイルで管理する", () => {
  const names = [
    "web",
    "email",
    "social",
    "smartphone",
    "print",
    "archive",
    "presentation",
  ];
  for (const name of names) {
    const source = read(`features/use-case-presets/config/${name}-preset.ts`);
    assert.match(source, new RegExp(`id: "${name}"`));
    assert.match(source, /image:/);
    assert.match(source, /video:/);
    assert.match(source, /audio:/);
    assert.match(source, /targetMegabytes:/);
  }
});

test("用途選択は解析後に確認を挟み、手動設定と実行を分離する", () => {
  const page = read("components/pages/optimize-page.tsx");
  const selector = read("components/use-case-presets/use-case-selector.tsx");
  const confirmation = read("components/use-case-presets/use-case-confirmation.tsx");
  assert.match(page, /analyzeFiles\(files\)/);
  assert.match(page, /type Stage = "select" \| "confirm" \| "manual" \| "processing"/);
  assert.match(selector, /どこで使いますか？/);
  assert.match(selector, /選ぶだけでは処理を開始しません/);
  assert.match(confirmation, /この設定で開始/);
  assert.match(confirmation, /設定を変更/);
  assert.match(page, /openDetails=\{stage === "manual"\}/);
});

test("画像の用途別解像度は拡大せずSharp処理へ伝播する", () => {
  const client = read("features/upload/media-client.ts");
  const route = read("app/api/process/route.ts");
  const sharpService = read("infrastructure/sharp/image-service.ts");
  assert.match(client, /body\.append\("imageMaxDimension"/);
  assert.match(route, /maxDimension: imageMaxDimension/);
  assert.match(sharpService, /withoutEnlargement: true/);
});
