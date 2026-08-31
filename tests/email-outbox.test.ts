import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { drainEmailOutbox, enqueueEmail, isEmailSuppressed, recordEmailSuppression } from "../src/lib/email/outbox.ts";
import type { EmailProvider } from "../src/lib/email/provider.ts";
import type { EmailMessage } from "../src/lib/email/provider.ts";

type Row = Record<string, unknown>;

type OutboxTestDouble = {
  outbox: Row[];
  suppressions: string[];
  setClaimedBatch(rows: Row[]): void;
};

/** Minimal Supabase REST-shape double: table upsert/select/update + rpc. */
function makeSupabase(opts: {
  outboxRows?: Row[];
  suppressions?: string[];
} = {}): SupabaseClient & OutboxTestDouble {
  const outbox: Row[] = (opts.outboxRows ?? []).map((r) => ({ ...r }));
  const suppressions: string[] = [...(opts.suppressions ?? [])];

  const table = (name: string) => {
    if (name === "email_outbox") {
      return {
        upsert(row: Row, upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          return {
            select(_cols?: string) {
              return Promise.resolve().then(() => {
                if (upsertOpts?.ignoreDuplicates) {
                  const existing = outbox.find((r) => r.idempotency_key === row.idempotency_key);
                  if (existing) return { data: [], error: null };
                }
                const id = row.id ?? `ob-${outbox.length + 1}`;
                const inserted = { id, ...row };
                outbox.push(inserted);
                return { data: [inserted], error: null };
              });
            },
          };
        },
        select(_cols?: string) {
          return {
            eq(col: string, val: string) {
              return {
                maybeSingle: () => Promise.resolve({ data: outbox.find((r) => r[col] === val) ?? null, error: null }),
                limit: () => Promise.resolve({ data: [], error: null }),
              };
            },
          };
        },
        update(patch: Row) {
          return {
            eq(_col: string, val: string) {
              return Promise.resolve().then(() => {
                const row = outbox.find((r) => r.id === val);
                if (row) Object.assign(row, patch);
                return { error: null };
              });
            },
          };
        },
      };
    }
    if (name === "email_suppressions") {
      return {
        upsert(row: Row, upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          void upsertOpts;
          return Promise.resolve().then(() => {
            const key = `${row.email}:${row.reason}`;
            if (!suppressions.includes(key)) suppressions.push(key);
            return { error: null };
          });
        },
        select(_cols?: string) {
          return {
            eq(_col: string, val: string) {
              return {
                limit: () =>
                  Promise.resolve({ data: suppressions.some((s) => s.startsWith(`${val}:`)) ? [{ email: val }] : [], error: null }),
              };
            },
          };
        },
      };
    }
    throw new Error(`unexpected table ${name}`);
  };

  let claimedBatch: Row[] = [];
  return {
    outbox,
    suppressions,
    setClaimedBatch(rows: Row[]) {
      claimedBatch = rows;
      for (const row of rows) {
        if (!outbox.some((r) => r.id === row.id)) outbox.push({ ...row });
      }
    },
    from: table,
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== "claim_email_outbox_batch") return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
      const size = Number(args.p_batch_size ?? 10);
      return Promise.resolve({ data: claimedBatch.slice(0, size).map((r) => ({ ...r, attempts: (r.attempts as number) + 1 })), error: null });
    },
  } as never;
}

function fakeProvider(behaviour: (message: EmailMessage) => Awaited<ReturnType<EmailProvider["send"]>>): EmailProvider {
  return {
    name: "smtp",
    send: async (message) => behaviour(message),
  };
}

const baseMessage = {
  messageType: "welcome",
  templateId: "welcome",
  templateVersion: 1,
  to: "customer@example.com",
  from: "hello@blockwise.sale",
  subject: "Welcome",
  html: "<p>Welcome to Blockwise</p>",
  text: "Welcome to Blockwise",
  locale: "en-AU",
  timezone: "Australia/Perth",
  payload: {},
};

describe("email outbox", () => {
  it("enqueues a message with its idempotency key", async () => {
    const supabase = makeSupabase();
    const result = await enqueueEmail(supabase, { ...baseMessage, idempotencyKey: "k1" });
    assert.equal(result.queued, true);
    assert.equal(supabase.outbox.length, 1);
    assert.equal(supabase.outbox[0].idempotency_key, "k1");
    assert.equal(supabase.outbox[0].status, "pending");
  });

  it("collapses duplicate enqueues to the first message", async () => {
    const supabase = makeSupabase();
    const first = await enqueueEmail(supabase, { ...baseMessage, idempotencyKey: "dup" });
    const second = await enqueueEmail(supabase, { ...baseMessage, idempotencyKey: "dup" });
    assert.equal(first.queued, true);
    assert.equal(second.queued, false);
    assert.equal(second.duplicateOf, first.id);
    assert.equal(supabase.outbox.length, 1);
  });

  it("delivers a claimed message and marks it sent", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([{ id: "ob-1", status: "pending", attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi" }, idempotency_key: "x" }]);
    const sent: EmailMessage[] = [];
    const summary = await drainEmailOutbox(supabase, fakeProvider((m) => {
      sent.push(m);
      return { ok: true, providerMessageId: "pm-1" };
    }), "hello@blockwise.sale");
    assert.equal(summary.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].idempotencyKey, "x");
    assert.equal(supabase.outbox[0].status, "sent");
  });

  it("skips suppressed recipients without calling the provider", async () => {
    const supabase = makeSupabase({ suppressions: ["a@b.test:bounce"] });
    await recordEmailSuppression(supabase, { email: "A@B.test", reason: "bounce", source: "test" });
    assert.equal(await isEmailSuppressed(supabase, "a@b.test"), true);
    supabase.setClaimedBatch([{ id: "ob-1", status: "pending", attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: {}, idempotency_key: "y" }]);
    let calls = 0;
    const summary = await drainEmailOutbox(supabase, fakeProvider(() => {
      calls += 1;
      return { ok: true, providerMessageId: null };
    }), "hello@blockwise.sale");
    assert.equal(calls, 0);
    assert.equal(summary.suppressed, 1);
    assert.equal(supabase.outbox[0].status, "suppressed");
  });

  it("retries transient failures with backoff and dead-letters exhausted attempts", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([
      { id: "ob-1", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: {}, idempotency_key: "z1" },
      { id: "ob-2", status: "sending", attempts: 6, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: {}, idempotency_key: "z2" },
    ]);
    const summary = await drainEmailOutbox(
      supabase,
      fakeProvider(() => ({ ok: false, error: "smtp_error: 451 temporary", permanent: false })),
      "hello@blockwise.sale",
    );
    assert.equal(summary.failed, 1);
    assert.equal(summary.dead, 1);
    const failed = supabase.outbox.find((r) => r.id === "ob-1")!;
    const dead = supabase.outbox.find((r) => r.id === "ob-2")!;
    assert.equal(failed.status, "failed");
    assert.ok(typeof failed.next_attempt_at === "string" && failed.next_attempt_at > new Date().toISOString());
    assert.equal(dead.status, "dead");
  });

  it("dead-letters permanent failures immediately and stores a redacted error", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([
      { id: "ob-1", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: {}, idempotency_key: "z3" },
    ]);
    await drainEmailOutbox(
      supabase,
      fakeProvider(() => ({ ok: false, error: `resend_http_422: Bearer ${"ey"}${"JhbGciOiJIUzI1NiJ9"}.x.y invalid`, permanent: true })),
      "hello@blockwise.sale",
    );
    assert.equal(supabase.outbox[0].status, "dead");
    assert.ok(!String(supabase.outbox[0].last_error).includes("eyJ"));
    assert.ok(String(supabase.outbox[0].last_error).includes("[redacted]"));
  });
});
