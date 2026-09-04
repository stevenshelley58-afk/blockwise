import { META_CTA_VALUES } from "./meta-cta.ts";

/** The single customer-facing Meta copy contract shared by every boundary. */
export const META_COPY_CONSTRAINTS = {
  primaryText: 125,
  headline: 40,
  description: 30,
  cta: 25,
} as const;

/** CTA values accepted by the Meta provider and persisted ad document. */
export const META_COPY_CTA_VALUES = META_CTA_VALUES;

export type AdStudioMetaCopy = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type MetaCopyField = keyof AdStudioMetaCopy;

/** Return deterministic length violations for server and client boundaries. */
export function metaCopyLimitIssues(copy: Partial<Record<MetaCopyField, unknown>>): Array<{
  field: MetaCopyField;
  maxLength: number;
  actualLength: number;
}> {
  return (Object.keys(META_COPY_CONSTRAINTS) as MetaCopyField[]).flatMap((field) => {
    const value = copy[field];
    if (typeof value !== "string") return [];
    const maxLength = META_COPY_CONSTRAINTS[field];
    return value.length > maxLength ? [{ field, maxLength, actualLength: value.length }] : [];
  });
}

/** Shorten at whitespace where possible so generated copy never ends mid-word. */
export function truncateAtWordBoundary(value: string, limit: number): string {
  const text = value.trim();
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit).trimEnd();
  const boundary = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"), prefix.lastIndexOf("\t"));
  return (boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd();
}
