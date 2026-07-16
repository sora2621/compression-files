import { spawn } from "node:child_process";
import { open, readFile, stat, unlink } from "node:fs/promises";

import ffmpegPath from "ffmpeg-static";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";

import {
  MAX_ANIMATION_FRAMES,
  MAX_ANIMATION_TOTAL_PIXELS,
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_INPUT_PIXELS,
  MAX_MEDIA_DURATION_SECONDS,
  MAX_SVG_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_WIDTH,
} from "@/lib/config";
import { AppError } from "@/lib/errors";
import { probeMedia } from "@/lib/media/video";
import { logger } from "@/shared/logging/logger";

import type { MediaProbeInfo } from "@/lib/media/video-types";

export interface ImageInspectionInfo {
  format: string;
  width: number;
  height: number;
  pages: number;
  animated: boolean;
  hasAlpha: boolean;
  orientation: number | null;
  colorSpace: string | null;
}

export type ValidatedUpload =
  | {
      kind: "image";
      mime: string;
      detectedFormat: string;
      imageInfo: ImageInspectionInfo;
      mediaInfo: null;
      normalizedInputPath: string | null;
    }
  | {
      kind: "video" | "audio";
      mime: string;
      detectedFormat: string;
      imageInfo: null;
      mediaInfo: MediaProbeInfo;
      normalizedInputPath: null;
    };

const IMAGE_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  heif: "image/avif",
  gif: "image/gif",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

function executableMagic(header: Buffer) {
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) return true;
  if (
    header.length >= 4 &&
    header[0] === 0x7f &&
    header[1] === 0x45 &&
    header[2] === 0x4c &&
    header[3] === 0x46
  ) {
    return true;
  }
  const magic = header.subarray(0, 4).toString("hex");
  if (["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(magic)) {
    return true;
  }
  return header.length >= 2 && header[0] === 0x23 && header[1] === 0x21;
}

async function rejectExecutable(inputPath: string) {
  const handle = await open(inputPath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (executableMagic(header.subarray(0, bytesRead))) {
      throw new AppError(
        "実行ファイルはアップロードできません。",
        415,
        "EXECUTABLE_REJECTED",
      );
    }
  } finally {
    await handle.close();
  }
}

async function validateSvg(inputPath: string, size: number) {
  if (size > MAX_SVG_BYTES) {
    throw new AppError("SVGの上限（2MB）を超えています。", 413, "SVG_TOO_LARGE");
  }
  const source = await readFile(inputPath, "utf8");
  if (
    /<!DOCTYPE|<!ENTITY|<script\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|ftp:|file:)/i.test(
      source,
    )
  ) {
    throw new AppError(
      "外部参照、スクリプト、またはイベント処理を含むSVGは安全のため処理できません。",
      415,
      "UNSAFE_SVG",
    );
  }
}

async function inspectWithSharp(inputPath: string, size: number) {
  try {
    const metadata = await sharp(inputPath, {
      animated: true,
      failOn: "error",
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
      sequentialRead: true,
      unlimited: false,
    }).metadata();
    if (!metadata.format || !metadata.width || !metadata.height) return null;
    const pages = metadata.pages ?? 1;
    const frameHeight = metadata.pageHeight ?? metadata.height;
    const framePixels = metadata.width * frameHeight;
    const totalPixels = framePixels * pages;
    if (
      metadata.width > MAX_IMAGE_DIMENSION ||
      frameHeight > MAX_IMAGE_DIMENSION ||
      framePixels > MAX_IMAGE_INPUT_PIXELS
    ) {
      throw new AppError(
        "画像の解像度または総画素数が安全上限を超えています。",
        413,
        "IMAGE_DIMENSIONS_TOO_LARGE",
      );
    }
    if (pages > MAX_ANIMATION_FRAMES || totalPixels > MAX_ANIMATION_TOTAL_PIXELS) {
      throw new AppError(
        "アニメーションのフレーム数または総画素数が上限を超えています。",
        413,
        "ANIMATION_TOO_LARGE",
      );
    }
    if (metadata.format === "svg") await validateSvg(inputPath, size);
    return {
      format: metadata.format,
      width: metadata.width,
      height: frameHeight,
      pages,
      animated: pages > 1,
      hasAlpha: metadata.hasAlpha ?? false,
      orientation: metadata.orientation ?? null,
      colorSpace: metadata.space ?? null,
    } satisfies ImageInspectionInfo;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
}

function canonicalMediaMime(media: MediaProbeInfo, signatureMime?: string) {
  if (signatureMime?.startsWith(`${media.kind}/`)) return signatureMime;
  const names = new Set(media.formatName.toLowerCase().split(","));
  if (media.kind === "video") {
    if (names.has("webm")) return "video/webm";
    if (names.has("matroska")) return "video/x-matroska";
    if (names.has("mov") || names.has("mp4")) return "video/mp4";
    if (names.has("avi")) return "video/x-msvideo";
    if (names.has("mpegts")) return "video/mp2t";
    if (names.has("mpeg")) return "video/mpeg";
    return "video/octet-stream";
  }
  if (names.has("mp3")) return "audio/mpeg";
  if (names.has("aac")) return "audio/aac";
  if (names.has("wav")) return "audio/wav";
  if (names.has("flac")) return "audio/flac";
  if (names.has("ogg") || names.has("opus")) return "audio/ogg";
  if (names.has("mov") || names.has("mp4")) return "audio/mp4";
  return "audio/octet-stream";
}

async function assertFfmpegDecodable(inputPath: string) {
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable) {
    throw new AppError(
      "FFmpegが見つからないため、このメディアを確認できません。",
      503,
      "FFMPEG_NOT_FOUND",
    );
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe,crypto,data",
        "-i",
        inputPath,
        "-t",
        "0.2",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "pipe"] },
    );
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new AppError("デコード確認がタイムアウトしました。", 408, "DECODE_TIMEOUT"));
    }, 20_000);
    child.stderr.resume();
    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) finish();
      else {
        logger.error({
          stage: "decode-validation",
          errorCode: "DECODER_UNAVAILABLE",
        });
        finish(
          new AppError(
            "このファイルのコーデックを現在のFFmpegでデコードできません。",
            415,
            "DECODER_UNAVAILABLE",
          ),
        );
      }
    });
  });
}

async function decodeFfmpegImage(inputPath: string) {
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  if (!executable) return null;
  const outputPath = `${inputPath}.decoded.png`;
  const decoded = await new Promise<boolean>((resolve) => {
    const child = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-max_alloc",
        "268435456",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=w='min(iw,16384)':h='min(ih,16384)':force_original_aspect_ratio=decrease",
        outputPath,
      ],
      { windowsHide: true, shell: false, stdio: ["ignore", "ignore", "ignore"] },
    );
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(success);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(false);
    }, 30_000);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
  if (!decoded) {
    await unlink(outputPath).catch(() => undefined);
    return null;
  }
  const details = await stat(outputPath);
  const imageInfo = await inspectWithSharp(outputPath, details.size);
  if (!imageInfo) {
    await unlink(outputPath).catch(() => undefined);
    return null;
  }
  return { outputPath, imageInfo };
}

export async function validateUploadedFile(
  file: File,
  inputPath: string,
): Promise<ValidatedUpload> {
  if (file.size === 0) {
    throw new AppError("空のファイルは処理できません。", 400, "EMPTY_FILE");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new AppError("ファイル上限（250MB）を超えています。", 413, "FILE_TOO_LARGE");
  }

  await rejectExecutable(inputPath);
  const [signature, details] = await Promise.all([
    fileTypeFromFile(inputPath),
    stat(inputPath),
  ]);
  const imageInfo = await inspectWithSharp(inputPath, details.size);
  if (imageInfo) {
    if (details.size > MAX_IMAGE_BYTES) {
      throw new AppError("画像の上限（25MB）を超えています。", 413, "FILE_TOO_LARGE");
    }
    if (signature && !signature.mime.startsWith("image/")) {
      throw new AppError(
        "ファイルのシグネチャと画像データが一致しません。",
        415,
        "TYPE_MISMATCH",
      );
    }
    return {
      kind: "image",
      mime:
        signature?.mime.startsWith("image/") === true
          ? signature.mime
          : (IMAGE_MIME[imageInfo.format] ?? "image/octet-stream"),
      detectedFormat: imageInfo.format,
      imageInfo,
      mediaInfo: null,
      normalizedInputPath: null,
    };
  }

  let media: MediaProbeInfo;
  try {
    media = await probeMedia(inputPath);
  } catch (error) {
    if (error instanceof AppError) {
      const ffmpegImage =
        !signature || signature.mime.startsWith("image/")
          ? await decodeFfmpegImage(inputPath)
          : null;
      if (ffmpegImage) {
        if (details.size > MAX_IMAGE_BYTES) {
          await unlink(ffmpegImage.outputPath).catch(() => undefined);
          throw new AppError("画像の上限（25MB）を超えています。", 413, "FILE_TOO_LARGE");
        }
        return {
          kind: "image",
          mime:
            signature?.mime.startsWith("image/") === true
              ? signature.mime
              : "image/octet-stream",
          detectedFormat: signature?.ext ?? "ffmpeg-image",
          imageInfo: ffmpegImage.imageInfo,
          mediaInfo: null,
          normalizedInputPath: ffmpegImage.outputPath,
        };
      }
      throw new AppError(
        "SharpとFFmpegのどちらでも読み込めない形式です。実行環境の対応形式をご確認ください。",
        415,
        "UNSUPPORTED_TYPE",
      );
    }
    throw error;
  }
  await assertFfmpegDecodable(inputPath);
  if (media.duration > MAX_MEDIA_DURATION_SECONDS) {
    throw new AppError(
      "再生時間の上限（30分）を超えています。",
      413,
      "MEDIA_DURATION_TOO_LONG",
    );
  }
  if (media.kind === "audio" && details.size > MAX_AUDIO_BYTES) {
    throw new AppError("音声の上限（100MB）を超えています。", 413, "FILE_TOO_LARGE");
  }
  if (
    media.video &&
    (media.video.width > MAX_VIDEO_WIDTH || media.video.height > MAX_VIDEO_HEIGHT)
  ) {
    throw new AppError(
      "動画解像度の上限（7680×4320）を超えています。",
      413,
      "VIDEO_DIMENSIONS_TOO_LARGE",
    );
  }

  return {
    kind: media.kind,
    mime: canonicalMediaMime(media, signature?.mime),
    detectedFormat: media.formatName,
    imageInfo: null,
    mediaInfo: media,
    normalizedInputPath: null,
  };
}
