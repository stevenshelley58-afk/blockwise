import { sha256Hex } from "../../../packages/ad-template-pack-contract/src/hash.ts";
import type { AdDocumentParsed } from "../../../packages/ad-template-pack-contract/src/schema.ts";

/** Recompute the document hash after server-side ref substitution. */
export function withPersistedDocumentHash(document: AdDocumentParsed): AdDocumentParsed {
  const unhashed = { ...document, documentHash: "0".repeat(64) };
  return { ...unhashed, documentHash: sha256Hex(unhashed) };
}

export function containsInlineImageData(value: unknown): boolean {
  if (typeof value === "string") return /^data:image\//i.test(value) || /base64,/i.test(value);
  if (Array.isArray(value)) return value.some(containsInlineImageData);
  if (value && typeof value === "object") return Object.values(value).some(containsInlineImageData);
  return false;
}
