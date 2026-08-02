import assert from "node:assert/strict";
import test from "node:test";

import { scanScheduledRowsById } from "../src/lib/providers/scheduled-maintenance.ts";

test("scheduled maintenance scans every stable ID page", async () => {
  const cursors: Array<string | null> = [];
  const handled: string[] = [];
  const scanned = await scanScheduledRowsById({
    pageSize: 2,
    fetchPage: async (afterId) => {
      cursors.push(afterId);
      if (afterId === null) return { data: [{ id: "a" }, { id: "b" }], error: null };
      if (afterId === "b") return { data: [{ id: "c" }], error: null };
      return { data: [], error: null };
    },
    handlePage: async (rows) => {
      handled.push(...rows.map((row) => row.id));
    },
  });

  assert.equal(scanned, 3);
  assert.deepEqual(cursors, [null, "b"]);
  assert.deepEqual(handled, ["a", "b", "c"]);
});

test("scheduled maintenance rejects a cursor that cannot advance", async () => {
  await assert.rejects(() => scanScheduledRowsById({
    pageSize: 1,
    fetchPage: async () => ({ data: [{ id: "same" }], error: null }),
    handlePage: async () => {},
  }), /cursor did not advance/);
});
