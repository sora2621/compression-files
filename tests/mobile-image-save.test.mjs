import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const loaded = { exports: {} };
  moduleCache.set(absolutePath, loaded);
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
    loaded,
    loaded.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return loaded.exports;
}

class MockFile extends Blob {
  constructor(bits, name, options = {}) {
    super(bits, options);
    this.name = name;
    this.lastModified = options.lastModified ?? 0;
  }
}

const saveModule = loadTypeScriptModule("shared/files/save-image-to-device.ts");

function createDownloadDependencies(calls) {
  const anchor = {
    href: "",
    download: "",
    hidden: false,
    click: () => calls.push("click"),
    remove: () => calls.push("remove"),
  };
  return {
    anchor,
    document: {
      body: { append: () => calls.push("append") },
      createElement: () => anchor,
    },
    url: {
      createObjectURL: () => "blob:compressed-image",
      revokeObjectURL: (url) => calls.push(`revoke:${url}`),
    },
  };
}

test("Web Share API対応時はBlobからFileを作成して共有する", async () => {
  let shared;
  const result = await saveModule.saveImageToDevice(
    {
      blob: new Blob(["image"], { type: "image/webp" }),
      fileName: "photo_comp.webp",
      mimeType: "image/webp",
      title: "画像を保存: photo_comp.webp",
    },
    {
      File: MockFile,
      location: { protocol: "https:" },
      navigator: {
        canShare: ({ files }) => files[0] instanceof MockFile,
        share: async (data) => {
          shared = data;
        },
      },
    },
  );

  assert.deepEqual(result, { status: "saved", method: "share" });
  assert.equal(shared.files[0].name, "photo_comp.webp");
  assert.equal(shared.files[0].type, "image/webp");
  assert.equal(shared.title, "画像を保存: photo_comp.webp");
  assert.match(shared.text, /Compression Files/);
});

test("canShareがfalseの場合はdownload属性を使いObject URLを解放する", async () => {
  const calls = [];
  const download = createDownloadDependencies(calls);
  const result = await saveModule.saveImageToDevice(
    { blob: new Blob(["image"]), fileName: "photo_comp.avif" },
    {
      ...download,
      File: MockFile,
      location: { protocol: "https:" },
      navigator: { canShare: () => false, share: async () => assert.fail() },
    },
  );

  assert.deepEqual(result, { status: "saved", method: "download" });
  assert.equal(download.anchor.download, "photo_comp.avif");
  assert.deepEqual(calls, ["append", "click", "remove", "revoke:blob:compressed-image"]);
});

test("navigator.shareがない場合は通常ダウンロードする", async () => {
  const calls = [];
  const download = createDownloadDependencies(calls);
  const result = await saveModule.saveImageToDevice(
    { blob: new Blob(["image"]), fileName: "photo_comp.webp" },
    {
      ...download,
      File: MockFile,
      location: { protocol: "https:" },
      navigator: { canShare: () => true },
    },
  );

  assert.equal(result.method, "download");
  assert.ok(calls.includes("revoke:blob:compressed-image"));
});

test("共有をキャンセルした場合は失敗にせずcancelledを返す", async () => {
  const cancellation = new Error("cancelled");
  cancellation.name = "AbortError";
  const result = await saveModule.saveImageToDevice(
    { blob: new Blob(["image"]), fileName: "photo_comp.webp" },
    {
      File: MockFile,
      location: { protocol: "https:" },
      navigator: {
        canShare: () => true,
        share: async () => {
          throw cancellation;
        },
      },
    },
  );

  assert.deepEqual(result, { status: "cancelled", method: "share" });
});

test("モバイル保存UIは無効状態、二重操作防止、Safe Area、aria-liveを備える", () => {
  const button = readFileSync(
    resolve(root, "components/files/mobile-image-download-button.tsx"),
    "utf8",
  );
  const status = readFileSync(
    resolve(root, "components/files/image-save-status.tsx"),
    "utf8",
  );

  assert.match(button, /const disabled = !blob \|\| loading \|\| saving/);
  assert.match(button, /saveLock\.current/);
  assert.match(button, /disabled=\{disabled\}/);
  assert.match(button, /type="button"/);
  assert.match(button, /min-h-12/);
  assert.match(button, /fixed inset-x-0 bottom-0/);
  assert.match(button, /env\(safe-area-inset-bottom\)/);
  assert.match(button, /保存名:/);
  assert.match(status, /aria-live=/);
  assert.match(status, /role=\{error \? "alert" : "status"\}/);
});

test("画像ライブラリ入力は画像だけを複数選択し選択分だけを渡す", () => {
  const picker = readFileSync(
    resolve(root, "components/files/image-library-picker.tsx"),
    "utf8",
  );

  assert.match(picker, /type="file"/);
  assert.match(picker, /accept="image\/\*"/);
  assert.match(picker, /multiple/);
  assert.match(picker, /onImages\(Array\.from\(event\.currentTarget\.files/);
  assert.match(picker, /aria-label="ライブラリから画像を選ぶ"/);
  assert.match(picker, /type="button"/);
});
