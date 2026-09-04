import assert from "node:assert/strict";
import test from "node:test";

import { createMetaExecutionLeaseHeartbeat } from "../src/lib/providers/meta-execution-lease-heartbeat.ts";

test("lease heartbeat renews independently of provider checkpoints", async () => {
  let renewals = 0;
  const heartbeat = createMetaExecutionLeaseHeartbeat({
    intervalMs: 5,
    renew: async () => { renewals += 1; return true; },
  });
  await new Promise((resolve) => setTimeout(resolve, 24));
  heartbeat.stop();
  assert.ok(renewals >= 2, `expected multiple timed renewals, received ${renewals}`);
  heartbeat.assertOwned();
});

test("lease loss aborts in-flight primary provider I/O", async () => {
  let renewals = 0;
  const fetchImpl: typeof fetch = async (_resource, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  const heartbeat = createMetaExecutionLeaseHeartbeat({
    intervalMs: 5,
    fetchImpl,
    renew: async () => { renewals += 1; return renewals === 1; },
  });
  await heartbeat.renewNow();
  const abortedFetch = assert.rejects(heartbeat.fetch("https://graph.facebook.test/provider"), /lease was lost/i);
  await assert.rejects(heartbeat.renewNow(), /lease was lost/i);
  await abortedFetch;
  assert.throws(() => heartbeat.assertOwned(), /lease was lost/i);
  heartbeat.stop();
});

test("stopping the heartbeat prevents later renewal", async () => {
  let renewals = 0;
  const heartbeat = createMetaExecutionLeaseHeartbeat({
    intervalMs: 5,
    renew: async () => { renewals += 1; return true; },
  });
  heartbeat.stop();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(renewals, 0);
});
