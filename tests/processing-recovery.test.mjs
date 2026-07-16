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
const read = (path) => readFileSync(resolve(root, path), "utf8");

function loadTypeScriptModule(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
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
    return loadTypeScriptModule(extname(base) ? base : `${base}.ts`);
  };
  new Function("require", "module", "exports", outputText)(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

function exportedNames(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = [];
  const isExported = (statement) =>
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          names.push(element.name.text);
        }
      }
      continue;
    }
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if ("name" in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.push(statement.name.text);
    }
  }
  return names;
}

const mediaClient = loadTypeScriptModule("features/upload/media-client.ts");
const workspaceProgress = loadTypeScriptModule("features/workspace/progress.ts");

test("開始ボタンから画像・動画の処理関数までawait付きで接続されている", () => {
  const source = read("components/compression-app.tsx");
  assert.match(source, /onClick=\{\(\) => void processAll\(\)\}/);
  assert.match(source, /result = await processMediaItem\(item, targets\.length === 1\)/);
  assert.match(source, /result = await processImage\(\{/);
  assert.match(source, /return processInspectedMedia\(\{/);
});

test("動画クライアントは202受付後に状態とjobId付き完了結果を取得する", async () => {
  const progressEvent = {
    eventId: "job-1:1",
    sequence: 1,
    timestamp: new Date(0).toISOString(),
    jobId: "job-1",
    fileId: "job-1",
    kind: "video",
    status: "processing",
    stage: "FFmpegで処理中",
    stageIndex: 1,
    totalStages: 2,
    steps: [],
    progress: 50,
    elapsedSeconds: 1,
    originalSize: 100,
    message: "FFmpegで処理中",
  };
  const result = {
    jobId: "job-1",
    kind: "video",
    originalName: "input.mp4",
    outputName: "output.mp4",
    originalSize: 100,
    outputSize: 80,
    downloadUrl: "/api/files/job-1",
  };
  const requests = [];
  const ready = [];
  const progress = [];
  const apiFetch = async (url, init) => {
    requests.push({ url, init });
    if (url === "/api/media/process") {
      return Response.json(
        {
          jobId: "job-1",
          status: "queued",
          statusUrl: "/api/jobs/job-1",
          eventsUrl: "/api/jobs/job-1/events",
          resultUrl: "/api/results/job-1?full=1",
        },
        { status: 202 },
      );
    }
    if (url === "/api/jobs/job-1") {
      return Response.json({
        status: "complete",
        latestEvent: { ...progressEvent, status: "completed", progress: 100 },
      });
    }
    return Response.json(result);
  };

  const completed = await mediaClient.processInspectedMedia(
    {
      uploadId: "job-1",
      kind: "video",
      options: { mode: "copy" },
      streamSelection: { removeChapters: true },
      qualitySearch: { preset: "medium" },
      targetSizeOptions: { enabled: false },
      retentionMinutes: 30,
      onReady: () => ready.push(true),
      onProgressEvent: (event) => progress.push(event),
    },
    apiFetch,
  );

  assert.equal(requests[0].url, "/api/media/process");
  assert.equal(requests[0].init.method, "POST");
  const requestBody = JSON.parse(requests[0].init.body);
  assert.equal(requestBody.uploadId, "job-1");
  assert.deepEqual(requestBody.options, { mode: "copy" });
  assert.equal(ready.length, 1);
  assert.equal(progress[0].status, "completed");
  assert.equal(completed.jobId, "job-1");
  assert.equal(completed.downloadUrl, "/api/files/job-1");
});

test("処理エラーは握りつぶさずコード付きで呼び出し元へ返す", async () => {
  let requestCount = 0;
  await assert.rejects(
    () =>
      mediaClient.processInspectedMedia(
        {
          uploadId: "job-2",
          kind: "video",
          options: {},
          streamSelection: {},
          qualitySearch: {},
          targetSizeOptions: {},
          retentionMinutes: 30,
        },
        async () => {
          requestCount += 1;
          return requestCount === 1
            ? Response.json(
                {
                  jobId: "job-2",
                  status: "queued",
                  statusUrl: "/api/jobs/job-2",
                  eventsUrl: "/api/jobs/job-2/events",
                  resultUrl: "/api/results/job-2?full=1",
                },
                { status: 202 },
              )
            : Response.json({
                status: "error",
                latestEvent: {
                  status: "failed",
                  message: "動画処理に失敗しました。",
                },
              });
        },
      ),
    (error) =>
      error instanceof mediaClient.MediaProcessingError &&
      error.code === "PROCESSING_FAILED",
  );
});

test("completed進捗はフロントエンドの完了状態へ遷移する", () => {
  const item = {
    id: "item-1",
    file: { name: "input.mp4", size: 100 },
    kind: "video",
    status: "processing",
    logs: [],
  };
  const event = {
    eventId: "job-1:2",
    sequence: 2,
    timestamp: new Date(0).toISOString(),
    jobId: "job-1",
    fileId: "item-1",
    kind: "video",
    status: "completed",
    stage: "完了",
    stageIndex: 1,
    totalStages: 2,
    steps: [],
    progress: 100,
    elapsedSeconds: 2,
    originalSize: 100,
    message: "処理が完了しました。",
  };
  const updated = workspaceProgress.applyProgressToItem(item, event, 1234);
  assert.equal(updated.status, "complete");
  assert.equal(updated.progress, 100);
  assert.equal(updated.finishedAt, 1234);
});

test("互換モジュールは同じ名前を重複exportせず実装を1箇所だけ公開する", () => {
  const compatibilitySource = read("lib/target-size/video-target.ts");
  const names = exportedNames(compatibilitySource, "video-target.ts");
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicates, []);
  assert.doesNotMatch(
    compatibilitySource,
    /export (?:async )?function buildTwoPassArgs|export const defaultTargetCommandRunner/,
  );
  assert.match(
    read("infrastructure/ffmpeg/target-size-arguments.ts"),
    /export function buildTwoPassArgs/,
  );
  assert.match(
    read("infrastructure/ffmpeg/target-command-runner.ts"),
    /export const defaultTargetCommandRunner/,
  );
});

test("進捗段階は分離先から参照され、旧コンポーネント内の未定義参照を残さない", () => {
  const workspaceSource = read("components/compression-app.tsx");
  const progressSource = read("features/workspace/progress.ts");
  assert.doesNotMatch(workspaceSource, /function stagesForItem/);
  assert.match(progressSource, /VIDEO_PROCESSING_STAGES/);
  assert.ok(workspaceProgress.stagesForItem({ kind: "video" }).length > 0);
});

test("進捗接続からメディア処理を分離し、切断時もジョブを継続する", () => {
  const mediaRoute = read("app/api/media/process/route.ts");
  assert.match(mediaRoute, /after\(runJob\)/);
  assert.match(mediaRoute, /status:\s*202/);
  assert.doesNotMatch(mediaRoute, /new ReadableStream/);

  const legacyVideoRoute = read("app/api/video/process/route.ts");
  assert.match(legacyVideoRoute, /try \{\s*controller\.enqueue/s);
  assert.match(legacyVideoRoute, /PROGRESS_STREAM_DISCONNECTED/);
  assert.doesNotMatch(legacyVideoRoute, /catch \{[^}]*cancelProcessingJob/s);
});
