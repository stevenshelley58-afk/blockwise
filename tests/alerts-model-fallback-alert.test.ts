import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelFallbackAlert,
  dedupeKeyForFallback,
  emitModelFallbackAlert,
  resetModelFallbackAlertDedupe,
} from "../src/lib/alerts/model-fallback-alert.ts";

test("buildModelFallbackAlert names the stage, both models, and the reason", () => {
  const message = buildModelFallbackAlert({
    stage: "adstudio.copy",
    fromModel: "gpt-5.5",
    toModel: "openai/gpt-5.5",
    reason: "429 rate limited",
  });

  assert.match(message.subject, /model fallback/i);
  assert.match(message.subject, /adstudio\.copy/);
  assert.match(message.subject, /gpt-5\.5 → openai\/gpt-5\.5/);
  assert.match(message.text, /Primary model failed: gpt-5\.5/);
  assert.match(message.text, /Now serving with: openai\/gpt-5\.5/);
  assert.match(message.text, /Reason: 429 rate limited/);
});

test("buildModelFallbackAlert truncates an overlong reason", () => {
  const message = buildModelFallbackAlert({
    stage: "adstudio.image",
    fromModel: "a",
    toModel: "b",
    reason: "x".repeat(500),
  });
  const reasonLine = message.text.split("\n").find((line) => line.startsWith("Reason: "));
  assert.ok(reasonLine && reasonLine.length < 320, "reason line should be truncated");
  assert.match(message.text, /…/);
});

test("dedupeKeyForFallback keys on stage + target model", () => {
  assert.equal(
    dedupeKeyForFallback({ stage: "adstudio.copy", toModel: "env_default" }),
    "adstudio.copy::env_default",
  );
});

test("emitModelFallbackAlert sends once and then de-dupes within the window", async () => {
  resetModelFallbackAlertDedupe();
  const sent: string[] = [];
  const send = async (message: { subject: string }) => {
    sent.push(message.subject);
    return { email: true, whatsapp: false };
  };

  const event = { stage: "adstudio.copy", fromModel: "gpt-5.5", toModel: "env_default", reason: "boom" };
  let clock = 1_000;
  const now = () => clock;

  const first = await emitModelFallbackAlert(event, { send, now, dedupeWindowMs: 60_000 });
  assert.equal(first.sent, true);
  assert.equal(first.deduped, false);
  assert.deepEqual(first.delivery, { email: true, whatsapp: false });

  clock = 30_000; // still inside the 60s window
  const second = await emitModelFallbackAlert(event, { send, now, dedupeWindowMs: 60_000 });
  assert.equal(second.sent, false);
  assert.equal(second.deduped, true);

  clock = 100_000; // window elapsed
  const third = await emitModelFallbackAlert(event, { send, now, dedupeWindowMs: 60_000 });
  assert.equal(third.sent, true);

  assert.equal(sent.length, 2, "second call within the window must not send");
});

test("emitModelFallbackAlert de-dupes per (stage,toModel) — different targets still alert", async () => {
  resetModelFallbackAlertDedupe();
  const sent: string[] = [];
  const send = async (message: { subject: string }) => {
    sent.push(message.subject);
    return { email: true, whatsapp: true };
  };
  const now = () => 5_000;

  await emitModelFallbackAlert({ stage: "adstudio.copy", fromModel: "p", toModel: "a", reason: "x" }, { send, now });
  await emitModelFallbackAlert({ stage: "adstudio.copy", fromModel: "p", toModel: "b", reason: "x" }, { send, now });
  assert.equal(sent.length, 2);
});

test("emitModelFallbackAlert never throws when delivery fails", async () => {
  resetModelFallbackAlertDedupe();
  const result = await emitModelFallbackAlert(
    { stage: "adstudio.copy", fromModel: "p", toModel: "q", reason: "x" },
    {
      send: async () => {
        throw new Error("resend down");
      },
      now: () => 1,
    },
  );
  assert.equal(result.sent, false);
  assert.equal(result.error, "resend down");
});
