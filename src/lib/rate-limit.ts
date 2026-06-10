import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitConfig = {
  /** Length of the fixed window in seconds. */
  windowSeconds: number;
  /** Maximum number of requests allowed in the window. */
  maxRequests: number;
  /** Logical name for the bucket (e.g. "ads-search", "ai-generate", "demo-request"). */
  bucket: string;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter using the public.rate_limits table.
 *
 * The table schema:
 *   workspace_id uuid (nullable — null for unauthenticated/IP-keyed limits)
 *   subject_key  text  — the entity being rate-limited (userId, IP, …)
 *   bucket       text  — the action being limited
 *   limit_count  int   — max allowed in the window
 *   used_count   int   — how many have been used
 *   resets_at    timestamptz — when the window resets
 *   unique (workspace_id, subject_key, bucket)
 *
 * Upserts a new row on first request in a window, increments on subsequent
 * requests, and rejects once used_count reaches limit_count.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  workspaceId: string | null,
  subjectKey: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const windowStartSec = nowSec - (nowSec % config.windowSeconds);
  const resetsAt = new Date((windowStartSec + config.windowSeconds) * 1000);

  const { data: existing } = await selectRateLimitRow(supabase, workspaceId, subjectKey, config.bucket, now);

  if (existing) {
    if (existing.used_count >= existing.limit_count) {
      const resetMs = new Date(existing.resets_at).getTime();
      const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
      return { ok: false, retryAfterSeconds };
    }

    // Increment within the window.
    await supabase
      .from("rate_limits")
      .update({ used_count: existing.used_count + 1 })
      .eq("id", existing.id);

    return { ok: true };
  }

  // No active window — insert a new one.
  const insertRow: Record<string, unknown> = {
    subject_key: subjectKey,
    bucket: config.bucket,
    limit_count: config.maxRequests,
    used_count: 1,
    resets_at: resetsAt.toISOString(),
  };

  if (workspaceId !== null) {
    insertRow.workspace_id = workspaceId;
  }

  const { error: insertError } = await supabase.from("rate_limits").insert(insertRow);

  if (insertError) {
    // Likely a race — another request inserted first. Re-read and check.
    const { data: raceData } = await selectRateLimitRow(supabase, workspaceId, subjectKey, config.bucket, now);

    if (raceData && raceData.used_count >= raceData.limit_count) {
      const resetMs = new Date(raceData.resets_at).getTime();
      const retryAfterSeconds = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
      return { ok: false, retryAfterSeconds };
    }
  }

  return { ok: true };
}

async function selectRateLimitRow(
  supabase: SupabaseClient,
  workspaceId: string | null,
  subjectKey: string,
  bucket: string,
  now: Date,
): Promise<{ data: { id: string; used_count: number; limit_count: number; resets_at: string } | null }> {
  const base = supabase
    .from("rate_limits")
    .select("id, used_count, limit_count, resets_at")
    .eq("subject_key", subjectKey)
    .eq("bucket", bucket)
    .gte("resets_at", now.toISOString());

  const query =
    workspaceId !== null
      ? base.eq("workspace_id", workspaceId)
      : base.is("workspace_id", null);

  return query.maybeSingle() as unknown as Promise<{
    data: { id: string; used_count: number; limit_count: number; resets_at: string } | null;
  }>;
}
