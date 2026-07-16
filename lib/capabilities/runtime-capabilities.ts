import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

import {
  detectHardwareAcceleration,
  type HardwareAccelerationCapabilities,
} from "@/lib/capabilities/hardware-acceleration";
import { getAiQueueStatus } from "@/lib/jobs/ai-queue";
import {
  configureProcessingResources,
  getProcessingConcurrency,
} from "@/lib/jobs/processing-scheduler";

export interface RuntimeCapabilities {
  generatedAt: string;
  ffmpeg: {
    available: boolean;
    version: string | null;
    demuxers: string[];
    muxers: string[];
    decoders: string[];
    encoders: string[];
    filters: string[];
    hwaccels: string[];
    hardware: HardwareAccelerationCapabilities;
  };
  sharp: {
    available: boolean;
    version: string;
    libvipsVersion: string;
    inputFormats: string[];
    inputExtensions: string[];
    outputFormats: string[];
  };
  outputs: { image: string[]; video: string[]; audio: string[] };
  ai: {
    realEsrgan: boolean;
    gfpgan: boolean;
    python: boolean;
    gpu: boolean;
    gpuMemoryMb: number;
    ncnnVulkan: boolean;
    reason: string | null;
    queue: { active: number; waiting: number; concurrency: number };
  };
  processing: ReturnType<typeof getProcessingConcurrency>;
}

const CACHE_MS = 10 * 60 * 1000;

interface RuntimeCapabilitiesCacheEntry {
  expiresAt: number;
  value: Promise<RuntimeCapabilities>;
}

const runtimeCapabilitiesGlobal = globalThis as typeof globalThis & {
  compressionFilesRuntimeCapabilitiesCache?: RuntimeCapabilitiesCacheEntry;
};

function runCommand(executable: string, args: string[], timeoutMs = 20_000) {
  return new Promise<string>((resolveOutput, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-4_000_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out: ${args[0] ?? "unknown"}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveOutput(output);
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function parseFfmpegFormats(output: string) {
  const demuxers: string[] = [];
  const muxers: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s([D ])([E ])\s+([^\s]+)/);
    if (!match) continue;
    const names = match[3].split(",");
    if (match[1] === "D") demuxers.push(...names);
    if (match[2] === "E") muxers.push(...names);
  }
  return { demuxers: uniqueSorted(demuxers), muxers: uniqueSorted(muxers) };
}

export function parseFfmpegCodecs(output: string) {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS][A-Z.]{5}\s+([^\s]+)/i);
    if (match && match[1] !== "=") names.push(match[1]);
  }
  return uniqueSorted(names);
}

export function parseFfmpegFilters(output: string) {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[T.][S.][C.]\s+([^\s]+)/);
    if (match && match[1] !== "=") names.push(match[1]);
  }
  return uniqueSorted(names);
}

export function parseFfmpegHwaccels(output: string) {
  return uniqueSorted(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z0-9_]+$/i.test(line) && line !== "Hardware"),
  );
}

function sharpCapabilities() {
  const inputs: string[] = [];
  const inputExtensions: string[] = [];
  const outputs: string[] = [];
  for (const [name, support] of Object.entries(sharp.format)) {
    if (support.input.file || support.input.buffer) {
      inputs.push(name);
      inputExtensions.push(...(support.input.fileSuffix ?? []));
    }
    if (support.output.file || support.output.buffer) outputs.push(name);
  }
  return {
    available: true,
    version: sharp.versions.sharp,
    libvipsVersion: sharp.versions.vips,
    inputFormats: uniqueSorted(inputs),
    inputExtensions: uniqueSorted(inputExtensions),
    outputFormats: uniqueSorted(outputs),
  };
}

async function aiCapabilities() {
  const python = process.env.AI_PYTHON_PATH ?? "python";
  const worker = process.env.AI_WORKER_PATH ?? "workers/ai_image_worker.py";
  try {
    const raw = await runCommand(python, [worker, "--capabilities"], 15_000);
    const line = raw
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find((value) => value.startsWith("{"));
    if (!line) throw new Error("Worker returned no capability JSON");
    const result = JSON.parse(line) as {
      python?: boolean;
      realEsrgan?: boolean;
      gfpgan?: boolean;
      gpu?: boolean;
      gpuMemoryMb?: number;
      ncnnVulkan?: boolean;
      reason?: string;
    };
    return {
      python: result.python === true,
      realEsrgan: result.realEsrgan === true,
      gfpgan: result.gfpgan === true,
      gpu: result.gpu === true,
      gpuMemoryMb: typeof result.gpuMemoryMb === "number" ? result.gpuMemoryMb : 0,
      ncnnVulkan: result.ncnnVulkan === true,
      reason: result.reason ?? null,
      queue: getAiQueueStatus(),
    };
  } catch {
    return {
      python: false,
      realEsrgan: false,
      gfpgan: false,
      gpu: false,
      gpuMemoryMb: 0,
      ncnnVulkan: false,
      reason:
        "PythonまたはReal-ESRGANワーカーを利用できません。AI_PYTHON_PATHとモデル設定を確認してください。",
      queue: getAiQueueStatus(),
    };
  }
}

function supportedImageOutputs(outputs: string[]) {
  const available = new Set(outputs);
  return [
    available.has("png") && "png",
    available.has("jpeg") && "jpeg",
    available.has("webp") && "webp",
    available.has("heif") && "avif",
    available.has("tiff") && "tiff",
    available.has("gif") && "gif",
  ].filter((value): value is string => Boolean(value));
}

function supportedVideoOutputs(muxers: string[], encoders: string[]) {
  const mux = new Set(muxers);
  const encoder = new Set(encoders);
  const hasH26x = encoder.has("libx264") || encoder.has("libx265");
  return [
    mux.has("mp4") && hasH26x && "mp4",
    mux.has("webm") && (encoder.has("libvpx-vp9") || encoder.has("libaom-av1")) && "webm",
    mux.has("matroska") && hasH26x && "mkv",
    mux.has("mov") && hasH26x && "mov",
  ].filter((value): value is string => Boolean(value));
}

function supportedAudioOutputs(muxers: string[], encoders: string[]) {
  const mux = new Set(muxers);
  const encoder = new Set(encoders);
  return [
    mux.has("mp3") && encoder.has("libmp3lame") && "mp3",
    (mux.has("ipod") || mux.has("mp4")) && encoder.has("aac") && "m4a",
    (mux.has("adts") || mux.has("aac")) && encoder.has("aac") && "aac",
    (mux.has("opus") || mux.has("ogg")) && encoder.has("libopus") && "opus",
    mux.has("ogg") && encoder.has("libvorbis") && "ogg",
    mux.has("flac") && encoder.has("flac") && "flac",
    mux.has("wav") && encoder.has("pcm_s16le") && "wav",
  ].filter((value): value is string => Boolean(value));
}

async function discoverCapabilities(): Promise<RuntimeCapabilities> {
  const sharpInfo = sharpCapabilities();
  const aiPromise = aiCapabilities();
  const executable = process.env.FFMPEG_PATH ?? ffmpegPath;
  const ffmpegPromise = executable
    ? Promise.all([
        runCommand(executable, ["-version"]),
        runCommand(executable, ["-hide_banner", "-formats"]),
        runCommand(executable, ["-hide_banner", "-demuxers"]),
        runCommand(executable, ["-hide_banner", "-muxers"]),
        runCommand(executable, ["-hide_banner", "-decoders"]),
        runCommand(executable, ["-hide_banner", "-encoders"]),
        runCommand(executable, ["-hide_banner", "-filters"]),
        runCommand(executable, ["-hide_banner", "-hwaccels"]),
      ]).catch(() => null)
    : Promise.resolve(null);
  const [ai, commandOutputs] = await Promise.all([aiPromise, ffmpegPromise]);

  if (!commandOutputs) {
    return {
      generatedAt: new Date().toISOString(),
      ffmpeg: {
        available: false,
        version: null,
        demuxers: [],
        muxers: [],
        decoders: [],
        encoders: [],
        filters: [],
        hwaccels: [],
        hardware: { APIs: [], compiledEncoders: [], usableEncoders: [], gpuCount: 0 },
      },
      sharp: sharpInfo,
      outputs: {
        image: supportedImageOutputs(sharpInfo.outputFormats),
        video: [],
        audio: [],
      },
      ai,
      processing: getProcessingConcurrency(),
    };
  }
  const [
    versionRaw,
    formatsRaw,
    demuxersRaw,
    muxersRaw,
    decodersRaw,
    encodersRaw,
    filtersRaw,
    hwaccelsRaw,
  ] = commandOutputs;
  const formats = parseFfmpegFormats(formatsRaw);
  const demuxers = uniqueSorted([
    ...formats.demuxers,
    ...parseFfmpegFormats(demuxersRaw).demuxers,
  ]);
  const muxers = uniqueSorted([
    ...formats.muxers,
    ...parseFfmpegFormats(muxersRaw).muxers,
  ]);
  const decoders = parseFfmpegCodecs(decodersRaw);
  const encoders = parseFfmpegCodecs(encodersRaw);
  const filters = parseFfmpegFilters(filtersRaw);
  const hwaccels = parseFfmpegHwaccels(hwaccelsRaw);
  const hardware = await detectHardwareAcceleration({
    executable: executable!,
    APIs: hwaccels,
    encoders,
  });
  configureProcessingResources({ gpuCount: hardware.gpuCount });
  return {
    generatedAt: new Date().toISOString(),
    ffmpeg: {
      available: true,
      version: versionRaw.split(/\r?\n/)[0]?.trim() ?? null,
      demuxers,
      muxers,
      decoders,
      encoders,
      filters,
      hwaccels,
      hardware,
    },
    sharp: sharpInfo,
    outputs: {
      image: supportedImageOutputs(sharpInfo.outputFormats),
      video: supportedVideoOutputs(muxers, encoders),
      audio: supportedAudioOutputs(muxers, encoders),
    },
    ai,
    processing: getProcessingConcurrency(),
  };
}

export function getRuntimeCapabilities(force = false) {
  const now = Date.now();
  const cached = runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache;
  if (!force && cached && cached.expiresAt > now) return cached.value;

  const value = discoverCapabilities();
  const entry: RuntimeCapabilitiesCacheEntry = {
    // Keep concurrent callers on the same in-flight discovery even if it is slow.
    expiresAt: Number.POSITIVE_INFINITY,
    value,
  };
  runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache = entry;
  void value.then(
    () => {
      if (runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache === entry) {
        entry.expiresAt = Date.now() + CACHE_MS;
      }
    },
    () => {
      if (runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache === entry) {
        delete runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache;
      }
    },
  );
  return value;
}

/** Test/dev hook for environments whose installed capabilities change at runtime. */
export function clearRuntimeCapabilitiesCache() {
  delete runtimeCapabilitiesGlobal.compressionFilesRuntimeCapabilitiesCache;
}
