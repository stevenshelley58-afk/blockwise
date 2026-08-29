import { createHash } from "node:crypto";

export function documentToken(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(documentToken).join(",") + "]";
  return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + documentToken((value as Record<string, unknown>)[key])).join(",") + "}";
}

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(documentToken(value)).digest("hex");
}
