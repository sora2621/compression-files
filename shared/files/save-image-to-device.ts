import { downloadBlob } from "./download-blob";

export const IMAGE_SAVE_ERROR_MESSAGE =
  "画像を保存できませんでした。もう一度お試しください。";

export const IMAGE_SHARE_DESCRIPTION = "Compression Filesで処理した画像です。";

interface ImageShareNavigator {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
}

interface SaveImageDependencies {
  navigator?: ImageShareNavigator;
  location?: Pick<Location, "protocol">;
  File?: typeof File;
  document?: Pick<Document, "body" | "createElement">;
  url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export interface SaveImageOptions {
  blob: Blob;
  fileName: string;
  mimeType?: string;
  title?: string;
}

export type SaveImageResult =
  | { status: "saved"; method: "share" | "download" }
  | { status: "cancelled"; method: "share" };

function createImageFile(
  { blob, fileName, mimeType }: SaveImageOptions,
  FileApi: typeof File,
): File {
  return new FileApi([blob], fileName, {
    type: mimeType || blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

function isHttps(locationApi: Pick<Location, "protocol"> | undefined): boolean {
  return locationApi?.protocol === "https:";
}

export function canShareImageFile(
  options: SaveImageOptions,
  dependencies: SaveImageDependencies = {},
): boolean {
  const navigatorApi = dependencies.navigator ?? navigator;
  const locationApi = dependencies.location ?? location;
  const FileApi = dependencies.File ?? File;

  if (
    !isHttps(locationApi) ||
    typeof navigatorApi.share !== "function" ||
    typeof navigatorApi.canShare !== "function"
  ) {
    return false;
  }

  try {
    const file = createImageFile(options, FileApi);
    return navigatorApi.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function isShareCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function saveImageToDevice(
  options: SaveImageOptions,
  dependencies: SaveImageDependencies = {},
): Promise<SaveImageResult> {
  const navigatorApi = dependencies.navigator ?? navigator;
  const locationApi = dependencies.location ?? location;
  const FileApi = dependencies.File ?? File;
  const file = createImageFile(options, FileApi);

  let fileShareAvailable = false;
  if (
    isHttps(locationApi) &&
    typeof navigatorApi.share === "function" &&
    typeof navigatorApi.canShare === "function"
  ) {
    try {
      fileShareAvailable = navigatorApi.canShare({ files: [file] });
    } catch {
      fileShareAvailable = false;
    }
  }

  if (fileShareAvailable && navigatorApi.share) {
    try {
      await navigatorApi.share({
        files: [file],
        title: options.title ?? "画像を保存",
        text: IMAGE_SHARE_DESCRIPTION,
      });
      return { status: "saved", method: "share" };
    } catch (error) {
      if (isShareCancellation(error)) {
        return { status: "cancelled", method: "share" };
      }
      throw error;
    }
  }

  downloadBlob(options.blob, options.fileName, {
    document: dependencies.document,
    url: dependencies.url,
  });
  return { status: "saved", method: "download" };
}
