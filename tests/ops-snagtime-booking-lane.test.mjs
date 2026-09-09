import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const worker = readFileSync(new URL("../worker/ops-actions.ts", import.meta.url), "utf8");
const index = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202609040020_customer_operations_booking_actions.sql", import.meta.url), "utf8");

test("snagtime booking action lane follows SnagTime's exact private contract", () => {
  assert.match(worker, /blockwise\.ops\.action\.v1/);
  assert.match(worker, /ops:booking:\$\{action\.action_id\}/);
  assert.match(worker, /"v1", timestamp, nonce, scope, method,/);
  assert.match(worker, /x-blockwise-signature/);
  assert.match(worker, /x-blockwise-scope/);
  assert.match(worker, /\/api\/internal\/blockwise\/bookings\//);
  assert.match(worker, /STALE_BOOKING_VERSION/);
  assert.match(worker, /BLOCKWISE_BOOKING_ACTION_SECRET_FILE/);
  assert.match(worker, /calendarStatus/);
});

test("booking actions are claimed and capability-gated like enquiry actions", () => {
  assert.match(migration, /'booking_cancel','booking_reschedule'/);
  assert.match(migration, /set_ops_snagtime_capability/);
  assert.match(migration, /resolve_ops_booking_action_target/);
  assert.match(migration, /settle_ops_booking_provider_operation/);
  assert.match(migration, /provider in \('mautic','chatwoot','snagtime'\)/);
  assert.match(index, /checkSnagtimeActionReadiness/);
  assert.match(index, /set_ops_snagtime_capability/);
});
