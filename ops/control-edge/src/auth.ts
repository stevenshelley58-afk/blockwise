import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const AUTH_HEADERS = {
  timestamp: "x-blockwise-timestamp",
  nonce: "x-blockwise-nonce",
  scope: "x-blockwise-scope",
  signature: "x-blockwise-signature",
} as const;

export type NonceStore = { consume(nonce: string, expiresAt: Date): Promise<boolean> };
export type AuthResult = { ok: true; scope: string } | { ok: false; status: number; error: string };

export function signingPayload(timestamp: string, nonce: string, scope: string, method: string, path: string, body: string): string {
  return ["v1", timestamp, nonce, scope, method.toUpperCase(), path, createHash("sha256").update(body).digest("hex")].join("\n");
}

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8"); const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function authenticate(req: IncomingMessage, path: string, body: string, expectedScope: string, secret: string, nonceStore: NonceStore, now = new Date(), replayWindowSeconds = 300): Promise<AuthResult> {
  if (secret.length < 32) return { ok: false, status: 503, error: "internal_auth_not_configured" };
  const timestamp = req.headers[AUTH_HEADERS.timestamp]?.toString().trim() ?? "";
  const nonce = req.headers[AUTH_HEADERS.nonce]?.toString().trim() ?? "";
  const scope = req.headers[AUTH_HEADERS.scope]?.toString().trim() ?? "";
  const signature = req.headers[AUTH_HEADERS.signature]?.toString().trim() ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9._:-]{8,128}$/.test(nonce) || !scope || !/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, status: 401, error: "missing_or_invalid_internal_auth" };
  const timestampSeconds = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - timestampSeconds) > replayWindowSeconds) return { ok: false, status: 401, error: "stale_timestamp" };
  if (scope !== expectedScope) return { ok: false, status: 403, error: "scope_mismatch" };
  const expected = createHmac("sha256", secret).update(signingPayload(timestamp, nonce, scope, req.method ?? "GET", path, body)).digest("hex");
  if (!constantEqual(expected, signature)) return { ok: false, status: 401, error: "invalid_signature" };
  const fresh = await nonceStore.consume(nonce, new Date(now.getTime() + replayWindowSeconds * 2 * 1000));
  if (!fresh) return { ok: false, status: 401, error: "replayed_nonce" };
  return { ok: true, scope };
}

export function signRequest(secret: string, input: { timestamp: string; nonce: string; scope: string; method: string; path: string; body: string }): string {
  return createHmac("sha256", secret).update(signingPayload(input.timestamp, input.nonce, input.scope, input.method, input.path, input.body)).digest("hex");
}
