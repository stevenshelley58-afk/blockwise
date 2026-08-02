import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveAlertEmailRecipient, sendAlertEmail } from "../src/lib/alerts/notify.ts";

test("resolveAlertEmailRecipient prefers explicit env over the owner default", () => {
  assert.equal(
    resolveAlertEmailRecipient({ ALERT_EMAIL_TO: "ops@blockwise.test" }),
    "ops@blockwise.test",
  );
  assert.equal(
    resolveAlertEmailRecipient({ DEMO_NOTIFY_TO: "demo@blockwise.test" }),
    "demo@blockwise.test",
  );
  assert.equal(
    resolveAlertEmailRecipient({ BLOCKWISE_OWNER_ALERT_EMAIL: "owner@blockwise.test" }),
    "owner@blockwise.test",
  );
});

test("resolveAlertEmailRecipient falls back to the owner inbox when nothing is set", () => {
  const recipient = resolveAlertEmailRecipient({});
  assert.match(recipient, /@/);
  assert.equal(recipient, "stevenshelley58@gmail.com");
});

test("copy-generation wires the model-fallback alert at the cascade fallback point", () => {
  const source = readFileSync("src/lib/adstudio/copy-generation.ts", "utf8");
  assert.match(source, /import \{ emitModelFallbackAlert \} from "\.\.\/alerts\/model-fallback-alert\.ts"/);
  assert.match(source, /emitModelFallbackAlert\(\{[\s\S]*stage: "adstudio\.copy"/);
  assert.match(source, /fromModel: candidate\.model/);
});

test("fallback emails carry a Resend idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ALERT_EMAIL_FROM: process.env.ALERT_EMAIL_FROM,
  };
  let headers: HeadersInit | undefined;
  process.env.RESEND_API_KEY = "re_test";
  process.env.ALERT_EMAIL_FROM = "Blockwise <alerts@blockwise.test>";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    headers = init?.headers;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await sendAlertEmail({
      subject: "fallback",
      text: "fallback",
      idempotencyKey: "model-fallback/run-1",
    }), true);
    assert.equal(new Headers(headers).get("Idempotency-Key"), "model-fallback/run-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (original.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original.RESEND_API_KEY;
    if (original.ALERT_EMAIL_FROM === undefined) delete process.env.ALERT_EMAIL_FROM;
    else process.env.ALERT_EMAIL_FROM = original.ALERT_EMAIL_FROM;
  }
});
