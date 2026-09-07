import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { verifiedResendSuppressions } from "../src/lib/email/resend-webhook.ts";
const key = Buffer.from("local-webhook-test-key-not-a-secret");
const secret = "whsec_" + key.toString("base64");
function fixture(type = "email.bounced", from = "Blockwise <hello@blockwise.sale>", timestamp = Math.floor(Date.now() / 1000).toString()) {
  const payload = JSON.stringify({ type, data: { from, to: ["BOUNCED+launch@resend.dev"], email_id: "test-email" } });
  const id = "msg_test";
  const signature = "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return { payload, headers: { id, timestamp, signature } };
}
test("verified native Resend bounce becomes an idempotent suppression", () => {
  const f = fixture();
  assert.deepEqual(verifiedResendSuppressions(f.payload, f.headers, secret), [{ email: "bounced+launch@resend.dev", reason: "bounce", source: "resend-webhook" }]);
});
test("complaints are suppressed but other provider events are ignored", () => {
  const f = fixture("email.complained");
  assert.equal(verifiedResendSuppressions(f.payload, f.headers, secret)[0].reason, "complaint");
  const delivered = fixture("email.delivered");
  assert.deepEqual(verifiedResendSuppressions(delivered.payload, delivered.headers, secret), []);
});
test("shared account events from another sending domain are ignored", () => {
  const f = fixture("email.bounced", "Other <mail@other.example>");
  assert.deepEqual(verifiedResendSuppressions(f.payload, f.headers, secret), []);
});
test("invalid signatures, tampered bytes and expired events are rejected", () => {
  const f = fixture();
  assert.throws(() => verifiedResendSuppressions(f.payload + " ", f.headers, secret));
  assert.throws(() => verifiedResendSuppressions(f.payload, { ...f.headers, signature: "v1,invalid" }, secret));
  const old = fixture("email.bounced", "hello@blockwise.sale", "1");
  assert.throws(() => verifiedResendSuppressions(old.payload, old.headers, secret));
});
