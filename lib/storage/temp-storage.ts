import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { FILE_TTL_MS, TEMP_ROOT } from "@/lib/config";
import { AppError } from "@/lib/errors";
import {
  createCompressedFileName,
  normalizeOutputExtension,
  sanitizeDownloadFileName,
} from "@/shared/files/create-compressed-file-name";

import type { VideoMediaInfo } from "@/lib/media/video-types";
import type { MediaProbeInfo } from "@/lib/media/video-types";
import type { OptimizationReport } from "@/lib/optimization/types";
import type { TargetSizeResult } from "@/lib/target-size/types";

export interface JobManifest {
  jobId: string;
  /** Server-internal file name inside the isolated job directory. */
  outputName: string;
  /** Original name is display metadata only and is never joined to a server path. */
  originalName?: string;
  /** User-facing attachment name, kept separate from outputName. */
  downloadName?: string;
  outputMime: string;
  previewName?: string;
  previewMime?: string;
  originalPreviewName?: string;
  originalPreviewMime?: string;
  beforePreviewName?: string;
  afterPreviewName?: string;
  createdAt: string;
  expiresAt?: string;
  optimizationReport?: OptimizationReport;
  targetSizeResult?: TargetSizeResult;
}

export interface StagedVideoManifest {
  uploadId: string;
  inputName: string;
  originalName: string;
  inputMime: string;
  size: number;
  createdAt: string;
  mediaInfo: VideoMediaInfo;
}

export interface StagedMediaManifest {
  uploadId: string;
  inputName: string;
  originalName: string;
  inputMime: string;
  detectedFormat: string;
  size: number;
  createdAt: string;
  mediaInfo: MediaProbeInfo;
  beforePreviewName?: string;
}

function validJobId(jobId: string) {
  return /^[0-9a-f-]{36}$/i.test(jobId);
}

export async function cleanupExpiredJobs() {
  await mkdir(TEMP_ROOT, { recursive: true });
  const entries = await readdir(TEMP_ROOT, { withFileTypes: true });
  const now = Date.now();

  await Promise.allSettled(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = join(/*turbopackIgnore: true*/ TEMP_ROOT, entry.name);
        const details = await stat(directory);
        if (now - details.mtimeMs > FILE_TTL_MS) {
          await rm(directory, { recursive: true, force: true });
        }
      }),
  );
}

export async function createJob(requestedJobId?: string) {
  await mkdir(TEMP_ROOT, { recursive: true });
  if (requestedJobId !== undefined && !validJobId(requestedJobId)) {
    throw new AppError("処理ジョブIDが無効です。", 400, "INVALID_JOB_ID");
  }
  const jobId = requestedJobId ?? randomUUID();
  const directory = join(/*turbopackIgnore: true*/ TEMP_ROOT, jobId);
  await mkdir(directory, { recursive: false });
  return { jobId, directory };
}

export async function removeJob(directory: string) {
  await rm(directory, { recursive: true, force: true });
}

export async function cleanupFailedJobArtifacts(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  await Promise.allSettled(
    entries
      .filter((entry) => entry.name !== "job-state.json")
      .map((entry) =>
        rm(join(/*turbopackIgnore: true*/ directory, entry.name), {
          recursive: entry.isDirectory(),
          force: true,
        }),
      ),
  );
}

export async function removeJobById(jobId: string) {
  if (!validJobId(jobId)) {
    throw new AppError("アップロードIDが無効です。", 404, "NOT_FOUND");
  }
  await removeJob(join(/*turbopackIgnore: true*/ TEMP_ROOT, jobId));
}

export function scheduleJobCleanup(directory: string, ttlMs = FILE_TTL_MS) {
  const schedule = (delay: number) => {
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const details = await stat(directory);
          const remaining = ttlMs - (Date.now() - details.mtimeMs);
          if (remaining > 0) {
            schedule(remaining);
            return;
          }
          await removeJob(directory);
        } catch {
          // The job has already been removed.
        }
      })();
    }, delay);
    timer.unref();
  };
  schedule(ttlMs);
}

export function safeFileName(fileName: string) {
  const clean = basename(fileName)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return clean.slice(0, 140) || "upload";
}

export async function writeUpload(file: File, destination: string) {
  const source = Readable.fromWeb(file.stream() as never);
  await pipeline(source, createWriteStream(destination, { flags: "wx" }));
}

export async function writeManifest(directory: string, manifest: JobManifest) {
  const outputExtension = extname(manifest.outputName).slice(1);
  const downloadName = manifest.downloadName
    ? sanitizeDownloadFileName(manifest.downloadName)
    : manifest.originalName
      ? createCompressedFileName(manifest.originalName, outputExtension)
      : undefined;
  await writeFile(
    join(/*turbopackIgnore: true*/ directory, "manifest.json"),
    JSON.stringify({ ...manifest, downloadName }),
    "utf8",
  );
}

export async function prepareDownloadOutput(
  directory: string,
  currentOutputPath: string,
  originalName: string,
) {
  const resolvedDirectory = resolve(directory);
  const resolvedCurrentPath = resolve(currentOutputPath);
  if (dirname(resolvedCurrentPath) !== resolvedDirectory) {
    throw new AppError("出力ファイルの保存場所が無効です。", 500, "INVALID_OUTPUT_PATH");
  }

  const extension = normalizeOutputExtension(extname(resolvedCurrentPath).slice(1));
  // Generated names are server-controlled and already isolated by job ID. Keep the
  // existing file in place so Windows codecs do not have to release it for a rename.
  const internalName = basename(resolvedCurrentPath);
  const internalPath = resolvedCurrentPath;
  return {
    internalName,
    internalPath,
    downloadName: createCompressedFileName(originalName, extension),
  };
}

export async function writeProcessResult(directory: string, result: unknown) {
  await writeFile(
    join(/*turbopackIgnore: true*/ directory, "result.json"),
    JSON.stringify(result),
    "utf8",
  );
}

export async function getProcessResult(jobId: string): Promise<unknown> {
  if (!validJobId(jobId)) {
    throw new AppError("処理結果URLが無効です。", 404, "NOT_FOUND");
  }
  try {
    return JSON.parse(
      await readFile(
        join(/*turbopackIgnore: true*/ TEMP_ROOT, jobId, "result.json"),
        "utf8",
      ),
    ) as unknown;
  } catch {
    throw new AppError(
      "処理結果をまだ取得できないか、保存期限が切れています。",
      404,
      "RESULT_NOT_READY",
    );
  }
}

export async function writeStagedVideoManifest(
  directory: string,
  manifest: StagedVideoManifest,
) {
  await writeFile(
    join(/*turbopackIgnore: true*/ directory, "staged-video.json"),
    JSON.stringify(manifest),
    "utf8",
  );
}

export async function writeStagedMediaManifest(
  directory: string,
  manifest: StagedMediaManifest,
) {
  await writeFile(
    join(/*turbopackIgnore: true*/ directory, "staged-media.json"),
    JSON.stringify(manifest),
    "utf8",
  );
}

export async function getStagedVideo(uploadId: string) {
  if (!validJobId(uploadId)) {
    throw new AppError("動画アップロードIDが無効です。", 404, "NOT_FOUND");
  }

  const directory = join(/*turbopackIgnore: true*/ TEMP_ROOT, uploadId);
  let manifest: StagedVideoManifest;
  try {
    manifest = JSON.parse(
      await readFile(
        join(/*turbopackIgnore: true*/ directory, "staged-video.json"),
        "utf8",
      ),
    ) as StagedVideoManifest;
  } catch {
    throw new AppError(
      "アップロードした動画の保存期限が切れました。もう一度追加してください。",
      404,
      "UPLOAD_EXPIRED",
    );
  }

  if (
    manifest.uploadId !== uploadId ||
    basename(manifest.inputName) !== manifest.inputName
  ) {
    throw new AppError("動画アップロードIDが無効です。", 404, "NOT_FOUND");
  }

  const inputPath = join(/*turbopackIgnore: true*/ directory, manifest.inputName);
  try {
    await stat(inputPath);
  } catch {
    throw new AppError(
      "アップロードした動画の保存期限が切れました。もう一度追加してください。",
      404,
      "UPLOAD_EXPIRED",
    );
  }

  return { directory, inputPath, manifest };
}

export async function removeStagedVideoManifest(directory: string) {
  await unlink(join(/*turbopackIgnore: true*/ directory, "staged-video.json")).catch(
    () => undefined,
  );
}

export async function getStagedMedia(uploadId: string) {
  if (!validJobId(uploadId)) {
    throw new AppError("メディアアップロードIDが無効です。", 404, "NOT_FOUND");
  }
  const directory = join(/*turbopackIgnore: true*/ TEMP_ROOT, uploadId);
  let manifest: StagedMediaManifest;
  try {
    manifest = JSON.parse(
      await readFile(
        join(/*turbopackIgnore: true*/ directory, "staged-media.json"),
        "utf8",
      ),
    ) as StagedMediaManifest;
  } catch {
    throw new AppError(
      "アップロードしたメディアの保存期限が切れました。もう一度追加してください。",
      404,
      "UPLOAD_EXPIRED",
    );
  }
  if (
    manifest.uploadId !== uploadId ||
    basename(manifest.inputName) !== manifest.inputName
  ) {
    throw new AppError("メディアアップロードIDが無効です。", 404, "NOT_FOUND");
  }
  const inputPath = join(/*turbopackIgnore: true*/ directory, manifest.inputName);
  try {
    await stat(inputPath);
  } catch {
    throw new AppError(
      "アップロードしたメディアの保存期限が切れました。もう一度追加してください。",
      404,
      "UPLOAD_EXPIRED",
    );
  }
  return { directory, inputPath, manifest };
}

export async function removeStagedMediaManifest(directory: string) {
  await unlink(join(/*turbopackIgnore: true*/ directory, "staged-media.json")).catch(
    () => undefined,
  );
}

export async function getJobFile(
  jobId: string,
  preview: false | "image" | "original" | "before" | "after" = false,
) {
  if (!validJobId(jobId)) {
    throw new AppError("ダウンロードURLが無効です。", 404, "NOT_FOUND");
  }

  const directory = join(/*turbopackIgnore: true*/ TEMP_ROOT, jobId);
  let manifest: JobManifest;
  try {
    manifest = JSON.parse(
      await readFile(join(/*turbopackIgnore: true*/ directory, "manifest.json"), "utf8"),
    ) as JobManifest;
  } catch {
    throw new AppError(
      "ファイルの保存期限が切れたか、すでに削除されています。",
      404,
      "FILE_EXPIRED",
    );
  }

  if (
    manifest.jobId !== jobId ||
    basename(manifest.outputName) !== manifest.outputName ||
    (manifest.previewName && basename(manifest.previewName) !== manifest.previewName) ||
    (manifest.originalPreviewName &&
      basename(manifest.originalPreviewName) !== manifest.originalPreviewName) ||
    (manifest.beforePreviewName &&
      basename(manifest.beforePreviewName) !== manifest.beforePreviewName) ||
    (manifest.afterPreviewName &&
      basename(manifest.afterPreviewName) !== manifest.afterPreviewName)
  ) {
    throw new AppError("ダウンロードURLが無効です。", 404, "NOT_FOUND");
  }

  const fileName =
    preview === "image" && manifest.previewName
      ? manifest.previewName
      : preview === "original" && manifest.originalPreviewName
        ? manifest.originalPreviewName
        : preview === "before" && manifest.beforePreviewName
          ? manifest.beforePreviewName
          : preview === "after" && manifest.afterPreviewName
            ? manifest.afterPreviewName
            : manifest.outputName;
  const filePath = join(/*turbopackIgnore: true*/ directory, fileName);
  try {
    const details = await stat(filePath);
    return {
      manifest: {
        ...manifest,
        outputName: fileName,
        outputMime:
          preview === "image" && manifest.previewName
            ? (manifest.previewMime ?? "image/webp")
            : preview === "original" && manifest.originalPreviewName
              ? (manifest.originalPreviewMime ?? "image/webp")
              : (preview === "before" && manifest.beforePreviewName) ||
                  (preview === "after" && manifest.afterPreviewName)
                ? "video/mp4"
                : manifest.outputMime,
      },
      filePath,
      size: details.size,
      stream: createReadStream(filePath),
    };
  } catch {
    throw new AppError(
      "ファイルの保存期限が切れたか、すでに削除されています。",
      404,
      "FILE_EXPIRED",
    );
  }
}
