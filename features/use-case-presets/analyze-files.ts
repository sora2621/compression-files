import type { AnalyzedFile, FileAnalysisSummary } from "./types";

function kindFromFile(file: File): AnalyzedFile["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (
    ["jpg", "jpeg", "png", "webp", "avif", "gif", "tif", "tiff"].includes(extension ?? "")
  )
    return "image";
  if (["mp4", "mov", "mkv", "webm", "avi", "m4v"].includes(extension ?? ""))
    return "video";
  if (["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"].includes(extension ?? ""))
    return "audio";
  return "unknown";
}

async function analyzeImage(
  file: File,
): Promise<Pick<AnalyzedFile, "width" | "height" | "hasTransparency">> {
  const bitmap = await createImageBitmap(file);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 96 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasTransparency = false;
    if (pixels) {
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] < 255) {
          hasTransparency = true;
          break;
        }
      }
    }
    return { width, height, hasTransparency };
  } finally {
    bitmap.close();
  }
}

function analyzeTimedMedia(file: File, kind: "video" | "audio") {
  return new Promise<Pick<AnalyzedFile, "width" | "height" | "duration">>((resolve) => {
    const element = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const finish = (result: Pick<AnalyzedFile, "width" | "height" | "duration">) => {
      URL.revokeObjectURL(url);
      element.removeAttribute("src");
      element.load();
      resolve(result);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () =>
      finish({
        width: kind === "video" ? (element as HTMLVideoElement).videoWidth : null,
        height: kind === "video" ? (element as HTMLVideoElement).videoHeight : null,
        duration: Number.isFinite(element.duration) ? element.duration : null,
      });
    element.onerror = () => finish({ width: null, height: null, duration: null });
    element.src = url;
  });
}

async function analyzeOne(file: File): Promise<AnalyzedFile> {
  const kind = kindFromFile(file);
  const fallback: AnalyzedFile = {
    file,
    kind,
    width: null,
    height: null,
    duration: null,
    hasTransparency: null,
  };
  try {
    if (kind === "image") return { ...fallback, ...(await analyzeImage(file)) };
    if (kind === "video" || kind === "audio") {
      return { ...fallback, ...(await analyzeTimedMedia(file, kind)) };
    }
  } catch {
    // The server performs the authoritative inspection; browser decoding is best effort.
  }
  return fallback;
}

export async function analyzeFiles(files: File[]): Promise<FileAnalysisSummary> {
  const analyzed = await Promise.all(files.map(analyzeOne));
  const knownKinds = analyzed
    .map((item) => item.kind)
    .filter((kind): kind is "image" | "video" | "audio" => kind !== "unknown");
  return {
    files: analyzed,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    kinds: [...new Set(knownKinds)],
    maxLongEdge:
      analyzed.reduce<number | null>((maximum, item) => {
        const edge = Math.max(item.width ?? 0, item.height ?? 0);
        return edge > (maximum ?? 0) ? edge : maximum;
      }, null) ?? null,
    maxDuration:
      analyzed.reduce<number | null>((maximum, item) => {
        const duration = item.duration ?? 0;
        return duration > (maximum ?? 0) ? duration : maximum;
      }, null) ?? null,
    hasTransparency: analyzed.some((item) => item.hasTransparency === true),
  };
}
