import assert from "node:assert/strict";
import test from "node:test";

import { checkRateLimit, type RateLimitConfig } from "../src/lib/rate-limit.ts";

// ---------------------------------------------------------------------------
// Minimal Supabase mock helpers
// ---------------------------------------------------------------------------

type RateLimitRow = {
  id: string;
  used_count: number;
  limit_count: number;
  resets_at: string;
};

/**
 * Build a mock Supabase client whose `from("rate_limits")` behaviour is driven
 * by the supplied row (or null for "no existing record").
 *
 * The Supabase query builder is fluent: every filter method returns a new
 * builder. We model this with a plain Proxy that always returns itself for
 * any property access, except for the terminal `maybeSingle` and `insert`/
 * `update` methods which we handle explicitly.
 */
function makeSupabase(opts: {
  existing: RateLimitRow | null;
  insertShouldError?: boolean;
  raceRow?: { used_count: number; limit_count: number; resets_at: string } | null;
  onUpdate?: (id: string, count: number) => void;
  onInsert?: (row: Record<string, unknown>) => void;
}) {
  let selectCallCount = 0;

  // Creates a fluent chain proxy. Every method except the terminals returns
  // the same proxy so callers can chain arbitrarily.
  function makeChain(): Record<string, unknown> {
    let pendingUpdateVal: Record<string, unknown> | null = null;

    const chain: Record<string, (...args: unknown[]) => unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      // update() stores the patch and returns a new chain for .eq()
      update: (val: unknown) => {
        pendingUpdateVal = val as Record<string, unknown>;
        return {
          eq: (_col: string, id: string) => {
            opts.onUpdate?.(id, (pendingUpdateVal as { used_count: number }).used_count);
            return Promise.resolve({ error: null });
          },
        };
      },
      // insert() is terminal — returns a promise directly
      insert: (row: unknown) => {
        opts.onInsert?.(row as Record<string, unknown>);
        if (opts.insertShouldError) {
          return Promise.resolve({ error: { message: "unique violation" } });
        }
        return Promise.resolve({ error: null });
      },
      // maybeSingle() is terminal — returns the appropriate row
      maybeSingle: () => {
        selectCallCount += 1;
        if (selectCallCount === 1) {
          return Promise.resolve({ data: opts.existing, error: null });
        }
        // Second call = race re-read after failed insert
        return Promise.resolve({ data: opts.raceRow ?? null, error: null });
      },
    };
    return chain as unknown as Record<string, unknown>;
  }

  return {
    from: (_table: string) => makeChain(),
  } as unknown as Parameters<typeof checkRateLimit>[0];
}

const config: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 3,
  bucket: "test-bucket",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("first request (no existing record) returns ok: true and inserts", async () => {
  let inserted: Record<string, unknown> | null = null;
  const supabase = makeSupabase({
    existing: null,
    onInsert: (row) => {
      inserted = row;
    },
  });

  const result = await checkRateLimit(supabase, "ws-1", "user-1", config);

  assert.equal(result.ok, true);
  assert.ok(inserted, "expected an insert to be called");
  assert.equal((inserted as Record<string, unknown>).used_count, 1);
  assert.equal((inserted as Record<string, unknown>).bucket, "test-bucket");
});

test("request within limit increments used_count and returns ok: true", async () => {
  const futureResets = new Date(Date.now() + 55_000).toISOString();
  let updatedCount: number | null = null;
  const existing: RateLimitRow = {
    id: "row-1",
    used_count: 2,
    limit_count: 3,
    resets_at: futureResets,
  };
  const supabase = makeSupabase({
    existing,
    onUpdate: (_id, count) => {
      updatedCount = count;
    },
  });

  const result = await checkRateLimit(supabase, "ws-1", "user-1", config);

  assert.equal(result.ok, true);
  assert.equal(updatedCount, 3, "used_count should be incremented to 3");
});

test("request at the limit returns ok: false with positive retryAfterSeconds", async () => {
  const futureResets = new Date(Date.now() + 30_000).toISOString();
  const existing: RateLimitRow = {
    id: "row-2",
    used_count: 3,
    limit_count: 3,
    resets_at: futureResets,
  };
  const supabase = makeSupabase({ existing });

  const result = await checkRateLimit(supabase, "ws-1", "user-1", config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.retryAfterSeconds > 0, "retryAfterSeconds should be positive");
    assert.ok(result.retryAfterSeconds <= 30, "retryAfterSeconds should not exceed window remainder");
  }
});

test("insert race: returns ok: true when race row is still within limit", async () => {
  const futureResets = new Date(Date.now() + 55_000).toISOString();
  const supabase = makeSupabase({
    existing: null,
    insertShouldError: true,
    raceRow: { used_count: 2, limit_count: 3, resets_at: futureResets },
  });

  const result = await checkRateLimit(supabase, "ws-1", "user-2", config);

  assert.equal(result.ok, true);
});

test("insert race: returns ok: false when race row is at the limit", async () => {
  const futureResets = new Date(Date.now() + 40_000).toISOString();
  const supabase = makeSupabase({
    existing: null,
    insertShouldError: true,
    raceRow: { used_count: 3, limit_count: 3, resets_at: futureResets },
  });

  const result = await checkRateLimit(supabase, "ws-1", "user-3", config);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.retryAfterSeconds >= 1);
  }
});

test("null workspaceId (IP-keyed) inserts without workspace_id", async () => {
  let inserted: Record<string, unknown> | null = null;
  const supabase = makeSupabase({
    existing: null,
    onInsert: (row) => {
      inserted = row;
    },
  });

  const result = await checkRateLimit(supabase, null, "1.2.3.4", {
    ...config,
    bucket: "demo-request",
  });

  assert.equal(result.ok, true);
  assert.ok(inserted, "expected an insert");
  assert.equal("workspace_id" in (inserted as Record<string, unknown>), false, "workspace_id should not be set");
});
