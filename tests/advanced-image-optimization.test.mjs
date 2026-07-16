import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);

function createTypeScriptLoader() {
  const cache = new Map();
  const load = (relativePath) => {
    const absolutePath = resolve(root, relativePath);
    if (cache.has(absolutePath)) return cache.get(absolutePath).exports;
    const module = { exports: {} };
    cache.set(absolutePath, module);
    const { outputText } = ts.transpileModule(readFileSync(absolutePath, "utf8"), {
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
      return load(extname(base) ? base : `${base}.ts`);
    };
    new Function("require", "module", "exports", "__filename", "__dirname", outputText)(
      localRequire,
      module,
      module.exports,
      absolutePath,
      dirname(absolutePath),
    );
    return module.exports;
  };
  return load;
}

test("高度画像最適化は固定引数・shell無効・実画像検証を使用する", () => {
  const optimization = readFileSync(
    resolve(root, "lib/optimization/image-lossless.ts"),
    "utf8",
  );
  const capabilities = readFileSync(
    resolve(root, "lib/optimization/tool-capabilities.ts"),
    "utf8",
  );
  assert.match(optimization, /shell: false/);
  assert.match(capabilities, /shell: false/);
  assert.match(optimization, /"--strip", "safe"/);
  assert.match(optimization, /Sharp sRGB RGBA SHA-256/);
  assert.match(optimization, /outputRgbaHash !== options\.sourceRgbaHash/);
  assert.match(optimization, /"-optimize"/);
  assert.match(optimization, /"-progressive"/);
  assert.match(optimization, /"--lossless_jpeg=1"/);
  assert.match(optimization, /sourceHash === restoredHash/);
  assert.match(
    optimization,
    /bestGenerated && \(bestGenerated\.report\.size \?\? Infinity\) < originalDetails\.size/,
  );
});

test("PNG候補はRGBA一致を検証し、大きくならない候補だけを選択する", async () => {
  const environmentNames = [
    "OXIPNG_PATH",
    "ZOPFLIPNG_PATH",
    "JPEGTRAN_PATH",
    "CJXL_PATH",
    "DJXL_PATH",
  ];
  const previous = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  for (const name of environmentNames) {
    process.env[name] = `missing-${name.toLowerCase()}-${randomUUID()}.exe`;
  }
  const directory = join(tmpdir(), `advanced-png-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.png");
    const pixels = Buffer.from([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0,
    ]);
    const png = await sharp(pixels, {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await writeFile(inputPath, png);

    const load = createTypeScriptLoader();
    const optimization = load("lib/optimization/image-lossless.ts");
    const result = await optimization.optimizeLosslessImage({
      inputPath,
      directory,
      originalName: "sample.png",
      options: {
        stripPrivacyMetadata: true,
        compareWebpLossless: true,
        enableJpegXl: false,
      },
    });
    assert.equal(result.report.losslessVerification.status, "passed");
    assert.ok(result.report.outputSize <= result.report.originalSize);
    const selected = result.report.candidates.find(
      (candidate) => candidate.status === "selected",
    );
    assert.ok(selected);
    assert.equal(selected.losslessVerified, true);
    assert.ok(
      result.report.candidates.some(
        (candidate) => candidate.id === "oxipng" && candidate.status === "unavailable",
      ),
    );
    await stat(result.selectedOutputPath);
    const [beforeSource, afterSource] = await Promise.all([
      readFile(inputPath),
      readFile(result.selectedOutputPath),
    ]);
    const [before, after] = await Promise.all([
      sharp(beforeSource).ensureAlpha().raw().toBuffer(),
      sharp(afterSource).ensureAlpha().raw().toBuffer(),
    ]);
    assert.deepEqual(after, before);
  } finally {
    for (const name of environmentNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

test("jpegtranとJPEG XLがなければJPEGは元ファイルを採用して理由を報告する", async () => {
  const environmentNames = ["JPEGTRAN_PATH", "CJXL_PATH", "DJXL_PATH"];
  const previous = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  for (const name of environmentNames) {
    process.env[name] = `missing-${name.toLowerCase()}-${randomUUID()}.exe`;
  }
  const directory = join(tmpdir(), `advanced-jpeg-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    const inputPath = join(directory, "source.jpg");
    const jpeg = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .jpeg({ quality: 91 })
      .toBuffer();
    await writeFile(inputPath, jpeg);
    const load = createTypeScriptLoader();
    const tools = load("lib/optimization/tool-capabilities.ts");
    tools.clearImageOptimizationToolCapabilityCache();
    const optimization = load("lib/optimization/image-lossless.ts");
    const result = await optimization.optimizeLosslessImage({
      inputPath,
      directory,
      originalName: "photo.jpg",
      options: {
        stripPrivacyMetadata: false,
        compareWebpLossless: false,
        enableJpegXl: true,
      },
    });
    assert.equal(result.report.keptOriginal, true);
    assert.equal(result.report.selectedCandidateId, "original");
    assert.equal(result.selectedOutputPath, inputPath);
    assert.ok(
      result.report.candidates.some(
        (candidate) => candidate.id === "jpegtran" && candidate.status === "unavailable",
      ),
    );
    assert.ok(
      result.report.candidates.some(
        (candidate) =>
          candidate.id === "jpeg-xl-reconstruction" && candidate.status === "unavailable",
      ),
    );
  } finally {
    for (const name of environmentNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});
