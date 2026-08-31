import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAuditLog } from "./supabase/audit.ts";

/**
 * Authentication for internal machine-to-machine APIs (Frank -> Blockwise).
 *
 * Callers send an HMAC-SHA256 signature over a canonical request payload plus
 * a timestamp and single-use nonce:
 *
 *   x-blockwise-timestamp: unix seconds
 *   x-blockwise-nonce:     random unique value per request
 *   x-blockwise-scope:     requested scope (must match the route's scope)
 *   x-blockwise-signature: hex HMAC-SHA256(secret, canonical payload)
 *
 * Canonical payload (newline-separated):
 *   v1 | timestamp | nonce | scope | METHOD | path?query | sha256(body)
 *
 * The secret lives in BLOCKWISE_INTERNAL_SECRET. When it is unset every
 * request is rejected (fail-closed) — there is no fallback shared value.
 */

export const INTERNAL_AUTH_TIMESTAMP_HEADER = "x-blockwise-timestamp";
export const INTERNAL_AUTH_NONCE_HEADER = "x-blockwise-nonce";
export const INTERNAL_AUTH_SCOPE_HEADER = "x-blockwise-scope";
export const INTERNAL_AUTH_SIGNATURE_HEADER = "x-blockwise-signature";

/** Maximum allowed clock skew between caller and server, in seconds. */
export const INTERNAL_AUTH_MAX_CLOCK_SKEW_SECONDS = 300;

/** Nonces are kept only as long as the replay window they protect. */
const NONCE_TTL_SECONDS = INTERNAL_AUTH_MAX_CLOCK_SKEW_SECONDS * 2;

export type InternalAuthFailure = { ok: false; status: number; error: string };
export type InternalAuthSuccess = { ok: true; scope: string };
export type InternalAuthResult = InternalAuthSuccess | InternalAuthFailure;

export type InternalAuthOptions = {
  /** Override the secret (tests). Defaults to BLOCKWISE_INTERNAL_SECRET. */
  secret?: string | null;
  /** Override the clock (tests). */
  now?: () => Date;
  /** Override the service client (tests). Defaults to createSupabaseServiceClient(). */
  supabase?: SupabaseClient;
  /** Raw request body ("" for GET). Required for POST/PUT verification. */
  body?: string;
  /** Disable the audit receipt (tests). */
  audit?: boolean;
};

type NonceStore = {
  deleteExpired: (cutoffIso: string) => Promise<void>;
  insertIfFresh: (nonce: string, expiresAtIso: string) => Promise<boolean>;
};

export function buildInternalSigningPayload(parts: {
  timestamp: string;
  nonce: string;
  scope: string;
  method: string;
  path: string;
  bodyHash: string;
}): string {
  return ["v1", parts.timestamp, parts.nonce, parts.scope, parts.method.toUpperCase(), parts.path, parts.bodyHash].join("\n");
}

export function hashInternalBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function defaultNonceStore(supabase: SupabaseClient): NonceStore {
  return {
    deleteExpired: async (cutoffIso) => {
      await supabase.from("internal_request_nonces").delete().lt("expires_at", cutoffIso);
    },
    insertIfFresh: async (nonce, expiresAtIso) => {
      // Single INSERT ... ON CONFLICT DO NOTHING RETURNING statement: an empty
      // result means the nonce was already seen (replay).
      const { data } = await supabase
        .from("internal_request_nonces")
        .upsert({ nonce, expires_at: expiresAtIso }, { onConflict: "nonce", ignoreDuplicates: true })
        .select("nonce");
      return Array.isArray(data) && data.length > 0;
    },
  };
}

export async function verifyInternalRequest(
  request: Request,
  expectedScope: string,
  options: InternalAuthOptions = {},
): Promise<InternalAuthResult> {
  const secret = (options.secret ?? process.env.BLOCKWISE_INTERNAL_SECRET)?.trim() ?? "";
  if (!secret) {
    return { ok: false, status: 503, error: "internal_auth_not_configured" };
  }

  const timestamp = request.headers.get(INTERNAL_AUTH_TIMESTAMP_HEADER)?.trim() ?? "";
  const nonce = request.headers.get(INTERNAL_AUTH_NONCE_HEADER)?.trim() ?? "";
  const scope = request.headers.get(INTERNAL_AUTH_SCOPE_HEADER)?.trim() ?? "";
  const signature = request.headers.get(INTERNAL_AUTH_SIGNATURE_HEADER)?.trim() ?? "";
  if (!timestamp || !nonce || !scope || !signature) {
    return { ok: false, status: 401, error: "missing_internal_auth_headers" };
  }

  const now = options.now?.() ?? new Date();
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, status: 401, error: "invalid_timestamp" };
  }
  const skewSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds);
  if (skewSeconds > INTERNAL_AUTH_MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 401, error: "stale_timestamp" };
  }

  if (scope !== expectedScope) {
    return { ok: false, status: 403, error: "scope_mismatch" };
  }

  const url = new URL(request.url);
  const body = options.body ?? "";
  const payload = buildInternalSigningPayload({
    timestamp,
    nonce,
    scope,
    method: request.method,
    path: `${url.pathname}${url.search}`,
    bodyHash: hashInternalBody(body),
  });
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("hex");
  if (!safeEqual(expectedSignature, signature)) {
    return { ok: false, status: 401, error: "invalid_signature" };
  }

  // Replay protection: the nonce must not have been accepted before. Only
  // reached after the signature verified, so unauthenticated callers cannot
  // spend database writes on us.
  const supabase = options.supabase ?? (await import("./supabase/service.ts")).createSupabaseServiceClient();
  const store = defaultNonceStore(supabase);
  const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
  try {
    await store.deleteExpired(new Date(now.getTime() - NONCE_TTL_SECONDS * 1000).toISOString());
    const fresh = await store.insertIfFresh(nonce, expiresAt.toISOString());
    if (!fresh) {
      return { ok: false, status: 401, error: "replayed_nonce" };
    }
  } catch (error) {
    console.error("[internal-auth] nonce check failed", error instanceof Error ? error.message : error);
    return { ok: false, status: 503, error: "internal_auth_unavailable" };
  }

  if (options.audit !== false) {
    await recordAuditLog(supabase, {
      workspaceId: null,
      actorProfileId: null,
      action: "internal.api.request",
      targetType: "internal_api",
      targetId: null,
      correlationId: nonce,
      metadata: { scope: expectedScope, method: request.method, path: url.pathname },
    });
  }

  return { ok: true, scope };
}
