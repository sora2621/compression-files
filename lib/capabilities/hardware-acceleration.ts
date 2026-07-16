import { runCommand, type CommandRunner } from "@/infrastructure/process/command-runner";

import type { VideoCodec } from "@/lib/media/video-types";

export const HARDWARE_ENCODERS = [
  "h264_nvenc",
  "hevc_nvenc",
  "av1_nvenc",
  "h264_qsv",
  "hevc_qsv",
  "av1_qsv",
  "h264_amf",
  "hevc_amf",
  "av1_amf",
  "h264_videotoolbox",
  "hevc_videotoolbox",
  "h264_vaapi",
  "hevc_vaapi",
] as const;

export type HardwareEncoder = (typeof HARDWARE_ENCODERS)[number];

export interface HardwareAccelerationCapabilities {
  APIs: string[];
  compiledEncoders: HardwareEncoder[];
  usableEncoders: HardwareEncoder[];
  gpuCount: number;
}

const CACHE_MS = 30 * 60 * 1000;
const globalHardwareCache = globalThis as typeof globalThis & {
  compressionFilesHardwareCache?: Map<
    string,
    { expiresAt: number; value: Promise<HardwareAccelerationCapabilities> }
  >;
};

function testEncoderArgs(encoder: HardwareEncoder) {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=128x72:r=30:d=0.1",
    "-frames:v",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    encoder,
  ];
  if (encoder.endsWith("_nvenc")) args.push("-preset", "p4", "-cq", "23");
  if (encoder.endsWith("_qsv")) args.push("-preset", "medium", "-global_quality", "23");
  if (encoder.endsWith("_amf")) args.push("-quality", "speed", "-qp_i", "23");
  args.push("-f", "null", process.platform === "win32" ? "NUL" : "/dev/null");
  return args;
}

async function testEncoder(
  executable: string,
  encoder: HardwareEncoder,
  runner: CommandRunner,
) {
  try {
    await runner(executable, testEncoderArgs(encoder), {
      timeoutMs: 8_000,
      stdoutLimitBytes: 32_000,
      stderrLimitBytes: 32_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function selectHardwareEncoder(
  codec: VideoCodec,
  capabilities: HardwareAccelerationCapabilities | undefined,
): HardwareEncoder | undefined {
  if (!capabilities) return undefined;
  const candidates =
    codec === "h264"
      ? ([
          "h264_nvenc",
          "h264_qsv",
          "h264_amf",
          "h264_videotoolbox",
          "h264_vaapi",
        ] as const)
      : codec === "h265"
        ? ([
            "hevc_nvenc",
            "hevc_qsv",
            "hevc_amf",
            "hevc_videotoolbox",
            "hevc_vaapi",
          ] as const)
        : codec === "av1"
          ? (["av1_nvenc", "av1_qsv", "av1_amf"] as const)
          : [];
  return candidates.find((encoder) => capabilities.usableEncoders.includes(encoder));
}

export function detectHardwareAcceleration(options: {
  executable: string;
  APIs: readonly string[];
  encoders: readonly string[];
  runner?: CommandRunner;
  force?: boolean;
}) {
  const cache = (globalHardwareCache.compressionFilesHardwareCache ??= new Map());
  const key = options.executable;
  const now = Date.now();
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > now) return cached.value;

  const compiledEncoders = HARDWARE_ENCODERS.filter((encoder) =>
    options.encoders.includes(encoder),
  );
  const runner = options.runner ?? runCommand;
  const value = Promise.all(
    compiledEncoders.map(async (encoder) => ({
      encoder,
      usable: await testEncoder(options.executable, encoder, runner),
    })),
  ).then((results) => {
    const usableEncoders = results
      .filter((result) => result.usable)
      .map((result) => result.encoder);
    const vendors = new Set(
      usableEncoders.map((encoder) =>
        encoder.endsWith("_nvenc")
          ? "nvidia"
          : encoder.endsWith("_qsv")
            ? "intel"
            : encoder.endsWith("_amf")
              ? "amd"
              : encoder.endsWith("_vaapi")
                ? "vaapi"
                : "apple",
      ),
    );
    return {
      APIs: [...options.APIs],
      compiledEncoders,
      usableEncoders,
      gpuCount: vendors.size,
    } satisfies HardwareAccelerationCapabilities;
  });
  const entry = { expiresAt: Number.POSITIVE_INFINITY, value };
  cache.set(key, entry);
  void value.then(
    () => {
      if (cache.get(key) === entry) entry.expiresAt = Date.now() + CACHE_MS;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return value;
}

export function clearHardwareAccelerationCache() {
  globalHardwareCache.compressionFilesHardwareCache?.clear();
}
