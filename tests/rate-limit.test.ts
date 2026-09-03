import assert from "node:assert/strict";
import test from "node:test";

import { checkRateLimit, type RateLimitConfig } from "../src/lib/rate-limit.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type RpcResponse = { data: unknown; error: { message: string } | null };

/**
 * Mock Supabase client whose rpc() is driven by the supplied responder.
 * The limiter is a single-statement RPC call, so the mock only needs to model
 * one atomic consume_rate_limit round-trip. It stands in for the SERVICE-ROLE
 * client, which is what checkRateLimit uses in production.
 */
function makeServiceClient(respond: () => RpcResponse) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        assert.equal(fn, "consume_rate_limit");
        calls.push(args);
        return Promise.resolve(respond());
      },
    } as unknown as Parameters<typeof checkRateLimit>[3],
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
  const { client, calls } = makeServiceClient(() => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));

  const result = await checkRateLimit("ws-1", "user-1", config, client);

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
  const { client } = makeServiceClient(() => ({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null }));

  const result = await checkRateLimit("ws-1", "user-1", config, client);

  assert.deepEqual(result, { ok: false, retryAfterSeconds: 42 });
});

test("null workspaceId (IP-keyed) passes null through to the RPC", async () => {
  const { client, calls } = makeServiceClient(() => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));

  const result = await checkRateLimit(null, "1.2.3.4", { ...config, bucket: "demo-request" }, client);

  assert.equal(result.ok, true);
  assert.equal(calls[0].p_workspace_id, null);
});
test("subject keys are trimmed before the RPC call", async () => {
  const { client, calls } = makeServiceClient(() => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));

  await checkRateLimit(null, " 1.2.3.4 ", { ...config, bucket: "demo-request" }, client);

  assert.equal(calls[0].p_subject_key, "1.2.3.4");
});


// ---------------------------------------------------------------------------
// Fail-closed defaults (review blocker 2: no fail-open on DB errors)
// ---------------------------------------------------------------------------

test("database error FAILS CLOSED by default", async () => {
  const { client } = makeServiceClient(() => ({ data: null, error: { message: "connection refused" } }));

  const result = await checkRateLimit("ws-1", "user-1", config, client);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterSeconds, config.windowSeconds);
});

test("database error fails open only when failClosed is explicitly false", async () => {
  const { client } = makeServiceClient(() => ({ data: null, error: { message: "connection refused" } }));

  const result = await checkRateLimit("ws-1", "user-1", { ...config, failClosed: false }, client);

  assert.equal(result.ok, true);
});

test("empty/malformed RPC response FAILS CLOSED by default", async () => {
  const { client } = makeServiceClient(() => ({ data: [], error: null }));

  const result = await checkRateLimit("ws-1", "user-1", config, client);

  assert.equal(result.ok, false);
});

test("thrown RPC error FAILS CLOSED by default", async () => {
  const { client } = makeServiceClient(() => {
    throw new Error("network down");
  });

  const result = await checkRateLimit("ws-1", "user-1", config, client);

  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Hostile-caller input bounds (review blocker 2: validate and bound inputs)
// ---------------------------------------------------------------------------

test("invalid config values are rejected before any RPC call", async () => {
  const { client, calls } = makeServiceClient(() => ({ data: [{ allowed: true }], error: null }));

  await assert.rejects(
    () => checkRateLimit(null, "x", { ...config, maxRequests: 0 }, client),
    /invalid maxRequests/,
  );
  await assert.rejects(
    () => checkRateLimit(null, "x", { ...config, maxRequests: 1001 }, client),
    /invalid maxRequests/,
  );
  await assert.rejects(
    () => checkRateLimit(null, "x", { ...config, windowSeconds: 0 }, client),
    /invalid windowSeconds/,
  );
  await assert.rejects(
    () => checkRateLimit(null, "x", { ...config, windowSeconds: 86401 }, client),
    /invalid windowSeconds/,
  );
  await assert.rejects(
    () => checkRateLimit(null, "x", { ...config, bucket: "Bad Bucket!" }, client),
    /invalid bucket/,
  );
  assert.equal(calls.length, 0, "no RPC is invoked for invalid configs");
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
 * The Node harness has no live Postgres or second DB session, so this checks
 * wrapper dispatch under Promise.all. The pgTAP suite separately exercises
 * genuine cross-connection serialization with two dblink sessions.
 */
test("parallel requests cannot overshoot the limit", async () => {
  const maxRequests = 5;
  let usedCount = 0;
  const windowEnd = Date.now() + 60_000;

  const { client } = makeServiceClient(() => {
    if (usedCount >= maxRequests) {
      return { data: [{ allowed: false, retry_after_seconds: Math.max(1, Math.ceil((windowEnd - Date.now()) / 1000)) }], error: null };
    }
    usedCount += 1;
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  });

  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      checkRateLimit("ws-1", "user-1", { ...config, maxRequests }, client),
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

  const subjects = ["a", "b", "c"];
  const results = await Promise.all(
    subjects.flatMap((subject) => {
      const { client } = makeServiceClient(() => {
        const used = counters.get(subject) ?? 0;
        if (used >= maxRequests) {
          return { data: [{ allowed: false, retry_after_seconds: 30 }], error: null };
        }
        counters.set(subject, used + 1);
        return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
      });
      return Array.from({ length: 4 }, () =>
        checkRateLimit("ws-1", subject, { ...config, maxRequests }, client),
      );
    }),
  );

  assert.equal(results.filter((r) => r.ok).length, subjects.length * maxRequests);
});
