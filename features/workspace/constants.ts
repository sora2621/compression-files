import { getOutputFormatsForCategory } from "@/shared/media/output-formats";

import type { ImageOutputFormat } from "@/lib/media/image-types";

export const MAX_FILES = 10;
export const VIDEO_LIMIT = 250 * 1024 * 1024;

export interface OutputFormatOption {
  id: ImageOutputFormat;
  label: string;
  description: string;
  detail: string;
}

export const OUTPUT_FORMATS: OutputFormatOption[] = getOutputFormatsForCategory(
  "image",
).map((definition) => ({
  id: definition.value as ImageOutputFormat,
  label: definition.label,
  description: definition.recommendations.slice(0, 2).join("・"),
  detail: definition.description,
}));
