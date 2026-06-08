import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Vercel signs webhook bodies with HMAC-SHA1 of the raw body using the webhook
 * secret, sent as the x-vercel-signature header (hex).
 * https://vercel.com/docs/spend-management
 */
export function verifyVercelSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha1", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
