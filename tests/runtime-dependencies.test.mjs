import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("ローカル・npm・CI・DockerはNode.js 22.22.0へ統一されている", () => {
  const packageJson = JSON.parse(read("package.json"));
  const workflow = read(".github/workflows/ci.yml");
  const dockerfile = read("Dockerfile");

  assert.equal(read(".nvmrc").trim(), "22.22.0");
  assert.equal(read(".node-version").trim(), "22.22.0");
  assert.equal(packageJson.engines.node, ">=22.13.0 <23");
  assert.equal(packageJson.packageManager, "npm@10.9.4");
  assert.match(workflow, /node-version-file: ["']?\.nvmrc["']?/);
  assert.doesNotMatch(workflow, /node-version:\s*20/);
  assert.match(dockerfile, /FROM node:22\.22\.0-bookworm-slim/g);
  assert.doesNotMatch(dockerfile, /FROM node:20/);
});

test("PostCSS overrideとlockfileは修正版8.5.14を使用する", () => {
  const packageJson = JSON.parse(read("package.json"));
  const lockfile = JSON.parse(read("package-lock.json"));
  assert.equal(packageJson.overrides.postcss, "8.5.14");

  const postcssPackages = Object.entries(lockfile.packages).filter(([path]) =>
    path.endsWith("node_modules/postcss"),
  );
  assert.ok(postcssPackages.length > 0);
  for (const [, metadata] of postcssPackages) {
    assert.equal(metadata.version, "8.5.14");
  }
});
