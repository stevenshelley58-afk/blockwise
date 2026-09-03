import { createHash } from "node:crypto";

/** Hash customer image bytes in server-only storage and API paths. */
export function imageSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
