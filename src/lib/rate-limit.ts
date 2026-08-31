import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitConfig = {
  /** Length of the fixed window in seconds. */
  windowSeconds: number;
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Logical name for the bucket (e.g. "ads-search", "ai-generate", "demo-request"). */
  bucket: string;
  /**
   * When true, a database error rejects the request instead of allowing it.
   * Set this for auth-critical and internal endpoints; leave unset for
   * best-effort limits where availability matters more than the cap.
   */
  failClosed?: boolean;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter backed by the public.consume_rate_limit RPC.
 *
 * The RPC increments and checks in a single SQL statement
 * (INSERT ... ON CONFLICT DO UPDATE ... WHERE), so parallel requests cannot
 * overshoot the limit — there is no read-then-write race. See
 * supabase/migrations/20260901010000_atomic_rate_limit_rpc.sql.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  workspaceId: string | null,
  subjectKey: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_workspace_id: workspaceId,
    p_subject_key: subjectKey,
    p_bucket: config.bucket,
    p_limit_count: config.maxRequests,
    p_window_seconds: config.windowSeconds,
  });

  if (error) {
    console.error(`[rate-limit] consume_rate_limit failed for bucket ${config.bucket}`, error.message);
    return config.failClosed
      ? { ok: false, retryAfterSeconds: config.windowSeconds }
      : { ok: true };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") {
    // The RPC always returns exactly one row; anything else is unexpected.
    console.error(`[rate-limit] unexpected consume_rate_limit response for bucket ${config.bucket}`);
    return config.failClosed
      ? { ok: false, retryAfterSeconds: config.windowSeconds }
      : { ok: true };
  }

  return row.allowed
    ? { ok: true }
    : { ok: false, retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || config.windowSeconds) };
}
