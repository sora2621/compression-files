import { sanitizeDownloadFileName } from "./create-compressed-file-name";

function encodeRfc5987(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function createContentDisposition(
  fileName: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const safeName = sanitizeDownloadFileName(fileName);
  const asciiFallback =
    safeName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .replace(/[\r\n]/g, "_") || "compressed_file";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}
