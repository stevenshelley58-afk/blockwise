import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("demo seed replaces reporting snapshots before inserting fixed demo rows", () => {
  const sql = readFileSync("supabase/seed.sql", "utf8");
  const deleteIndex = sql.indexOf("delete from public.reporting_snapshots");
  const insertIndex = sql.indexOf("insert into public.reporting_snapshots");

  assert.ok(deleteIndex >= 0, "expected reporting snapshot cleanup");
  assert.ok(insertIndex > deleteIndex, "expected cleanup before reporting snapshot insert");
  assert.match(sql, /workspace_id = demo_workspace_id/i);
  assert.match(sql, /provider in \('meta', 'google'\)/i);
  assert.match(sql, /date_range = daterange\('2026-04-26', '2026-05-26', '\[\]'\)/i);
});
