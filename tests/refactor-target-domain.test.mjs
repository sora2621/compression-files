import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(absolutePath, "utf8"), {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  new Function("require", "module", "exports", "__filename", "__dirname", outputText)(
    nativeRequire,
    module,
    module.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return module.exports;
}

const qualitySearch = loadTypeScriptModule(
  "features/target-size/domain/image-quality-search.ts",
);

test("画像品質探索の境界更新は目標達否だけで決まる純粋関数である", () => {
  const bounds = { lowestQuality: 61, highestQuality: 99 };
  assert.deepEqual(qualitySearch.updateImageQualityBounds(bounds, 80, true), {
    lowestQuality: 81,
    highestQuality: 99,
  });
  assert.deepEqual(qualitySearch.updateImageQualityBounds(bounds, 80, false), {
    lowestQuality: 61,
    highestQuality: 79,
  });
  assert.equal(bounds.lowestQuality, 61);
});

test("二分探索は目標以下で最も高い品質を選び、外部エンコーダーを注入できる", async () => {
  const evaluated = [];
  const result = await qualitySearch.findMaximumImageQuality({
    minimumQuality: 61,
    maximumQuality: 99,
    maximumAttempts: 8,
    targetSizeBytes: 700,
    toleranceBytes: 10,
    initialBest: {
      quality: 60,
      outputBytes: 600,
      isWithinTarget: true,
      isSmallerThanOriginal: true,
    },
    evaluateQuality: async (quality) => {
      evaluated.push(quality);
      const outputBytes = quality * 10;
      return {
        quality,
        outputBytes,
        isWithinTarget: outputBytes <= 700,
        isSmallerThanOriginal: true,
      };
    },
  });
  assert.equal(result.bestEvaluation.quality, 70);
  assert.ok(result.attempts <= 8);
  assert.ok(evaluated.length < 39);
});

test("許容差は目標を超えた候補を合格にしない", () => {
  assert.equal(qualitySearch.isImageQualityWithinTolerance(1_000, 995, 10), true);
  assert.equal(qualitySearch.isImageQualityWithinTolerance(1_000, 1_001, 10), false);
});
