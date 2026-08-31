import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getClientIp } from "../src/lib/client-ip.ts";
import { redactValue } from "../src/lib/redact.ts";

function headers(record: Record<string, string>): Headers {
  return new Headers(record);
}

describe("client ip derivation", () => {
  it("uses the right-most forwarded entry, which the trusted proxy vouches for", () => {
    // A spoofing client sends X-Forwarded-For: 1.2.3.4; Caddy appends the
    // real peer 9.9.9.9. The right-most entry must win.
    assert.equal(getClientIp(headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" })), "9.9.9.9");
  });

  it("handles single-entry and no-proxy cases", () => {
    assert.equal(getClientIp(headers({ "x-forwarded-for": "10.0.0.7" })), "10.0.0.7");
    assert.equal(getClientIp(headers({ "x-real-ip": "10.0.0.8" })), "10.0.0.8");
    assert.equal(getClientIp(headers({})), "unknown");
  });

  it("ignores garbage entries injected by clients", () => {
    assert.equal(getClientIp(headers({ "x-forwarded-for": "'; DROP TABLE x, 10.1.2.3" })), "10.1.2.3");
    assert.equal(getClientIp(headers({ "x-forwarded-for": "not-an-ip" })), "unknown");
  });

  it("handles ipv6 entries", () => {
    assert.equal(getClientIp(headers({ "x-forwarded-for": "2001:db8::1, ::1" })), "::1");
  });
});

describe("secret and PII redaction", () => {
  it("redacts sensitive keys in objects but keeps safe debug identifiers", () => {
    const out = redactValue({
      authorization: "Bearer super-secret-value",
      cookie: "session=abc",
      apiKey: "example-api-key-value",
      refresh_token: "r1",
      message: "rate limit exceeded",
      subject_key: "1.2.3.4",
      workspace_id: "w-1",
      nested: { password: "hunter2", code: "rate_limited" },
    }) as Record<string, any>;
    assert.equal(out.authorization, "[redacted]");
    assert.equal(out.cookie, "[redacted]");
    assert.equal(out.apiKey, "[redacted]");
    assert.equal(out.refresh_token, "[redacted]");
    assert.equal(out.message, "rate limit exceeded");
    assert.equal(out.subject_key, "1.2.3.4");
    assert.equal(out.workspace_id, "w-1");
    assert.deepEqual((out.nested as Record<string, unknown>).password, "[redacted]");
    assert.equal((out.nested as Record<string, unknown>).code, "rate_limited");
  });

  it("redacts bearer tokens and jwt strings inside free text", () => {
    const out = redactValue({
      message: "auth failed for Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.s3cr3tsignature",
    }) as { message: string };
    assert.ok(!out.message.includes("eyJ"));
    assert.ok(out.message.includes("[redacted]"));
  });

  it("redacts header-style secrets in error text", () => {
    const out = redactValue({
      message: 'request rejected: x-api-key: EXAMPLE-KEY-VALUE-123; authorization: Bearer xyz',
    }) as { message: string };
    assert.ok(!out.message.includes("EXAMPLE-KEY-VALUE-123"));
    assert.ok(out.message.includes("[redacted]"));
  });

  it("truncates email-body-like content", () => {
    const out = redactValue({
      error: "webhook payload preview: Dear John, thanks for signing up. Your card ending 4242 was charged.",
    }) as { error: string };
    assert.ok(!out.error.includes("Dear John, thanks for signing up"));
    assert.ok(out.error.includes("[redacted email body]"));
  });

  it("redacts Error objects and caps nesting depth", () => {
    const out = redactValue(new Error("boom Bearer abcdefghijklm")) as { message: string };
    assert.ok(!out.message.includes("abcdefghijklm"));

    const deep: Record<string, unknown> = { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } };
    const redacted = redactValue(deep) as Record<string, any>;
    assert.equal(redacted.a.b.c.d.e.f.g, "[truncated]");
  });

  it("never leaks raw webhook headers through nested event payloads", () => {
    const out = redactValue({
      event: "webhook_failed",
      headers: {
        "x-signature": "sha256=deadbeef",
        "set-cookie": "sb-access-token=secret",
        "content-type": "application/json",
      },
      body: { type: "booking.created", id: "evt_1" },
    }) as Record<string, any>;
    assert.equal(out.headers["x-signature"], "[redacted]");
    assert.equal(out.headers["set-cookie"], "[redacted]");
    assert.equal(out.headers["content-type"], "application/json");
    assert.deepEqual(out.body, { type: "booking.created", id: "evt_1" });
  });
});
