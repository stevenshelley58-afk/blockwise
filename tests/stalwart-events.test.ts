import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  mapStalwartPermanentFailures,
  verifyStalwartSignature,
} from "../src/lib/email/stalwart-events.ts";

test("Stalwart signature verification authenticates exact raw bytes", () => {
  const raw = '{"events":[]}';
  const signature = createHmac("sha256", "webhook-secret").update(raw).digest("base64");
  assert.equal(verifyStalwartSignature(raw, signature, "webhook-secret"), true);
  assert.equal(verifyStalwartSignature(`${raw} `, signature, "webhook-secret"), false);
  assert.equal(verifyStalwartSignature(raw, signature, "wrong-secret"), false);
  assert.equal(verifyStalwartSignature(raw, null, "webhook-secret"), false);
});

test("Stalwart mapping accepts documented recipient forms and fails closed for malformed permanent events", () => {
  const mapping = mapStalwartPermanentFailures({
    events: [
      { type: "delivery.dsn-perm-fail", data: { to: "one@example.test", messageId: "q1" } },
      { type: "delivery.dsn-perm-fail", data: { to: ["two@example.test", "three@example.test"], messageId: "q2" } },
      { type: "delivery.dsn-perm-fail", data: { to: "not-an-address", messageId: "q3" } },
      { type: "delivery.dsn-temp-fail", data: { to: "temporary@example.test" } },
      { type: "complaint", data: { to: "complaint@example.test" } },
    ],
  });
  assert.deepEqual(mapping.events, [
    { email: "one@example.test", reason: "bounce", source: "stalwart" },
    { email: "two@example.test", reason: "bounce", source: "stalwart" },
    { email: "three@example.test", reason: "bounce", source: "stalwart" },
  ]);
  assert.equal(mapping.malformedPermanentFailures, 1);
  assert.equal(mapping.ignored, 2);
});
