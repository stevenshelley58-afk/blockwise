import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  resolveAlertEmailRecipient,
  sendAlertEmail,
  sendAlertWhatsApp,
} from "../src/lib/alerts/notify.ts";

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

test("fallback WhatsApp delivery has a hard timeout off the render critical path", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM,
    ALERT_WHATSAPP_TO: process.env.ALERT_WHATSAPP_TO,
  };
  let signal: AbortSignal | null | undefined;
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_WHATSAPP_FROM = "+15550000001";
  process.env.ALERT_WHATSAPP_TO = "+61400000000";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    signal = init?.signal;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await sendAlertWhatsApp({ subject: "fallback", text: "fallback" }), true);
    assert.ok(signal, "Twilio fetch must carry an abort signal");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
