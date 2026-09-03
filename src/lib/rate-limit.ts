import { createSupabaseServiceClient } from "./supabase/service.ts";

export type RateLimitConfig = {
  /** Length of the fixed window in seconds (1..86400). */
  windowSeconds: number;
  /** Maximum number of requests allowed in the window (1..1000). */
  maxRequests: number;
  /** Logical name for the bucket (e.g. "ads-search", "ai-generate", "demo-request"). Must match ^[a-z0-9_-]{1,64}$. */
  bucket: string;
  /**
   * When true, a database error rejects the request instead of allowing it.
   * Defaults to true: the limiter exists to protect costly and abuse-sensitive
   * operations, so an unavailable limiter fails closed. Pass false only for
   * best-effort cosmetic limits.
   */
  failClosed?: boolean;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter backed by the public.consume_rate_limit RPC.
 *
 * Always executed through the SERVICE-ROLE client: the RPC is SECURITY
 * DEFINER but revoked from authenticated roles, so user-scoped clients can
 * neither call it directly nor choose arbitrary workspace ids, buckets or
 * limits to poison another subject's budget. The subject key must be derived
 * server-side (authenticated user id, or the trusted-proxy client IP) —
 * never from client-controlled input.
 *
 * The RPC increments and checks in a single statement
 * (INSERT ... ON CONFLICT DO UPDATE ... WHERE), so parallel requests cannot
 * overshoot the limit — there is no read-then-write race. See
 * supabase/migrations/20260901010000_atomic_rate_limit_rpc.sql.
 */
export async function checkRateLimit(
  workspaceId: string | null,
  subjectKey: string,
  config: RateLimitConfig,
  serviceSupabase?: ReturnType<typeof createSupabaseServiceClient>,
): Promise<RateLimitResult> {
  const failClosed = config.failClosed ?? true;
  const supabase = serviceSupabase ?? createSupabaseServiceClient();

  // Client-side bounds mirror the RPC's own validation so malformed configs
  // are caught in development instead of surfacing as 5xx at runtime.
  if (!Number.isInteger(config.maxRequests) || config.maxRequests < 1 || config.maxRequests > 1000) {
    throw new Error(`rate-limit: invalid maxRequests ${config.maxRequests} for bucket ${config.bucket}`);
  }
  if (!Number.isInteger(config.windowSeconds) || config.windowSeconds < 1 || config.windowSeconds > 86400) {
    throw new Error(`rate-limit: invalid windowSeconds ${config.windowSeconds} for bucket ${config.bucket}`);
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(config.bucket)) {
    throw new Error(`rate-limit: invalid bucket name ${config.bucket}`);
  }
  const normalizedSubjectKey = subjectKey.trim();

  let data: unknown;
  let errorMessage: string | null = null;
  try {
    const result = await supabase.rpc("consume_rate_limit", {
      p_workspace_id: workspaceId,
      p_subject_key: normalizedSubjectKey,
      p_bucket: config.bucket,
      p_limit_count: config.maxRequests,
      p_window_seconds: config.windowSeconds,
    });
    data = result.data;
    errorMessage = result.error?.message ?? null;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  if (errorMessage) {
    console.error(`[rate-limit] consume_rate_limit failed for bucket ${config.bucket}`, errorMessage);
    return failClosed
      ? { ok: false, retryAfterSeconds: config.windowSeconds }
      : { ok: true };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof (row as { allowed?: unknown }).allowed !== "boolean") {
    // The RPC always returns exactly one row; anything else is unexpected.
    console.error(`[rate-limit] unexpected consume_rate_limit response for bucket ${config.bucket}`);
    return failClosed
      ? { ok: false, retryAfterSeconds: config.windowSeconds }
      : { ok: true };
  }

  const allowed = (row as { allowed: boolean }).allowed;
  return allowed
    ? { ok: true }
    : { ok: false, retryAfterSeconds: Math.max(1, Number((row as { retry_after_seconds?: number }).retry_after_seconds) || config.windowSeconds) };
}
