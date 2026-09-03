import assert from "node:assert/strict";
import test from "node:test";

import { redactValue } from "../src/lib/redact.ts";

test("client Sentry event redaction removes user PII and sensitive URL query values", () => {
  const out = redactValue({
    user: { email: "person@example.com", username: "person", ip_address: "203.0.113.9", id: "u-1" },
    request: { url: "https://blockwise.sale/results?email=person@example.com&tab=overview" },
  }) as any;
  assert.equal(out.user.email, "[redacted]");
  assert.equal(out.user.username, "[redacted]");
  assert.equal(out.user.ip_address, "[redacted]");
  assert.equal(out.user.id, "u-1");
  assert.equal(out.request.url, "[redacted url]");
});
