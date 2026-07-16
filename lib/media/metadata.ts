import { readFile } from "node:fs/promises";

import * as exifr from "exifr";
import sharp from "sharp";

export interface MetadataField {
  group: "EXIF" | "GPS" | "XMP" | "IPTC";
  key: string;
  value: string;
}

export interface MetadataReport {
  detected: boolean;
  types: string[];
  fields: MetadataField[];
}

function displayValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).slice(0, 180);
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ").slice(0, 180);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value).slice(0, 180);
  }
  return String(value ?? "");
}

function metadataGroup(key: string): MetadataField["group"] {
  if (/gps|latitude|longitude|altitude/i.test(key)) return "GPS";
  if (/xmp|creator|rights|rating|label/i.test(key)) return "XMP";
  if (/iptc|headline|caption|byline|keywords/i.test(key)) return "IPTC";
  return "EXIF";
}

const STRUCTURAL_FIELDS = new Set([
  "ImageWidth",
  "ImageHeight",
  "BitDepth",
  "ColorType",
  "Compression",
  "Filter",
  "Interlace",
  "JFIFVersion",
  "ResolutionUnit",
  "XResolution",
  "YResolution",
  "ComponentsConfiguration",
]);

export async function inspectImageMetadata(filePath: string): Promise<MetadataReport> {
  const imageMetadata = await sharp(filePath).metadata();
  const buffer = await readFile(/*turbopackIgnore: true*/ filePath);
  let parsed: Record<string, unknown> = {};

  try {
    parsed =
      ((await exifr.parse(buffer, {
        tiff: true,
        exif: true,
        gps: true,
        interop: true,
        xmp: true,
        iptc: true,
        icc: false,
        translateKeys: true,
        translateValues: true,
        reviveValues: true,
        sanitize: true,
      })) as Record<string, unknown> | undefined) ?? {};
  } catch {
    // Broken metadata must not prevent the image itself from being optimized.
  }

  const fields = Object.entries(parsed)
    .filter(
      ([key, value]) =>
        value !== undefined && value !== null && !STRUCTURAL_FIELDS.has(key),
    )
    .slice(0, 24)
    .map(([key, value]) => ({
      group: metadataGroup(key),
      key,
      value: displayValue(value),
    }));

  const types = new Set<string>();
  if (imageMetadata.exif) types.add("EXIF");
  if (imageMetadata.xmp) types.add("XMP");
  if (imageMetadata.iptc) types.add("IPTC");
  if (fields.some((field) => field.group === "GPS")) types.add("GPS");

  const relevantFields = fields.filter((field) => {
    if (field.group === "GPS") return true;
    return types.has(field.group);
  });

  return {
    detected: types.size > 0,
    types: [...types],
    fields: relevantFields,
  };
}
