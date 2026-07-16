const INVALID_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export const COMPRESSION_ZIP_FILE_NAME = "compression_files_comp.zip";

export function sanitizeDownloadFileName(
  fileName: string,
  fallback = "compressed_file",
): string {
  const sanitized = String(fileName ?? "")
    .normalize("NFC")
    .replace(INVALID_FILE_NAME_CHARACTERS, "_")
    .replace(TRAILING_DOTS_OR_SPACES, "");
  const safeName = sanitized || fallback;
  return WINDOWS_RESERVED_NAME.test(safeName) ? `_${safeName}` : safeName;
}

export function normalizeOutputExtension(outputExtension: string): string {
  const normalized = String(outputExtension ?? "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return normalized || "bin";
}

export function createCompressedFileName(
  originalFileName: string,
  outputExtension: string,
): string {
  const original = sanitizeDownloadFileName(originalFileName, "");
  const lastDot = original.lastIndexOf(".");
  const withoutLastExtension = lastDot >= 0 ? original.slice(0, lastDot) : original;
  const baseName = sanitizeDownloadFileName(withoutLastExtension, "compressed_file");
  return `${baseName}_comp.${normalizeOutputExtension(outputExtension)}`;
}

function splitExtension(fileName: string) {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return { baseName: fileName, extension: "" };
  return {
    baseName: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  };
}

export function createUniqueDownloadFileName(
  requestedFileName: string,
  usedFileNames: Set<string>,
): string {
  const safeName = sanitizeDownloadFileName(requestedFileName);
  const key = safeName.toLocaleLowerCase("en-US");
  if (!usedFileNames.has(key)) {
    usedFileNames.add(key);
    return safeName;
  }

  const { baseName, extension } = splitExtension(safeName);
  for (let sequence = 2; ; sequence += 1) {
    const candidate = `${baseName}_${sequence}${extension}`;
    const candidateKey = candidate.toLocaleLowerCase("en-US");
    if (!usedFileNames.has(candidateKey)) {
      usedFileNames.add(candidateKey);
      return candidate;
    }
  }
}

export function createZipEntryFileNames(
  files: ReadonlyArray<{ originalFileName: string; outputExtension: string }>,
): string[] {
  const usedFileNames = new Set<string>();
  return files.map(({ originalFileName, outputExtension }) =>
    createUniqueDownloadFileName(
      createCompressedFileName(originalFileName, outputExtension),
      usedFileNames,
    ),
  );
}
