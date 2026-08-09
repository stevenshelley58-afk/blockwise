import assert from "node:assert/strict";
import test from "node:test";

import { generationLockCanBeReclaimed } from "../src/lib/adstudio/generation-lock.ts";

const base = {
  createdAtMs: 0,
  nowMs: 60 * 60_000,
  unboundTtlMs: 15 * 60_000,
  ownerLookupFailed: false,
};

test("an active job-owned generation lock never expires by wall-clock age", () => {
  for (const ownerStatus of ["queued", "running"] as const) {
    assert.equal(generationLockCanBeReclaimed({
      ...base,
      ownerJobId: "job-1",
      ownerStatus,
    }), false);
  }
});

test("job-owned locks fail closed on lookup errors and reclaim only terminal ownership", () => {
  assert.equal(generationLockCanBeReclaimed({
    ...base,
    ownerJobId: "job-1",
    ownerStatus: null,
    ownerLookupFailed: true,
  }), false);
  for (const ownerStatus of ["done", "failed", null] as const) {
    assert.equal(generationLockCanBeReclaimed({
      ...base,
      ownerJobId: "job-1",
      ownerStatus,
    }), true);
  }
});

test("only an unbound setup lock uses the short stale timeout", () => {
  assert.equal(generationLockCanBeReclaimed({
    ...base,
    ownerJobId: null,
    ownerStatus: null,
    nowMs: 14 * 60_000,
  }), false);
  assert.equal(generationLockCanBeReclaimed({
    ...base,
    ownerJobId: null,
    ownerStatus: null,
    nowMs: 15 * 60_000,
  }), true);
});
