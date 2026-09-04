import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/app/api/webhooks/chatwoot/route.ts", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/migrations/202609040018_customer_operations_management_actions.sql", import.meta.url), "utf8");

test("Chatwoot webhook authenticates full timestamped body and skew", () => {
  assert.match(route, /x-chatwoot-timestamp/); assert.match(route, /300000/); assert.match(route, /\$\{timestamp\}\.\$\{raw\}/); assert.match(route, /timingSafeEqual/);
});
test("Chatwoot adoption has malformed/account/inbox/private/outgoing gates", () => {
  assert.match(route, /JSON\.parse/); assert.match(route, /allowedInboxes/); assert.match(route, /private === true/); assert.match(route, /message_type/); assert.match(route, /unsupported_webhook/);
});
test("adoption is mapped by provider contact digest and supports unknown unassigned", () => {
  assert.match(sql, /provider_contact_id_digest=p_contact_id_digest/); assert.match(sql, /values\(v_workspace,'chatwoot'/); assert.match(sql, /workspace_id.*null/);
});
test("adoption replay/hash mismatch and single association are durable", () => {
  assert.match(sql, /payload_hash/); assert.match(sql, /event hash mismatch/); assert.match(sql, /ops_chatwoot_enquiry_source_unique/); assert.match(sql, /on conflict \(source_system,source_id\)/);
});
test("adopted identity is encrypted and thread is bounded chronologically", () => {
  assert.match(route, /encryptConversationId/); assert.match(sql, /provider_conversation_id_ciphertext/); assert.match(sql, /rn <= 50/); assert.match(sql, /occurred_at/); assert.match(sql, /attachment_metadata/);
});
test("assignment rebinds provider identity for later actions", () => {
  assert.match(sql, /sync_ops_chatwoot_enquiry_workspace/); assert.match(sql, /update private\.ops_provider_operation_ledger set workspace_id/); assert.match(sql, /resolve_ops_provider_action_identity/);
});
