import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

/** Load the small, dependency-free TypeScript helpers under Node 20. */
function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;

  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
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
    const resolvedPath = extname(base) ? base : `${base}.ts`;
    return loadTypeScriptModule(resolvedPath);
  };

  const execute = new Function(
    "require",
    "module",
    "exports",
    "__filename",
    "__dirname",
    outputText,
  );
  execute(localRequire, module, module.exports, absolutePath, dirname(absolutePath));
  return module.exports;
}

const ffmpeg = loadTypeScriptModule("lib/progress/ffmpeg-progress.ts");
const eta = loadTypeScriptModule("lib/progress/eta.ts");
const aggregate = loadTypeScriptModule("lib/progress/aggregate.ts");
const progressUtils = loadTypeScriptModule("components/progress/utils.ts");

test("FFmpegの時刻と機械可読な進捗ブロックを解析する", () => {
  assert.equal(ffmpeg.parseFfmpegTimestamp("01:02:03.500"), 3723.5);
  assert.equal(ffmpeg.parseFfmpegTimestamp("00:60:00"), undefined);
  assert.equal(ffmpeg.parseFfmpegTimestamp("not-a-time"), undefined);

  const parsed = ffmpeg.parseFfmpegProgressBlock({
    frame: "3820",
    fps: "54.2",
    bitrate: "1342.5kbits/s",
    total_size: "16384000",
    out_time_us: "64000000",
    out_time: "00:01:04.000000",
    dup_frames: "2",
    drop_frames: "1",
    speed: "1.8x",
    progress: "continue",
  });

  assert.deepEqual(parsed, {
    frame: 3820,
    fps: 54.2,
    bitrate: "1342.5kbits/s",
    bitrateKbps: 1342.5,
    totalSize: 16384000,
    outTimeSeconds: 64,
    outTime: "00:01:04.000000",
    duplicateFrames: 2,
    droppedFrames: 1,
    speed: "1.8x",
    speedMultiplier: 1.8,
    progress: "continue",
  });
});

test("FFmpeg進捗パーサーは任意のチャンク境界と複数ブロックを扱う", () => {
  const events = [];
  const parser = new ffmpeg.FfmpegProgressParser((event) => events.push(event));
  parser.push("frame=10\nout_time_us=2");
  parser.push("500000\nspeed=1.25x\nprogress=cont");
  parser.push("inue\r\nframe=20\r\nout_time=00:00:05.000\r\nprogress=end\r\n");
  parser.finish();

  assert.equal(events.length, 2);
  assert.equal(events[0].frame, 10);
  assert.equal(events[0].outTimeSeconds, 2.5);
  assert.equal(events[0].speedMultiplier, 1.25);
  assert.equal(events[0].progress, "continue");
  assert.equal(events[1].frame, 20);
  assert.equal(events[1].outTimeSeconds, 5);
  assert.equal(events[1].progress, "end");
});

test("動画進捗率は再生時間を優先し、フレームへフォールバックして0〜99%に制限する", () => {
  assert.equal(ffmpeg.calculateFfmpegProgress({ outTimeSeconds: 46 }, 92, 5600), 50);
  assert.equal(ffmpeg.calculateFfmpegProgress({ frame: 3820 }, undefined, 5600), 68.2);
  assert.equal(ffmpeg.calculateFfmpegProgress({ outTimeSeconds: -3 }, 92), 0);
  assert.equal(ffmpeg.calculateFfmpegProgress({ outTimeSeconds: 999 }, 92), 99);
  assert.equal(ffmpeg.calculateFfmpegProgress({ outTimeSeconds: Number.NaN }, 92), 0);
  assert.equal(ffmpeg.calculateFfmpegProgress({}, 0, 0), 0);
});

test("完了検証前は100%にならず、完了状態だけが100%になる", () => {
  for (const status of ["pending", "processing", "failed", "cancelled"]) {
    assert.equal(progressUtils.clampProgress(100, status), 99);
    assert.equal(progressUtils.clampProgress(150, status), 99);
  }
  assert.equal(progressUtils.clampProgress(99.94, "processing"), 99);
  assert.equal(progressUtils.clampProgress(4.26, "processing"), 4.3);
  assert.equal(progressUtils.clampProgress(100, "completed"), 100);
  assert.equal(progressUtils.clampProgress(Number.NaN, "processing"), 0);
  assert.equal(aggregate.clampProcessingProgress(100, "finalizing"), 99);
  assert.equal(aggregate.clampProcessingProgress(100, "completed"), 100);
});

test("推定残り時間を計算し、安定化器は十分なサンプルが集まるまで値を返さない", () => {
  assert.equal(eta.estimateRemainingSeconds(25, 30), 90);
  assert.equal(eta.estimateRemainingSeconds(0, 30), undefined);
  assert.equal(eta.estimateRemainingSeconds(100, 30), undefined);
  assert.equal(eta.estimateRemainingSeconds(Number.NaN, 30), undefined);

  const estimator = new eta.StableEtaEstimator(5, 3);
  assert.equal(estimator.update(5, 2), undefined);
  assert.equal(estimator.update(10, 4), undefined);
  const estimate = estimator.update(20, 8);
  assert.ok(estimate >= 30 && estimate <= 40);
  assert.equal(estimator.update(19, 9), estimate, "進捗が巻き戻った値を採用しない");
  estimator.reset();
  assert.equal(estimator.update(30, 12), undefined);
});

test("複数ファイルの完了件数、全体進捗、削減済み容量を集計する", () => {
  const overall = aggregate.calculateOverallProgress([
    { progress: 100, status: "completed", originalSize: 1_000, outputSize: 600 },
    { progress: 50, status: "processing", originalSize: 2_000 },
    { progress: 0, status: "pending", originalSize: 1_000 },
  ]);
  assert.deepEqual(overall, {
    completedFiles: 1,
    totalFiles: 3,
    progress: 50,
    originalBytes: 1_000,
    outputBytes: 600,
    savedBytes: 400,
  });
  assert.deepEqual(aggregate.calculateOverallProgress([]), {
    completedFiles: 0,
    totalFiles: 0,
    progress: 0,
    originalBytes: 0,
    outputBytes: 0,
    savedBytes: 0,
  });
});

test("削減率は増加も保持し、元サイズが0バイトなら計算しない", () => {
  assert.equal(aggregate.calculateReductionPercent(480_000_000, 156_000_000), 67.5);
  assert.equal(aggregate.calculateReductionPercent(100, 125), -25);
  assert.equal(aggregate.calculateReductionPercent(0, 0), null);
  assert.equal(aggregate.calculateReductionPercent(0, 10), null);
  assert.equal(aggregate.calculateReductionPercent(100, -1), null);
  assert.equal(aggregate.calculateReductionPercent(Number.NaN, 10), null);
});

test("エラーとキャンセルへの遷移を許可し、終端状態から処理中へ巻き戻さない", () => {
  assert.equal(aggregate.canTransitionProcessingStatus("processing", "failed"), true);
  assert.equal(aggregate.canTransitionProcessingStatus("encoding", "cancelled"), true);
  assert.equal(aggregate.canTransitionProcessingStatus("completed", "processing"), false);
  assert.equal(aggregate.canTransitionProcessingStatus("cancelled", "completed"), false);
  assert.equal(
    aggregate.canTransitionProcessingStatus("failed", "pending"),
    true,
    "再試行は待機状態から開始できる",
  );
});

test("利用者向けログから一時ファイルの内部パスを除去する", () => {
  assert.equal(
    progressUtils.sanitizeLogMessage("failed at /tmp/compression-files/job/source.bin"),
    "failed at [一時ファイル]",
  );
  assert.equal(
    progressUtils.sanitizeLogMessage(
      "failed at C:\\Users\\demo\\AppData\\Local\\Temp\\source.bin",
    ),
    "failed at [内部パス]",
  );
});

test("0バイトファイルは処理開始前に利用者向けエラーとして拒否する", () => {
  const validationSource = readFileSync(
    resolve(root, "lib/validation/media-validation.ts"),
    "utf8",
  );
  const imageRouteSource = readFileSync(
    resolve(root, "app/api/process/route.ts"),
    "utf8",
  );
  const inspectRouteSource = readFileSync(
    resolve(root, "app/api/media/inspect/route.ts"),
    "utf8",
  );

  for (const source of [validationSource, imageRouteSource, inspectRouteSource]) {
    assert.match(source, /file\.size === 0/);
    assert.match(source, /空のファイルは処理できません。/);
    assert.match(source, /EMPTY_FILE/);
  }
});

test("ジョブ状態を通知・再送し、終端状態を守り、保存データから復元する", async () => {
  const previousTempRoot = process.env.COMPRESSION_TMP_DIR;
  const tempRoot = join(tmpdir(), `compression-progress-test-${randomUUID()}`);
  process.env.COMPRESSION_TMP_DIR = tempRoot;
  await mkdir(tempRoot, { recursive: true });

  const registryPath = resolve(root, "lib/jobs/job-registry.ts");
  const configPath = resolve(root, "lib/config.ts");
  delete globalThis.compressionFileJobs;
  moduleCache.delete(registryPath);
  moduleCache.delete(configPath);
  let registry = loadTypeScriptModule(registryPath);

  try {
    const jobId = randomUUID();
    const jobDirectory = join(tempRoot, jobId);
    await mkdir(jobDirectory, { recursive: true });
    const signal = registry.registerProcessingJob(jobId, "video", jobDirectory, {
      fileId: "movie-file",
      originalSize: 480_000_000,
      totalDuration: 92,
      totalFrames: 5600,
    });
    assert.equal(signal.aborted, false);
    assert.equal(registry.getProcessingJob(jobId).latestEvent.sequence, 1);

    const notified = [];
    const unsubscribe = registry.subscribeProcessingJob(jobId, (event) => {
      notified.push(event);
    });
    assert.equal(typeof unsubscribe, "function");

    registry.updateProcessingJob(jobId, {
      status: "encoding",
      stage: "動画をエンコード",
      progress: 47,
      processedTime: 43.2,
      currentFrame: 2600,
    });
    registry.updateProcessingJob(jobId, {
      status: "finalizing",
      stage: "出力を検証",
      progress: 100,
    });
    assert.equal(notified.length, 2);
    assert.equal(notified[0].progress, 47);
    assert.equal(notified[1].progress, 99, "検証完了前は99%を上限にする");

    const replay = registry.getProcessingJobEvents(jobId, `${jobId}:1`);
    assert.deepEqual(
      replay.map((event) => event.sequence),
      [2, 3],
      "Last-Event-IDより新しいイベントだけを再送する",
    );
    assert.equal(unsubscribe(), true);

    const completed = registry.finishProcessingJob(jobId, "complete");
    assert.equal(completed.progress, 100);
    assert.equal(completed.status, "completed");
    assert.equal(registry.getProcessingJob(jobId).status, "complete");
    const completedSequence = completed.sequence;
    assert.equal(
      registry.updateProcessingJob(jobId, { status: "encoding", progress: 20 }).sequence,
      completedSequence,
      "完了後に遅れて届いた更新で状態を巻き戻さない",
    );

    const failedId = randomUUID();
    registry.registerProcessingJob(failedId, "image");
    const failed = registry.finishProcessingJob(failedId, "error");
    assert.equal(failed.status, "failed");
    assert.equal(registry.getProcessingJob(failedId).status, "error");

    const cancelledId = randomUUID();
    const cancelledSignal = registry.registerProcessingJob(cancelledId, "audio");
    assert.equal(registry.cancelProcessingJob(cancelledId), true);
    assert.equal(cancelledSignal.aborted, true);
    assert.equal(registry.getProcessingJob(cancelledId).status, "cancelled");
    const cancelledSequence = registry.getProcessingJob(cancelledId).latestEvent.sequence;
    assert.equal(
      registry.updateProcessingJob(cancelledId, { status: "encoding", progress: 80 })
        .sequence,
      cancelledSequence,
      "キャンセル後の遅延イベントを無視する",
    );

    const restoreId = randomUUID();
    const restoreDirectory = join(tempRoot, restoreId);
    await mkdir(restoreDirectory, { recursive: true });
    registry.registerProcessingJob(restoreId, "video", restoreDirectory, {
      originalSize: 10_000,
      totalDuration: 10,
    });
    registry.updateProcessingJob(restoreId, {
      status: "encoding",
      stage: "動画をエンコード",
      progress: 44.5,
    });

    const stateFile = join(restoreDirectory, "job-state.json");
    let persisted;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        persisted = JSON.parse(await readFile(stateFile, "utf8"));
        if (persisted.state?.latestEvent?.progress === 44.5) break;
      } catch {
        // Persistence is intentionally asynchronous; retry for a short period.
      }
      await wait(10);
    }
    assert.equal(persisted?.state?.latestEvent?.progress, 44.5);

    delete globalThis.compressionFileJobs;
    moduleCache.delete(registryPath);
    registry = loadTypeScriptModule(registryPath);
    assert.equal(registry.getProcessingJob(restoreId), null);
    const restored = await registry.getOrRestoreProcessingJob(restoreId);
    assert.equal(restored.progress, 44.5);
    assert.equal(restored.latestEvent.sequence, 2);
    assert.deepEqual(
      registry.getProcessingJobEvents(restoreId).map((event) => event.sequence),
      [1, 2],
    );
  } finally {
    delete globalThis.compressionFileJobs;
    moduleCache.delete(registryPath);
    moduleCache.delete(configPath);
    if (previousTempRoot === undefined) delete process.env.COMPRESSION_TMP_DIR;
    else process.env.COMPRESSION_TMP_DIR = previousTempRoot;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("SSEエンドポイントはLast-Event-ID、再送、heartbeat、切断後の解放に対応する", () => {
  const source = readFileSync(
    resolve(root, "app/api/jobs/[jobId]/events/route.ts"),
    "utf8",
  );
  assert.match(source, /headers\.get\("last-event-id"\)/);
  assert.match(source, /getOrRestoreProcessingJob/);
  assert.match(source, /getProcessingJobEvents\(jobId, lastEventId\)/);
  assert.match(source, /subscribeProcessingJob\(jobId, send\)/);
  assert.match(source, /event\.sequence <= lastSequence/);
  assert.match(source, /heartbeat/);
  assert.match(source, /unsubscribe\?\.\(\)/);
  assert.match(source, /text\/event-stream/);
  assert.match(source, /no-cache, no-transform/);
  assert.match(source, /X-Accel-Buffering/);
});
