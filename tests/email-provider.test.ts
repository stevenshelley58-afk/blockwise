import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { drainEmailOutbox } from "../src/lib/email/outbox.ts";
import { makeEmailProvider } from "../src/lib/email/provider.ts";

describe("email provider selection", () => {
  it("never defaults to Resend when EMAIL_PROVIDER is unset", () => {
    const provider = makeEmailProvider({} as unknown as NodeJS.ProcessEnv);
    assert.equal(provider.name, "unconfigured");
  });

  it("fails closed with a permanent error when unconfigured", async () => {
    const provider = makeEmailProvider({} as unknown as NodeJS.ProcessEnv);
    const result = await provider.send({
      messageType: "welcome",
      templateId: "welcome",
      templateVersion: 1,
      to: "customer@example.com",
      from: "hello@blockwise.sale",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      idempotencyKey: "k",
    });
    assert.equal(result.ok, false);
    assert.equal(result.permanent, true, "unconfigured provider must dead-letter, not retry forever");
  });

  it("rejects an unknown provider name instead of guessing", () => {
    assert.throws(() => makeEmailProvider({ EMAIL_PROVIDER: "mailflare" } as unknown as NodeJS.ProcessEnv));
  });

  it("fails the drain preflight for missing provider configuration", () => {
    const provider = makeEmailProvider({ EMAIL_PROVIDER: "smtp" } as unknown as NodeJS.ProcessEnv);
    assert.throws(() => provider.assertConfigured?.(), /SMTP_HOST/);
  });

  it("preflights configuration before claiming any row", async () => {
    let claimCalls = 0;
    const supabase = { rpc: async () => { claimCalls += 1; return { data: [], error: null }; } } as never;
    const provider = makeEmailProvider({ EMAIL_PROVIDER: "smtp" } as unknown as NodeJS.ProcessEnv);
    await assert.rejects(drainEmailOutbox(supabase, provider), /SMTP_HOST/);
    assert.equal(claimCalls, 0);
  });
  it("selects the smtp provider when configured", () => {
    const provider = makeEmailProvider({
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "stalwart.internal",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(provider.name, "smtp");
  });
});
