import assert from "node:assert/strict";
import test from "node:test";

import { checkRateLimit, type RateLimitConfig } from "../src/lib/rate-limit.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type RpcResponse = { data: unknown; error: { message: string } | null };

/**
 * Mock Supabase client whose rpc() is driven by the supplied responder.
 * The rewritten limiter is a single-statement RPC call, so the mock only
 * needs to model one atomic consume_rate_limit round-trip.
 */
function makeSupabase(respond: () => RpcResponse) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        assert.equal(fn, "consume_rate_limit");
        calls.push(args);
        return Promise.resolve(respond());
      },
    } as unknown as Parameters<typeof checkRateLimit>[0],
    calls,
  };
}

const config: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 3,
  bucket: "test-bucket",
};

// ---------------------------------------------------------------------------
// Single-request behaviour
// ---------------------------------------------------------------------------

test("allowed response returns ok: true and passes the right parameters", async () => {
  const { client, calls } = makeSupabase(() => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));

  const result = await checkRateLimit(client, "ws-1", "user-1", config);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    p_workspace_id: "ws-1",
    p_subject_key: "user-1",
    p_bucket: "test-bucket",
    p_limit_count: 3,
    p_window_seconds: 60,
  });
});

test("exhausted response returns ok: false with the RPC retry hint", async () => {
  const { client } = makeSupabase(() => ({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null }));

  const result = await checkRateLimit(client, "ws-1", "user-1", config);

  assert.deepEqual(result, { ok: false, retryAfterSeconds: 42 });
});

test("null workspaceId (IP-keyed) passes null through to the RPC", async () => {
  const { client, calls } = makeSupabase(() => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));

  const result = await checkRateLimit(client, null, "1.2.3.4", { ...config, bucket: "demo-request" });

  assert.equal(result.ok, true);
  assert.equal(calls[0].p_workspace_id, null);
});

test("database error fails open by default", async () => {
  const { client } = makeSupabase(() => ({ data: null, error: { message: "connection refused" } }));

  const result = await checkRateLimit(client, "ws-1", "user-1", config);

  assert.equal(result.ok, true);
});

test("database error fails closed when failClosed is set", async () => {
  const { client } = makeSupabase(() => ({ data: null, error: { message: "connection refused" } }));

  const result = await checkRateLimit(client, "ws-1", "user-1", { ...config, failClosed: true });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterSeconds, config.windowSeconds);
});

test("malformed RPC response fails closed when failClosed is set", async () => {
  const { client } = makeSupabase(() => ({ data: [], error: null }));

  const result = await checkRateLimit(client, "ws-1", "user-1", { ...config, failClosed: true });

  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Concurrency regression
// ---------------------------------------------------------------------------

/**
 * In-memory double of the consume_rate_limit SQL semantics: each call is one
 * synchronous increment-and-check (the single INSERT ... ON CONFLICT DO
 * UPDATE ... WHERE statement), so no interleaving can occur between the
 * increment and the check — exactly the guarantee the RPC provides.
 *
 * This test is the concurrency regression for the atomic path. It runs
 * against the mocked single-statement client because `npm run test:db`
 * (supabase db reset + test db) is not runnable in this environment (no
 * Supabase CLI/Docker); the SQL statement itself is exercised by
 * supabase/tests when a local database is available.
 */
test("parallel requests cannot overshoot the limit", async () => {
  const maxRequests = 5;
  let usedCount = 0;
  const windowEnd = Date.now() + 60_000;

  // Single-statement atomic double: increment-and-check with no await between
  // them, mirroring the RPC's one-statement guarantee.
  const { client } = makeSupabase(() => {
    if (usedCount >= maxRequests) {
      return { data: [{ allowed: false, retry_after_seconds: Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000)) }], error: null };
    }
    usedCount += 1;
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  });

  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      checkRateLimit(client, "ws-1", "user-1", { ...config, maxRequests }),
    ),
  );

  const allowed = results.filter((r) => r.ok).length;
  const rejected = results.filter((r) => !r.ok).length;
  assert.equal(allowed, maxRequests, "exactly maxRequests parallel requests may pass");
  assert.equal(rejected, 25 - maxRequests);
  assert.equal(usedCount, maxRequests, "the counter must never exceed the limit");
});

test("parallel requests across subjects are limited independently", async () => {
  const maxRequests = 2;
  const counters = new Map<string, number>();

  const makeSubjectClient = (subject: string) =>
    makeSupabase(() => {
      const used = counters.get(subject) ?? 0;
      if (used >= maxRequests) {
        return { data: [{ allowed: false, retry_after_seconds: 30 }], error: null };
      }
      counters.set(subject, used + 1);
      return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
    }).client;

  const subjects = ["a", "b", "c"];
  const results = await Promise.all(
    subjects.flatMap((subject) =>
      Array.from({ length: 4 }, () =>
        checkRateLimit(makeSubjectClient(subject), "ws-1", subject, { ...config, maxRequests }),
      ),
    ),
  );

  assert.equal(results.filter((r) => r.ok).length, subjects.length * maxRequests);
});
