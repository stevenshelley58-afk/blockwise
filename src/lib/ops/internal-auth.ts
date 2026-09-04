import { createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_OPS_MAX_SKEW_SECONDS = 300;

export type InternalOpsAuthResult = { ok: true } | { ok: false; error: "missing" | "invalid" | "expired" };

/**
 * Hermes signs `${unixSeconds}.${method}.${pathname}.${body}` with the shared
 * internal secret. The body is the exact bytes received by the route. A
 * timestamp window prevents replay while the constant-time comparison avoids
 * leaking the secret through signature timing.
 */
export function verifyInternalOpsSignature(input: {
  method: string;
  pathname: string;
  body?: string;
  timestamp: string | null;
  signature: string | null;
  secret?: string | null;
  nowSeconds?: number;
}): InternalOpsAuthResult {
  const secret = input.secret?.trim() || process.env.BLOCKWISE_INTERNAL_AUTH_SECRET?.trim();
  const timestamp = Number(input.timestamp);
  if (!secret || !input.timestamp || !input.signature || !Number.isInteger(timestamp)) {
    return { ok: false, error: "missing" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > INTERNAL_OPS_MAX_SKEW_SECONDS) {
    return { ok: false, error: "expired" };
  }
  const canonical = `${timestamp}.${input.method.toUpperCase()}.${input.pathname}.${input.body ?? ""}`;
  const expected = createHmac("sha256", secret).update(canonical, "utf8").digest();
  const provided = decodeSignature(input.signature);
  return provided && provided.length === expected.length && timingSafeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, error: "invalid" };
}

export function signInternalOpsRequest(input: {
  method: string;
  pathname: string;
  body?: string;
  secret: string;
  timestamp?: number;
}): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  return createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.method.toUpperCase()}.${input.pathname}.${input.body ?? ""}`, "utf8")
    .digest("hex");
}

function decodeSignature(value: string): Buffer | null {
  const trimmed = value.trim().replace(/^sha256=/i, "");
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (/^[A-Za-z0-9_-]{43,86}$/.test(trimmed)) {
    try { return Buffer.from(trimmed, "base64url"); } catch { return null; }
  }
  return null;
}
