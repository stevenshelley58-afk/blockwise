// Template identity. Server/CLI only — node:crypto keeps this out of the
// browser editor's bundle, which is why it is not part of template-doc.ts.

import { createHash } from "node:crypto";

import { normalizeCanonicalJson, type AdTemplateDocV2 } from "./template-doc.ts";

/** sha256 of the canonical JSON — what an instance doc's templateHash pins. */
export function hashTemplateDoc(doc: AdTemplateDocV2): string {
  return createHash("sha256").update(normalizeCanonicalJson(doc), "utf8").digest("hex");
}

/** sha256 of any value's canonical JSON (evidence blobs, restyle records). */
export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(normalizeCanonicalJson(value), "utf8").digest("hex");
}
