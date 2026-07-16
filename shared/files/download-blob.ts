import { sanitizeDownloadFileName } from "./create-compressed-file-name";

interface BrowserDownloadDependencies {
  document?: Pick<Document, "body" | "createElement">;
  url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export function downloadBlob(
  blob: Blob,
  fileName: string,
  dependencies: BrowserDownloadDependencies = {},
) {
  const documentApi = dependencies.document ?? document;
  const urlApi = dependencies.url ?? URL;
  const downloadUrl = urlApi.createObjectURL(blob);
  const anchor = documentApi.createElement("a");
  try {
    anchor.href = downloadUrl;
    anchor.download = sanitizeDownloadFileName(fileName);
    anchor.hidden = true;
    documentApi.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    urlApi.revokeObjectURL(downloadUrl);
  }
}
