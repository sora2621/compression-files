import { spawn } from "node:child_process";

export type ImageOptimizationTool = "oxipng" | "zopflipng" | "jpegtran" | "cjxl" | "djxl";

export interface ImageOptimizationToolCapability {
  available: boolean;
  executable: string;
  version?: string;
  reason?: string;
}

export type ImageOptimizationToolCapabilities = Record<
  ImageOptimizationTool,
  ImageOptimizationToolCapability
>;

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PROBE_OUTPUT = 64 * 1024;

const TOOL_CONFIGURATION: Record<
  ImageOptimizationTool,
  { environmentName: string; command: string; arguments: readonly string[] }
> = {
  oxipng: {
    environmentName: "OXIPNG_PATH",
    command: "oxipng",
    arguments: ["--version"],
  },
  zopflipng: {
    environmentName: "ZOPFLIPNG_PATH",
    command: "zopflipng",
    arguments: ["--help"],
  },
  jpegtran: {
    environmentName: "JPEGTRAN_PATH",
    command: "jpegtran",
    arguments: ["-version"],
  },
  cjxl: {
    environmentName: "CJXL_PATH",
    command: "cjxl",
    arguments: ["--version"],
  },
  djxl: {
    environmentName: "DJXL_PATH",
    command: "djxl",
    arguments: ["--version"],
  },
};

interface ImageOptimizationToolCapabilitiesCacheEntry {
  expiresAt: number;
  value: Promise<ImageOptimizationToolCapabilities>;
}

const toolCapabilitiesGlobal = globalThis as typeof globalThis & {
  compressionFilesImageToolCapabilitiesCache?: ImageOptimizationToolCapabilitiesCacheEntry;
};

function firstLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 240);
}

function probeTool(
  executable: string,
  arguments_: readonly string[],
): Promise<Omit<ImageOptimizationToolCapability, "executable">> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...arguments_], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const settle = (value: Omit<ImageOptimizationToolCapability, "executable">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-MAX_PROBE_OUTPUT);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error: NodeJS.ErrnoException) => {
      settle({
        available: false,
        reason:
          error.code === "ENOENT"
            ? "実行ファイルが見つかりません。"
            : "実行ファイルを起動できませんでした。",
      });
    });
    child.once("close", (code) => {
      // Some builds return 1 after printing help. Successful process creation
      // plus recognizable output is sufficient for capability discovery.
      const version = firstLine(output);
      settle(
        code === 0 || (code === 1 && Boolean(version))
          ? { available: true, version }
          : {
              available: false,
              reason: "対応確認コマンドを正常に実行できませんでした。",
            },
      );
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ available: false, reason: "対応確認がタイムアウトしました。" });
    }, 5_000);
    timeout.unref();
  });
}

async function discoverImageOptimizationToolCapabilities() {
  const entries = await Promise.all(
    (Object.keys(TOOL_CONFIGURATION) as ImageOptimizationTool[]).map(async (tool) => {
      const configuration = TOOL_CONFIGURATION[tool];
      const executable =
        process.env[configuration.environmentName] ?? configuration.command;
      const capability = await probeTool(executable, configuration.arguments);
      return [tool, { executable, ...capability }] as const;
    }),
  );
  return Object.fromEntries(entries) as ImageOptimizationToolCapabilities;
}

export function getImageOptimizationToolCapabilities(options?: { refresh?: boolean }) {
  const cached = toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache;
  if (!options?.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = discoverImageOptimizationToolCapabilities();
  const entry: ImageOptimizationToolCapabilitiesCacheEntry = {
    // An in-flight discovery is valid until it settles, regardless of wall-clock time.
    expiresAt: Number.POSITIVE_INFINITY,
    value,
  };
  toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache = entry;
  void value.then(
    () => {
      if (toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache === entry) {
        entry.expiresAt = Date.now() + CACHE_TTL_MS;
      }
    },
    () => {
      if (toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache === entry) {
        delete toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache;
      }
    },
  );
  return value;
}

/** Test/dev hook for environments that install tools after the server starts. */
export function clearImageOptimizationToolCapabilityCache() {
  delete toolCapabilitiesGlobal.compressionFilesImageToolCapabilitiesCache;
}
