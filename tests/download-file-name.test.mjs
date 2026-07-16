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

const names = loadTypeScriptModule("shared/files/create-compressed-file-name.ts");
const headers = loadTypeScriptModule("shared/files/content-disposition.ts");
const browser = loadTypeScriptModule("shared/files/download-blob.ts");

test("元名の最後の拡張子だけを外して実出力拡張子を付ける", () => {
  assert.equal(names.createCompressedFileName("photo.jpg", "webp"), "photo_comp.webp");
  assert.equal(
    names.createCompressedFileName("sample.photo.jpg", ".PNG"),
    "sample.photo_comp.png",
  );
  assert.equal(names.createCompressedFileName("file", "png"), "file_comp.png");
  assert.equal(names.createCompressedFileName("audio.wav", "mp3"), "audio_comp.mp3");
  assert.equal(names.createCompressedFileName("photo.jpg", "avif"), "photo_comp.avif");
  assert.doesNotMatch(names.createCompressedFileName("photo.jpg", "webp"), /\.jpg/i);
});

test("日本語と複数ドットを保ち、無効文字と末尾の空白・ピリオドを除去する", () => {
  assert.equal(
    names.createCompressedFileName("資料.最終版.png", "avif"),
    "資料.最終版_comp.avif",
  );
  assert.equal(
    names.createCompressedFileName('bad<>:"/\\|?*.jpg', "webp"),
    "bad__________comp.webp",
  );
  assert.equal(names.createCompressedFileName("photo. .jpg", "webp"), "photo_comp.webp");
  assert.equal(names.createCompressedFileName(".jpg", "png"), "compressed_file_comp.png");
});

test("同名ファイルとZIPエントリーは大文字小文字を問わず連番で衝突回避する", () => {
  const used = new Set();
  assert.equal(
    names.createUniqueDownloadFileName("photo_comp.webp", used),
    "photo_comp.webp",
  );
  assert.equal(
    names.createUniqueDownloadFileName("PHOTO_COMP.webp", used),
    "PHOTO_COMP_2.webp",
  );
  assert.deepEqual(
    names.createZipEntryFileNames([
      { originalFileName: "photo.jpg", outputExtension: "webp" },
      { originalFileName: "photo.png", outputExtension: "webp" },
      { originalFileName: "photo.tiff", outputExtension: "webp" },
    ]),
    ["photo_comp.webp", "photo_comp_2.webp", "photo_comp_3.webp"],
  );
  assert.equal(names.COMPRESSION_ZIP_FILE_NAME, "compression_files_comp.zip");
});

test("Content-DispositionはASCII fallbackとUTF-8名を持ち改行を除去する", () => {
  const value = headers.createContentDisposition("資料_comp.webp\r\nX-Test: yes");
  assert.match(value, /^attachment; filename="/);
  assert.match(value, /filename\*=UTF-8''/);
  assert.doesNotMatch(value, /[\r\n]/);
  assert.doesNotMatch(value, /X-Test: yes/);
});

test("Blobダウンロードはdownload属性を設定しObject URLを必ず解放する", () => {
  const calls = [];
  const anchor = {
    href: "",
    download: "",
    hidden: false,
    click: () => calls.push("click"),
    remove: () => calls.push("remove"),
  };
  browser.downloadBlob(new Blob(["ok"]), "photo_comp.webp", {
    document: {
      body: { append: () => calls.push("append") },
      createElement: () => anchor,
    },
    url: {
      createObjectURL: () => "blob:test",
      revokeObjectURL: (url) => calls.push(`revoke:${url}`),
    },
  });
  assert.equal(anchor.download, "photo_comp.webp");
  assert.deepEqual(calls, ["append", "click", "remove", "revoke:blob:test"]);
});

test("APIとUIは内部名ではなく共通の保存名を使用する", () => {
  const fileRoute = readFileSync(resolve(root, "app/api/files/[jobId]/route.ts"), "utf8");
  const storage = readFileSync(resolve(root, "lib/storage/temp-storage.ts"), "utf8");
  const summary = readFileSync(
    resolve(root, "components/progress/compression-summary.tsx"),
    "utf8",
  );
  assert.match(fileRoute, /createContentDisposition/);
  assert.match(fileRoute, /manifest\.downloadName/);
  assert.match(storage, /const internalName = basename\(resolvedCurrentPath\)/);
  assert.doesNotMatch(storage, /await rename\(resolvedCurrentPath/);
  assert.match(storage, /createCompressedFileName\(originalName, extension\)/);
  assert.match(summary, /download=\{downloadName\}/);
  assert.match(summary, /保存名:/);
});
