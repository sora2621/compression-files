import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
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
  const execute = new Function(
    "require",
    "module",
    "exports",
    "__filename",
    "__dirname",
    outputText,
  );
  execute(
    localRequire,
    loadedModule,
    loadedModule.exports,
    absolutePath,
    dirname(absolutePath),
  );
  return loadedModule.exports;
}

const errors = loadTypeScriptModule("lib/errors.ts");
const logging = loadTypeScriptModule("shared/logging/logger.ts");

test("AppError keeps its legacy constructor and exposes separated diagnostics", () => {
  const legacy = new errors.AppError("利用者向け", 409, "LEGACY_CODE");
  assert.equal(legacy.message, "利用者向け");
  assert.equal(legacy.userMessage, "利用者向け");
  assert.equal(legacy.internalMessage, "利用者向け");
  assert.equal(legacy.status, 409);
  assert.equal(legacy.code, "LEGACY_CODE");
  assert.equal(legacy.retryable, false);

  const cause = new Error("private diagnostic");
  const detailed = new errors.AppError("安全な案内", {
    status: 422,
    code: "DETAILED",
    internalMessage: "Decoder rejected the stream.",
    retryable: true,
    cause,
  });
  assert.equal(detailed.message, "安全な案内");
  assert.equal(detailed.internalMessage, "Decoder rejected the stream.");
  assert.equal(detailed.retryable, true);
  assert.equal(detailed.cause, cause);
  assert.deepEqual(errors.errorResponse(detailed), {
    status: 422,
    body: { error: "安全な案内", code: "DETAILED" },
  });
});

test("classified errors provide stable status, code and retry policy", () => {
  const classifications = [
    [errors.UnsupportedMediaError, 415, "UNSUPPORTED_MEDIA", false],
    [errors.InvalidFileError, 400, "INVALID_FILE", false],
    [errors.CorruptedMediaError, 422, "CORRUPTED_MEDIA", false],
    [errors.ProcessingTimeoutError, 408, "PROCESSING_TIMEOUT", true],
    [errors.TargetSizeUnreachableError, 422, "TARGET_SIZE_UNREACHABLE", false],
    [errors.InsufficientStorageError, 507, "INSUFFICIENT_STORAGE", true],
    [errors.FfmpegExecutionError, 422, "FFMPEG_EXECUTION_FAILED", false],
    [errors.OutputValidationError, 422, "OUTPUT_VALIDATION_FAILED", false],
  ];

  for (const [ErrorType, status, code, retryable] of classifications) {
    const error = new ErrorType();
    assert.ok(error instanceof errors.AppError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    assert.ok(error.userMessage.length > 0);
    assert.ok(error.internalMessage.length > 0);
  }
});

test("structured logger uses an allowlist and drops path-like identifiers", () => {
  const payload = logging.createStructuredLogPayload({
    jobId: "job-123",
    fileId: "file_456",
    stage: "video-encoding",
    errorCode: "FFMPEG_EXECUTION_FAILED",
    elapsedMs: 1250.5,
    originalName: "family-trip.mov",
    inputPath: "C:\\private\\family-trip.mov",
    latitude: 35.0,
  });
  assert.deepEqual(payload, {
    jobId: "job-123",
    fileId: "file_456",
    stage: "video-encoding",
    errorCode: "FFMPEG_EXECUTION_FAILED",
    elapsedMs: 1250.5,
  });
  assert.ok(Object.isFrozen(payload));

  assert.deepEqual(
    logging.createStructuredLogPayload({
      jobId: "C:\\private\\source.bin",
      fileId: "/tmp/source.bin",
      stage: "decode /tmp/source.bin",
      elapsedMs: -1,
    }),
    {},
  );
});

test("logger delegates only normalized structured entries to an injectable sink", () => {
  const entries = [];
  const logger = logging.createLogger((level, payload) => {
    entries.push({ level, payload });
  });
  logger.error({
    jobId: "job-9",
    stage: "output-validation",
    errorCode: "OUTPUT_VALIDATION_FAILED",
  });
  assert.deepEqual(entries, [
    {
      level: "error",
      payload: {
        jobId: "job-9",
        stage: "output-validation",
        errorCode: "OUTPUT_VALIDATION_FAILED",
      },
    },
  ]);
});

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test("application code does not bypass the shared logger", async () => {
  const files = (
    await Promise.all(
      ["app", "features", "infrastructure", "lib", "shared"].map((directory) =>
        sourceFiles(resolve(root, directory)),
      ),
    )
  ).flat();
  const directConsoleCalls = files
    .filter((file) => !file.endsWith(join("shared", "logging", "logger.ts")))
    .filter((file) =>
      /console\.(?:log|info|warn|error|debug)\s*\(/.test(readFileSync(file, "utf8")),
    )
    .map((file) => file.slice(root.length));
  assert.deepEqual(directConsoleCalls, []);
});
