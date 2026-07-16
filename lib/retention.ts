import { FILE_TTL_MS } from "@/lib/config";

export const ALLOWED_RETENTION_MINUTES = [10, 30, 60] as const;
export type AllowedRetentionMinutes = (typeof ALLOWED_RETENTION_MINUTES)[number];

export function normalizeRetentionMinutes(value: unknown): AllowedRetentionMinutes {
  const parsed = Number(value);
  return ALLOWED_RETENTION_MINUTES.includes(parsed as AllowedRetentionMinutes)
    ? (parsed as AllowedRetentionMinutes)
    : ((FILE_TTL_MS / 60_000) as AllowedRetentionMinutes);
}
