import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function loadOutputFormats() {
  const absolutePath = resolve(root, "shared/media/output-formats.ts");
  const source = readFileSync(absolutePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(
    () => {
      throw new Error("Unexpected import");
    },
    module,
    module.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return module.exports;
}

const formats = loadOutputFormats();

test("画像・動画・音声には同じ種別のホワイトリストだけを返す", () => {
  assert.deepEqual(
    formats.getOutputFormatsForCategory("image").map((item) => item.value),
    ["jpeg", "png", "webp", "avif", "tiff", "gif"],
  );
  assert.deepEqual(
    formats.getOutputFormatsForCategory("video").map((item) => item.value),
    ["mp4", "webm", "mkv", "mov"],
  );
  assert.deepEqual(
    formats.getOutputFormatsForCategory("audio").map((item) => item.value),
    ["mp3", "m4a", "aac", "opus", "ogg", "wav", "flac"],
  );
  assert.equal(formats.isOutputFormatForCategory("webp", "video"), false);
  assert.equal(formats.isOutputFormatForCategory("exe", "image"), false);
});

test("コンテナとコーデックの互換性をホワイトリストで検証する", () => {
  assert.equal(formats.isVideoCodecAllowed("mp4", "h264"), true);
  assert.equal(formats.isVideoAudioCodecAllowed("mp4", "aac"), true);
  assert.equal(formats.isVideoAudioCodecAllowed("webm", "aac"), false);
  assert.equal(formats.isVideoCodecAllowed("webm", "vp9"), true);
  assert.equal(formats.isVideoCodecAllowed("mov", "av1"), false);
});

test("拡張子とMIMEタイプは実出力形式に対応する", () => {
  const expected = {
    jpeg: ["jpg", "image/jpeg"],
    avif: ["avif", "image/avif"],
    mp4: ["mp4", "video/mp4"],
    webm: ["webm", "video/webm"],
    mp3: ["mp3", "audio/mpeg"],
    m4a: ["m4a", "audio/mp4"],
    wav: ["wav", "audio/wav"],
    flac: ["flac", "audio/flac"],
  };
  for (const [value, [extension, mimeType]] of Object.entries(expected)) {
    const definition = formats.getOutputFormatDefinition(value);
    assert.equal(definition.extension, extension);
    assert.equal(definition.mimeType, mimeType);
  }
});

test("UIは透過・PNG警告、背景色、ファイル別選択と同種一括適用を備える", () => {
  const warning = readFileSync(
    resolve(root, "components/output-format/OutputFormatWarning.tsx"),
    "utf8",
  );
  const sharpService = readFileSync(
    resolve(root, "infrastructure/sharp/image-service.ts"),
    "utf8",
  );
  const workspace = readFileSync(resolve(root, "components/compression-app.tsx"), "utf8");
  assert.match(warning, /JPEGは透過に対応していません/);
  assert.match(warning, /PNGへ変換するとファイルサイズが大きくなる可能性があります/);
  assert.match(sharpService, /flatten\(\{ background \}\)/);
  assert.match(workspace, /このファイルの出力形式/);
  assert.match(workspace, /一括適用/);
  assert.match(workspace, /異なるメディア種別へ同じ出力形式/);
});

test("実行環境にない形式を除外し、出力内容を再解析して検証する", () => {
  const selector = readFileSync(
    resolve(root, "components/output-format/OutputFormatSelector.tsx"),
    "utf8",
  );
  const capabilities = readFileSync(
    resolve(root, "lib/capabilities/runtime-capabilities.ts"),
    "utf8",
  );
  const validation = readFileSync(
    resolve(root, "lib/media/output-validation.ts"),
    "utf8",
  );
  assert.match(selector, /availableFormats\.includes/);
  assert.match(capabilities, /compressionFilesRuntimeCapabilitiesCache/);
  assert.match(capabilities, /"-hide_banner", "-muxers"/);
  assert.match(capabilities, /"-hide_banner", "-encoders"/);
  assert.match(capabilities, /"-hide_banner", "-formats"/);
  assert.match(validation, /OUTPUT_FORMAT_MISMATCH/);
  assert.match(validation, /OUTPUT_CODEC_MISMATCH/);
});

test("要求された5つの出力形式コンポーネントを公開する", () => {
  const entry = readFileSync(resolve(root, "components/output-format/index.ts"), "utf8");
  for (const name of [
    "OutputFormatSelector",
    "OutputFormatCard",
    "OutputFormatWarning",
    "CodecSelector",
    "OutputFileNamePreview",
  ]) {
    assert.match(entry, new RegExp(name));
  }
});
