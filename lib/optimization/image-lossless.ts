import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, parse } from "node:path";

import sharp from "sharp";

import { AppError } from "@/lib/errors";

import {
  getImageOptimizationToolCapabilities,
  type ImageOptimizationToolCapabilities,
} from "./tool-capabilities";
import {
  DEFAULT_LOSSLESS_IMAGE_OPTIONS,
  type AdvancedOptimizationMode,
  type LosslessImageOptions,
  type OptimizationCandidateReport,
  type OptimizationReport,
} from "./types";

export interface LosslessImageOptimizationInput {
  inputPath: string;
  directory: string;
  originalName?: string;
  mode?: AdvancedOptimizationMode;
  options?: LosslessImageOptions;
  signal?: AbortSignal;
}

export interface LosslessImageOptimizationResult {
  selectedOutputPath: string;
  selectedOutputName: string;
  report: OptimizationReport;
  capabilities: ImageOptimizationToolCapabilities;
}

interface CandidateArtifact {
  report: OptimizationCandidateReport;
  path?: string;
  eligible: boolean;
}

interface PngChunk {
  type: string;
  data: Buffer;
  raw: Buffer;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_PRIVACY_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "tIME", "eXIf"]);
const PNG_SAFE_DISPLAY_CHUNKS = new Set(["iCCP", "gAMA", "cHRM", "sRGB", "pHYs", "sBIT"]);
const MAX_COMMAND_OUTPUT = 64 * 1024;

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new AppError("画像最適化をキャンセルしました。", 499, "CANCELLED");
  }
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileHash(path: string) {
  return sha256(await readFile(/*turbopackIgnore: true*/ path));
}

function parsePng(buffer: Buffer): PngChunk[] {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new Error("Invalid PNG signature");
  }
  const chunks: PngChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > 256 * 1024 * 1024 || end > buffer.length) {
      throw new Error("Invalid PNG chunk length");
    }
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({
      type,
      data: buffer.subarray(offset + 8, offset + 8 + length),
      raw: buffer.subarray(offset, end),
    });
    offset = end;
    if (type === "IEND") break;
  }
  if (chunks.at(-1)?.type !== "IEND") throw new Error("PNG is truncated");
  return chunks;
}

function stripPngPrivacyMetadata(buffer: Buffer) {
  const chunks = parsePng(buffer);
  return Buffer.concat([
    PNG_SIGNATURE,
    ...chunks
      .filter((chunk) => !PNG_PRIVACY_CHUNKS.has(chunk.type))
      .map((chunk) => chunk.raw),
  ]);
}

function pngChunkFingerprint(buffer: Buffer, selected: ReadonlySet<string>) {
  return parsePng(buffer)
    .filter((chunk) => selected.has(chunk.type))
    .map((chunk) => `${chunk.type}:${sha256(chunk.data)}`)
    .sort()
    .join("|");
}

function injectMissingSafePngChunks(output: Buffer, source: Buffer) {
  const outputChunks = parsePng(output);
  const outputTypes = new Set(outputChunks.map((chunk) => chunk.type));
  const additions = parsePng(source)
    .filter(
      (chunk) => PNG_SAFE_DISPLAY_CHUNKS.has(chunk.type) && !outputTypes.has(chunk.type),
    )
    .map((chunk) => chunk.raw);
  if (!additions.length) return output;
  const ihdr = outputChunks[0];
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdr.raw,
    ...additions,
    ...outputChunks.slice(1).map((chunk) => chunk.raw),
  ]);
}

function sanitizeJpegMetadata(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Invalid JPEG stream");
  }
  const chunks: Buffer[] = [buffer.subarray(0, 2)];
  let offset = 2;
  let removed = false;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }
    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw new Error("Truncated JPEG marker");
    const marker = buffer[offset];
    if (marker === 0xda) {
      chunks.push(buffer.subarray(markerStart));
      break;
    }
    const standalone =
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7);
    if (standalone) {
      chunks.push(buffer.subarray(markerStart, offset + 1));
      offset += 1;
      continue;
    }
    if (offset + 2 >= buffer.length) throw new Error("Truncated JPEG segment");
    const length = buffer.readUInt16BE(offset + 1);
    const end = offset + 1 + length;
    if (length < 2 || end > buffer.length) throw new Error("Invalid JPEG segment");
    const application = marker >= 0xe0 && marker <= 0xef;
    const safeApplication = marker === 0xe0 || marker === 0xe2 || marker === 0xee;
    const privacy = marker === 0xfe || (application && !safeApplication);
    if (privacy) removed = true;
    else chunks.push(buffer.subarray(markerStart, end));
    offset = end;
  }
  return { buffer: Buffer.concat(chunks), removed };
}

function jpegTransformForOrientation(orientation: number | undefined) {
  switch (orientation) {
    case 2:
      return ["-flip", "horizontal"];
    case 3:
      return ["-rotate", "180"];
    case 4:
      return ["-flip", "vertical"];
    case 5:
      return ["-transpose"];
    case 6:
      return ["-rotate", "90"];
    case 7:
      return ["-transverse"];
    case 8:
      return ["-rotate", "270"];
    default:
      return [];
  }
}

async function rgbaFingerprint(path: string) {
  const source = await readFile(/*turbopackIgnore: true*/ path);
  const metadata = await sharp(source, {
    animated: true,
    failOn: "error",
    sequentialRead: true,
  }).metadata();
  const { data, info } = await sharp(source, {
    animated: true,
    failOn: "error",
    sequentialRead: true,
  })
    .autoOrient()
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const descriptor = JSON.stringify({
    width: info.width,
    height: info.height,
    channels: info.channels,
    pages: metadata.pages ?? 1,
    pageHeight: metadata.pageHeight ?? null,
    delay: metadata.delay ?? [],
  });
  return sha256(Buffer.concat([Buffer.from(descriptor), data]));
}

function optionalBufferHash(value: Buffer | undefined) {
  return value ? sha256(value) : null;
}

async function verifyMetadata(
  inputPath: string,
  outputPath: string,
  options: {
    stripPrivacyMetadata: boolean;
    inputFormat: "png" | "jpeg";
    outputFormat: string;
  },
) {
  const [inputBuffer, outputBuffer] = await Promise.all([
    readFile(/*turbopackIgnore: true*/ inputPath),
    readFile(/*turbopackIgnore: true*/ outputPath),
  ]);
  const [before, after] = await Promise.all([
    sharp(inputBuffer).metadata(),
    sharp(outputBuffer).metadata(),
  ]);
  if (before.icc && optionalBufferHash(before.icc) !== optionalBufferHash(after.icc)) {
    return {
      passed: false,
      reason: "表示に必要なICCプロファイルを保持できませんでした。",
    };
  }
  if (
    options.outputFormat === options.inputFormat &&
    before.density !== undefined &&
    after.density !== before.density
  ) {
    return { passed: false, reason: "画像の表示密度情報を保持できませんでした。" };
  }

  const privacyBefore = [before.exif, before.xmp, before.iptc].map(optionalBufferHash);
  const privacyAfter = [after.exif, after.xmp, after.iptc].map(optionalBufferHash);
  if (options.stripPrivacyMetadata) {
    if (privacyAfter.some(Boolean)) {
      return { passed: false, reason: "削除対象の画像メタデータが残っています。" };
    }
  } else if (privacyBefore.some((value, index) => value !== privacyAfter[index])) {
    return { passed: false, reason: "保持対象の画像メタデータが変化しました。" };
  }

  if (options.inputFormat === "png" && options.outputFormat === "png") {
    if (
      pngChunkFingerprint(inputBuffer, PNG_SAFE_DISPLAY_CHUNKS) !==
      pngChunkFingerprint(outputBuffer, PNG_SAFE_DISPLAY_CHUNKS)
    ) {
      return {
        passed: false,
        reason: "PNGの安全な表示メタデータを保持できませんでした。",
      };
    }
    const outputPrivacy = pngChunkFingerprint(outputBuffer, PNG_PRIVACY_CHUNKS);
    if (options.stripPrivacyMetadata && outputPrivacy) {
      return { passed: false, reason: "PNGのプライバシーメタデータが残っています。" };
    }
    if (
      !options.stripPrivacyMetadata &&
      pngChunkFingerprint(inputBuffer, PNG_PRIVACY_CHUNKS) !== outputPrivacy
    ) {
      return { passed: false, reason: "PNGの保持対象メタデータが変化しました。" };
    }
  }
  return { passed: true, reason: "表示用メタデータを安全に保持しました。" };
}

async function runTool(options: {
  executable: string;
  arguments: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  assertNotCancelled(options.signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.executable, [...options.arguments], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(new AppError("画像最適化をキャンセルしました。", 499, "CANCELLED"));
    };
    const timeout = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish(new Error("tool-timeout"));
      },
      options.timeoutMs ?? 10 * 60 * 1000,
    );
    timeout.unref();
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-MAX_COMMAND_OUTPUT);
    });
    child.once("error", () => finish(new Error("tool-start-failed")));
    child.once("close", (code) => {
      finish(code === 0 ? undefined : new Error(`tool-exit-${code ?? "unknown"}`));
    });
  });
}

async function evaluatePixelCandidate(options: {
  id: string;
  label: string;
  method: string;
  format: string;
  inputPath: string;
  outputPath: string;
  sourceRgbaHash: string;
  inputFormat: "png" | "jpeg";
  stripPrivacyMetadata: boolean;
}): Promise<CandidateArtifact> {
  try {
    const outputDetails = await stat(options.outputPath);
    const outputRgbaHash = await rgbaFingerprint(options.outputPath);
    if (outputRgbaHash !== options.sourceRgbaHash) {
      return {
        path: options.outputPath,
        eligible: false,
        report: {
          id: options.id,
          label: options.label,
          method: options.method,
          format: options.format,
          size: outputDetails.size,
          status: "rejected",
          losslessVerified: false,
          verificationMethod: "Sharp sRGB RGBA SHA-256",
          reason: "デコード後のRGBAハッシュが元画像と一致しませんでした。",
        },
      };
    }
    const metadata = await verifyMetadata(options.inputPath, options.outputPath, {
      stripPrivacyMetadata: options.stripPrivacyMetadata,
      inputFormat: options.inputFormat,
      outputFormat: options.format,
    });
    if (!metadata.passed) {
      return {
        path: options.outputPath,
        eligible: false,
        report: {
          id: options.id,
          label: options.label,
          method: options.method,
          format: options.format,
          size: outputDetails.size,
          status: "rejected",
          losslessVerified: false,
          verificationMethod: "RGBA SHA-256 + safe metadata",
          reason: metadata.reason,
        },
      };
    }
    return {
      path: options.outputPath,
      eligible: true,
      report: {
        id: options.id,
        label: options.label,
        method: options.method,
        format: options.format,
        size: outputDetails.size,
        status: "qualified",
        losslessVerified: true,
        verificationMethod: "Sharp sRGB RGBA SHA-256",
        reason: `RGBAハッシュが一致しました。${metadata.reason}`,
      },
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "CANCELLED") throw error;
    return {
      path: options.outputPath,
      eligible: false,
      report: {
        id: options.id,
        label: options.label,
        method: options.method,
        format: options.format,
        size: null,
        status: "rejected",
        losslessVerified: false,
        verificationMethod: "Sharp sRGB RGBA SHA-256",
        reason: "候補ファイルを安全に検証できませんでした。",
      },
    };
  }
}

function unavailableCandidate(
  id: string,
  label: string,
  method: string,
  format: string,
  reason: string,
): CandidateArtifact {
  return {
    eligible: false,
    report: {
      id,
      label,
      method,
      format,
      size: null,
      status: "unavailable",
      reason,
    },
  };
}

async function preparePngInput(
  inputPath: string,
  preparedPath: string,
  stripPrivacyMetadata: boolean,
) {
  if (!stripPrivacyMetadata) return inputPath;
  const source = await readFile(inputPath);
  const metadata = await sharp(source).metadata();
  if ((metadata.orientation ?? 1) === 1) {
    await writeFile(preparedPath, stripPngPrivacyMetadata(source));
  } else {
    const rendered = await sharp(source)
      .autoOrient()
      .keepIccProfile()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    await writeFile(preparedPath, injectMissingSafePngChunks(rendered, source));
  }
  return preparedPath;
}

async function buildPngCandidates(options: {
  input: LosslessImageOptimizationInput;
  settings: LosslessImageOptions;
  capabilities: ImageOptimizationToolCapabilities;
  sourceRgbaHash: string;
  temporaryPaths: Set<string>;
}) {
  const { input, settings, capabilities, sourceRgbaHash, temporaryPaths } = options;
  const preparedPath = join(
    /*turbopackIgnore: true*/ input.directory,
    "advanced-png-source.png",
  );
  temporaryPaths.add(preparedPath);
  const toolInput = await preparePngInput(
    input.inputPath,
    preparedPath,
    settings.stripPrivacyMetadata,
  );
  const candidates: CandidateArtifact[] = [];
  const runPngToolCandidate = async (configuration: {
    id: string;
    label: string;
    method: string;
    outputName: string;
    executable: string;
    arguments: (outputPath: string) => string[];
  }) => {
    const outputPath = join(
      /*turbopackIgnore: true*/ input.directory,
      configuration.outputName,
    );
    temporaryPaths.add(outputPath);
    try {
      await runTool({
        executable: configuration.executable,
        arguments: configuration.arguments(outputPath),
        signal: input.signal,
      });
      candidates.push(
        await evaluatePixelCandidate({
          id: configuration.id,
          label: configuration.label,
          method: configuration.method,
          format: "png",
          inputPath: input.inputPath,
          outputPath,
          sourceRgbaHash,
          inputFormat: "png",
          stripPrivacyMetadata: settings.stripPrivacyMetadata,
        }),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "CANCELLED") throw error;
      candidates.push({
        path: outputPath,
        eligible: false,
        report: {
          id: configuration.id,
          label: configuration.label,
          method: configuration.method,
          format: "png",
          size: null,
          status: "rejected",
          reason: "外部最適化ツールが候補を生成できませんでした。",
        },
      });
    }
  };

  if (capabilities.oxipng.available) {
    for (const level of ["4", "6"] as const) {
      await runPngToolCandidate({
        id: `oxipng-o${level}`,
        label: `OxiPNG 最適化レベル${level}`,
        method: "oxipng",
        outputName: `advanced-oxipng-o${level}.png`,
        executable: capabilities.oxipng.executable,
        arguments: (outputPath) => [
          "-o",
          level,
          ...(settings.stripPrivacyMetadata ? ["--strip", "safe"] : []),
          "--out",
          outputPath,
          toolInput,
        ],
      });
    }
  } else {
    candidates.push(
      unavailableCandidate(
        "oxipng",
        "OxiPNG",
        "oxipng",
        "png",
        capabilities.oxipng.reason ?? "OxiPNGを利用できません。",
      ),
    );
  }

  if (capabilities.zopflipng.available) {
    await runPngToolCandidate({
      id: "zopflipng-max",
      label: "ZopfliPNG 最大圧縮",
      method: "zopflipng",
      outputName: "advanced-zopflipng.png",
      executable: capabilities.zopflipng.executable,
      arguments: (outputPath) => [
        "-m",
        "--iterations=15",
        "--filters=01234mepb",
        ...(settings.stripPrivacyMetadata
          ? ["--keepchunks=iCCP,gAMA,cHRM,sRGB,pHYs,sBIT"]
          : []),
        toolInput,
        outputPath,
      ],
    });
  } else {
    candidates.push(
      unavailableCandidate(
        "zopflipng",
        "ZopfliPNG",
        "zopflipng",
        "png",
        capabilities.zopflipng.reason ?? "ZopfliPNGを利用できません。",
      ),
    );
  }

  const sharpPngPath = join(
    /*turbopackIgnore: true*/ input.directory,
    "advanced-sharp-lossless.png",
  );
  temporaryPaths.add(sharpPngPath);
  try {
    let pipeline = sharp(await readFile(toolInput)).autoOrient();
    pipeline = pipeline.keepMetadata();
    const rendered = await pipeline
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer();
    const source = await readFile(input.inputPath);
    await writeFile(sharpPngPath, injectMissingSafePngChunks(rendered, source));
    candidates.push(
      await evaluatePixelCandidate({
        id: "sharp-png-lossless",
        label: "Sharp PNG 可逆圧縮",
        method: "sharp-png",
        format: "png",
        inputPath: input.inputPath,
        outputPath: sharpPngPath,
        sourceRgbaHash,
        inputFormat: "png",
        stripPrivacyMetadata: settings.stripPrivacyMetadata,
      }),
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "CANCELLED") throw error;
    candidates.push({
      path: sharpPngPath,
      eligible: false,
      report: {
        id: "sharp-png-lossless",
        label: "Sharp PNG 可逆圧縮",
        method: "sharp-png",
        format: "png",
        size: null,
        status: "rejected",
        reason: "SharpでPNG候補を生成できませんでした。",
      },
    });
  }

  if (settings.compareWebpLossless) {
    const webpPath = join(
      /*turbopackIgnore: true*/ input.directory,
      "advanced-webp-lossless.webp",
    );
    temporaryPaths.add(webpPath);
    try {
      const source = await readFile(input.inputPath);
      const metadata = await sharp(source, { animated: true }).metadata();
      if ((metadata.pages ?? 1) > 1) {
        candidates.push({
          path: webpPath,
          eligible: false,
          report: {
            id: "sharp-webp-lossless",
            label: "WebP lossless",
            method: "sharp-webp",
            format: "webp",
            size: null,
            status: "rejected",
            reason: "アニメーション保持を保証できないため比較対象から除外しました。",
          },
        });
      } else {
        let pipeline = sharp(source).autoOrient();
        pipeline = settings.stripPrivacyMetadata
          ? pipeline.keepIccProfile()
          : pipeline.keepMetadata();
        await pipeline.webp({ lossless: true, effort: 6 }).toFile(webpPath);
        candidates.push(
          await evaluatePixelCandidate({
            id: "sharp-webp-lossless",
            label: "WebP lossless",
            method: "sharp-webp",
            format: "webp",
            inputPath: input.inputPath,
            outputPath: webpPath,
            sourceRgbaHash,
            inputFormat: "png",
            stripPrivacyMetadata: settings.stripPrivacyMetadata,
          }),
        );
      }
    } catch (error) {
      if (error instanceof AppError && error.code === "CANCELLED") throw error;
      candidates.push({
        path: webpPath,
        eligible: false,
        report: {
          id: "sharp-webp-lossless",
          label: "WebP lossless",
          method: "sharp-webp",
          format: "webp",
          size: null,
          status: "rejected",
          reason: "WebP lossless候補を生成または検証できませんでした。",
        },
      });
    }
  }
  return candidates;
}

async function buildJpegCandidates(options: {
  input: LosslessImageOptimizationInput;
  settings: LosslessImageOptions;
  capabilities: ImageOptimizationToolCapabilities;
  sourceRgbaHash: string;
  sourceHasPrivacyMetadata: boolean;
  temporaryPaths: Set<string>;
}) {
  const {
    input,
    settings,
    capabilities,
    sourceRgbaHash,
    sourceHasPrivacyMetadata,
    temporaryPaths,
  } = options;
  const candidates: CandidateArtifact[] = [];
  const sourceMetadata = await sharp(await readFile(input.inputPath)).metadata();
  const sanitizedPath = join(
    /*turbopackIgnore: true*/ input.directory,
    "advanced-jpeg-source.jpg",
  );
  temporaryPaths.add(sanitizedPath);
  let toolInput = input.inputPath;
  if (settings.stripPrivacyMetadata) {
    const sanitized = sanitizeJpegMetadata(await readFile(input.inputPath));
    await writeFile(sanitizedPath, sanitized.buffer);
    toolInput = sanitizedPath;
  }

  if (capabilities.jpegtran.available) {
    for (const progressive of [false, true]) {
      const id = progressive ? "jpegtran-progressive" : "jpegtran-optimize";
      const outputPath = join(
        /*turbopackIgnore: true*/ input.directory,
        `advanced-${id}.jpg`,
      );
      temporaryPaths.add(outputPath);
      const transform = settings.stripPrivacyMetadata
        ? jpegTransformForOrientation(sourceMetadata.orientation)
        : [];
      try {
        await runTool({
          executable: capabilities.jpegtran.executable,
          arguments: [
            "-copy",
            "all",
            "-optimize",
            ...(progressive ? ["-progressive"] : []),
            ...transform,
            "-outfile",
            outputPath,
            toolInput,
          ],
          signal: input.signal,
        });
        candidates.push(
          await evaluatePixelCandidate({
            id,
            label: progressive
              ? "jpegtran プログレッシブ最適化"
              : "jpegtran ハフマン最適化",
            method: "jpegtran",
            format: "jpeg",
            inputPath: input.inputPath,
            outputPath,
            sourceRgbaHash,
            inputFormat: "jpeg",
            stripPrivacyMetadata: settings.stripPrivacyMetadata,
          }),
        );
      } catch (error) {
        if (error instanceof AppError && error.code === "CANCELLED") throw error;
        candidates.push({
          path: outputPath,
          eligible: false,
          report: {
            id,
            label: progressive
              ? "jpegtran プログレッシブ最適化"
              : "jpegtran ハフマン最適化",
            method: "jpegtran",
            format: "jpeg",
            size: null,
            status: "rejected",
            reason: "jpegtranが候補を生成できませんでした。",
          },
        });
      }
    }
  } else {
    candidates.push(
      unavailableCandidate(
        "jpegtran",
        "jpegtran 可逆最適化",
        "jpegtran",
        "jpeg",
        capabilities.jpegtran.reason ?? "jpegtranを利用できません。元画像を保持します。",
      ),
    );
  }

  if (settings.enableJpegXl) {
    if (!capabilities.cjxl.available || !capabilities.djxl.available) {
      candidates.push(
        unavailableCandidate(
          "jpeg-xl-reconstruction",
          "JPEG XL 可逆JPEGトランスコード",
          "cjxl+djxl",
          "jxl",
          "cjxlとdjxlの両方が必要です。元JPEGを保持します。",
        ),
      );
    } else {
      const jxlPath = join(
        /*turbopackIgnore: true*/ input.directory,
        "advanced-jpeg-lossless.jxl",
      );
      const restoredPath = join(
        /*turbopackIgnore: true*/ input.directory,
        "advanced-jpeg-restored.jpg",
      );
      temporaryPaths.add(jxlPath);
      temporaryPaths.add(restoredPath);
      try {
        await runTool({
          executable: capabilities.cjxl.executable,
          arguments: [input.inputPath, jxlPath, "--lossless_jpeg=1"],
          signal: input.signal,
        });
        await runTool({
          executable: capabilities.djxl.executable,
          arguments: [jxlPath, restoredPath],
          signal: input.signal,
        });
        const [sourceHash, restoredHash, details] = await Promise.all([
          fileHash(input.inputPath),
          fileHash(restoredPath),
          stat(jxlPath),
        ]);
        const exact = sourceHash === restoredHash;
        const privacyConflict = settings.stripPrivacyMetadata && sourceHasPrivacyMetadata;
        candidates.push({
          path: jxlPath,
          eligible: exact && !privacyConflict,
          report: {
            id: "jpeg-xl-reconstruction",
            label: "JPEG XL 可逆JPEGトランスコード",
            method: "cjxl+djxl",
            format: "jxl",
            size: details.size,
            status: exact && !privacyConflict ? "qualified" : "rejected",
            losslessVerified: exact,
            verificationMethod: "djxl復元JPEGのバイトSHA-256",
            reason: !exact
              ? "djxlで復元したJPEGのバイトハッシュが元JPEGと一致しませんでした。"
              : privacyConflict
                ? "完全復元ではプライバシーメタデータも戻るため、削除指定と両立しません。"
                : "元JPEGへ完全復元できることをバイトハッシュで確認しました。",
          },
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "CANCELLED") throw error;
        candidates.push({
          path: jxlPath,
          eligible: false,
          report: {
            id: "jpeg-xl-reconstruction",
            label: "JPEG XL 可逆JPEGトランスコード",
            method: "cjxl+djxl",
            format: "jxl",
            size: null,
            status: "rejected",
            losslessVerified: false,
            verificationMethod: "djxl復元JPEGのバイトSHA-256",
            reason: "JPEG XLへの変換または完全復元の検証に失敗しました。",
          },
        });
      }
    }
  }
  return candidates;
}

function reductionPercent(originalSize: number, outputSize: number) {
  if (originalSize <= 0) return 0;
  return Number((((originalSize - outputSize) / originalSize) * 100).toFixed(1));
}

export async function optimizeLosslessImage(
  input: LosslessImageOptimizationInput,
): Promise<LosslessImageOptimizationResult> {
  assertNotCancelled(input.signal);
  const settings = input.options ?? DEFAULT_LOSSLESS_IMAGE_OPTIONS;
  const mode = input.mode ?? "strict-lossless";
  const source = await readFile(/*turbopackIgnore: true*/ input.inputPath);
  const [metadata, originalDetails, capabilities, sourceRgbaHash] = await Promise.all([
    sharp(source, { animated: true, failOn: "error" }).metadata(),
    stat(input.inputPath),
    getImageOptimizationToolCapabilities(),
    rgbaFingerprint(input.inputPath),
  ]);
  const format = metadata.format;
  if (format !== "png" && format !== "jpeg") {
    throw new AppError(
      "高度な可逆画像最適化はPNGまたはJPEGに対応しています。",
      422,
      "LOSSLESS_IMAGE_FORMAT_UNSUPPORTED",
    );
  }
  if (originalDetails.size === 0) {
    throw new AppError("空の画像は最適化できません。", 400, "EMPTY_FILE");
  }

  const sourceHasPrivacyMetadata =
    format === "png"
      ? Boolean(pngChunkFingerprint(source, PNG_PRIVACY_CHUNKS))
      : sanitizeJpegMetadata(source).removed;
  const originalCanSatisfyPrivacy =
    !settings.stripPrivacyMetadata || !sourceHasPrivacyMetadata;
  const original: CandidateArtifact = {
    path: input.inputPath,
    eligible: originalCanSatisfyPrivacy,
    report: {
      id: "original",
      label: "元ファイル",
      method: "original",
      format,
      size: originalDetails.size,
      status: "qualified",
      losslessVerified: true,
      verificationMethod: "元ファイルのバイト列を保持",
      reason: originalCanSatisfyPrivacy
        ? "再エンコードせず元ファイルを保持できます。"
        : "削除対象のプライバシーメタデータが含まれています。",
    },
  };
  const temporaryPaths = new Set<string>();
  let generated: CandidateArtifact[] = [];
  try {
    generated =
      format === "png"
        ? await buildPngCandidates({
            input,
            settings,
            capabilities,
            sourceRgbaHash,
            temporaryPaths,
          })
        : await buildJpegCandidates({
            input,
            settings,
            capabilities,
            sourceRgbaHash,
            sourceHasPrivacyMetadata,
            temporaryPaths,
          });
    assertNotCancelled(input.signal);
    const eligibleGenerated = generated.filter(
      (candidate) =>
        candidate.eligible &&
        candidate.path &&
        candidate.report.size !== null &&
        candidate.report.losslessVerified === true,
    );
    const bestGenerated = eligibleGenerated.sort(
      (left, right) => (left.report.size ?? Infinity) - (right.report.size ?? Infinity),
    )[0];
    const selected =
      bestGenerated && (bestGenerated.report.size ?? Infinity) < originalDetails.size
        ? bestGenerated
        : original;
    selected.report.status = "selected";
    if (selected === original) {
      original.report.reason = !originalCanSatisfyPrivacy
        ? "プライバシー削除候補は元ファイルより大きくなるため自動採用せず、元を保持しました。指定されたメタデータ削除は未実施です。"
        : eligibleGenerated.length
          ? "検証済み候補が元ファイルより小さくならないため、元ファイルを採用しました。"
          : "利用可能で検証に合格した小さい候補がないため、元ファイルを採用しました。";
    } else if (!original.eligible) {
      selected.report.reason +=
        " プライバシーメタデータ削除を優先してこの候補を採用しました。";
      original.report.status = "rejected";
    } else {
      original.report.reason = "より小さく、無劣化検証に合格した候補が見つかりました。";
    }

    const selectedPath = selected.path ?? input.inputPath;
    const outputSize = selected.report.size ?? originalDetails.size;
    const keptOriginal = selectedPath === input.inputPath;
    const report: OptimizationReport = {
      mode,
      originalSize: originalDetails.size,
      outputSize,
      reductionPercent: reductionPercent(originalDetails.size, outputSize),
      selectedCandidateId: selected.report.id,
      selectedMethod: selected.report.method,
      selectedFormat: selected.report.format ?? format,
      keptOriginal,
      decisionReason: selected.report.reason,
      losslessVerification: {
        status: "passed",
        method:
          selected.report.verificationMethod ??
          (keptOriginal ? "元ファイル保持" : "RGBA SHA-256"),
        details: keptOriginal
          ? "元ファイルをそのまま採用しました。"
          : selected.report.reason,
      },
      candidates: [original.report, ...generated.map((candidate) => candidate.report)],
    };

    await Promise.allSettled(
      [...temporaryPaths]
        .filter((path) => path !== selectedPath)
        .map((path) => unlink(path)),
    );
    const safeOriginal = basename(input.originalName ?? "image")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-");
    const stem = parse(safeOriginal).name.slice(0, 110) || "image";
    const extension =
      report.selectedFormat === "jpeg" ? ".jpg" : `.${report.selectedFormat}`;
    return {
      selectedOutputPath: selectedPath,
      selectedOutputName: `${stem}-optimized${extension}`,
      report,
      capabilities,
    };
  } catch (error) {
    await Promise.allSettled([...temporaryPaths].map((path) => unlink(path)));
    throw error;
  }
}

export const optimizeImageLosslessly = optimizeLosslessImage;
