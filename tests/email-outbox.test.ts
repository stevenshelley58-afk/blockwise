import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { drainEmailOutbox, enqueueEmail, isEmailSuppressed, recordEmailSuppression } from "../src/lib/email/outbox.ts";
import { scheduleFollowUpEmail } from "../src/lib/email/lead-lifecycle.ts";
import type { EmailProvider } from "../src/lib/email/provider.ts";
import type { EmailMessage } from "../src/lib/email/provider.ts";

type Row = Record<string, unknown>;

type OutboxTestDouble = {
  outbox: Row[];
  suppressions: string[];
  businessRows: Record<string, Row[]>;
  setClaimedBatch(rows: Row[]): void;
};

/** Minimal Supabase REST-shape double: table upsert/select/update + rpc. */
function makeSupabase(opts: {
  outboxRows?: Row[];
  suppressions?: string[];
  failSuppressions?: boolean;
  marketingDecision?: { allowed: boolean; reason: string };
  businessRows?: Record<string, Row[]>;
} = {}): SupabaseClient & OutboxTestDouble {
  const outbox: Row[] = (opts.outboxRows ?? []).map((r) => ({ ...r }));
  const suppressions: string[] = [...(opts.suppressions ?? [])];
  const businessRows: Record<string, Row[]> = Object.fromEntries(Object.entries(opts.businessRows ?? {}).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));

  const table = (name: string) => {
    if (name === 'email_outbox') {
      return {
        upsert(row: Row, upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          return {
            select(_cols?: string) {
              return Promise.resolve().then(() => {
                if (upsertOpts?.ignoreDuplicates) {
                  const existing = outbox.find((r) => r.idempotency_key === row.idempotency_key);
                  if (existing) return { data: [], error: null };
                }
                const id = row.id ?? 'ob-' + (outbox.length + 1);
                const inserted = { id, ...row };
                outbox.push(inserted);
                return { data: [inserted], error: null };
              });
            },
          };
        },
        select(_cols?: string) {
          const filters: Array<(row: Row) => boolean> = [];
          const builder = {
            eq(col: string, val: unknown) { filters.push((row) => row[col] === val); return builder; },
            in(col: string, vals: unknown[]) { filters.push((row) => vals.includes(row[col])); return builder; },
            is(col: string, val: unknown) { filters.push((row) => val === null ? row[col] == null : row[col] === val); return builder; },
            order() { return builder; },
            limit() { return Promise.resolve({ data: outbox.filter((row) => filters.every((matches) => matches(row))), error: null }); },
            maybeSingle() { const row = outbox.find((candidate) => filters.every((matches) => matches(candidate))); return Promise.resolve({ data: row ?? null, error: null }); },
          };
          return builder;
        },
        update(patch: Row) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(col: string, val: unknown) { filters[col] = val; return builder; },
            select() {
              return Promise.resolve().then(() => {
                const row = outbox.find((r) => Object.entries(filters).every(([key, value]) => r[key] === value));
                if (row) Object.assign(row, patch);
                return { data: row ? [row] : [], error: null };
              });
            },
          };
          return builder;
        },
      };
    }
    if (name === 'email_suppressions') {
      return {
        upsert(row: Row, upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          void upsertOpts;
          return Promise.resolve().then(() => {
            const key = String(row.email) + ':' + String(row.reason);
            if (!suppressions.includes(key)) suppressions.push(key);
            return { error: null };
          });
        },
        select(_cols?: string) {
          return {
            eq(_col: string, val: string) {
              return { limit: () => Promise.resolve(opts.failSuppressions ? { data: null, error: { message: 'suppression store unavailable' } } : { data: suppressions.some((entry) => entry.startsWith(val + ':')) ? [{ email: val }] : [], error: null }) };
            },
          };
        },
      };
    }
    if (name === 'demo_requests' || name === 'report_email_leads') {
      const rows = businessRows[name] ?? [];
      return {
        update(patch: Row) {
          const filters: Record<string, unknown> = {};
          return {
            eq(col: string, val: unknown) {
              filters[col] = val;
              return Promise.resolve().then(() => {
                const row = rows.find((candidate) => Object.entries(filters).every(([key, value]) => candidate[key] === value));
                if (row) Object.assign(row, patch);
                return { data: row ? [row] : [], error: row ? null : { message: 'business row not found' } };
              });
            },
          };
        },
      };
    }
    throw new Error('unexpected table ' + name);
  };

  let claimedBatch: Row[] = [];
  return {
    outbox,
    suppressions,
    businessRows,
    setClaimedBatch(rows: Row[]) {
      claimedBatch = rows.map((row) => ({ ...row, status: 'sending', lease_token: row.lease_token ?? ('lease-' + row.id) }));
      for (const row of claimedBatch) {
        const existing = outbox.find((r) => r.id === row.id);
        if (existing) Object.assign(existing, row);
        else outbox.push({ ...row });
      }
    },
    from: table,
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === 'can_send_marketing') return Promise.resolve({ data: [opts.marketingDecision ?? { allowed: true, reason: 'allowed' }], error: null });
      if (fn !== 'claim_email_outbox_batch') return Promise.resolve({ data: null, error: { message: 'unexpected rpc ' + fn } });
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
  it("enqueues a message storing the rendered content in its payload", async () => {
    const supabase = makeSupabase();
    const result = await enqueueEmail(supabase, { ...baseMessage, idempotencyKey: "k1" });
    assert.equal(result.queued, true);
    assert.equal(supabase.outbox.length, 1);
    assert.equal(supabase.outbox[0].idempotency_key, "k1");
    assert.equal(supabase.outbox[0].status, "pending");
    const payload = supabase.outbox[0].payload as Record<string, unknown>;
    assert.equal(payload.subject, "Welcome");
    assert.equal(payload.html, "<p>Welcome to Blockwise</p>");
    assert.equal(payload.text, "Welcome to Blockwise");
    assert.equal(payload.from, "hello@blockwise.sale");
  });

  it("preserves a scheduled not-before timestamp", async () => {
    const supabase = makeSupabase();
    await enqueueEmail(supabase, { ...baseMessage, nextAttemptAt: "2099-01-01T00:00:00.000Z", idempotencyKey: "scheduled" });
    assert.equal(supabase.outbox[0].next_attempt_at, "2099-01-01T00:00:00.000Z");
  });

  it("schedules follow-ups with an explicit not-before timestamp", async () => {
    const supabase = makeSupabase();
    await scheduleFollowUpEmail({
      workspaceId: "workspace-1", topic: "follow_up", to: "customer@example.com", from: "hello@blockwise.sale", subject: "Follow up", text: "Tomorrow",
      scheduledAt: "2099-01-01T09:00:00.000Z", leadId: "lead-1", supabase,
    });
    assert.equal(supabase.outbox[0].next_attempt_at, "2099-01-01T09:00:00.000Z");
  });
  it("denies follow-ups when consent or suppression guard rejects the topic", async () => {
    const supabase = makeSupabase({ marketingDecision: { allowed: false, reason: "suppressed" } });
    await assert.rejects(() => scheduleFollowUpEmail({
      workspaceId: "workspace-1", topic: "follow_up", to: "customer@example.com", from: "hello@blockwise.sale", subject: "Follow up", text: "Tomorrow",
      scheduledAt: "2099-01-01T09:00:00.000Z", leadId: "lead-denied", supabase,
    }), /marketing_send_denied:suppressed/);
    assert.equal(supabase.outbox.length, 0);
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

  it("delivers a claimed message with its stored content and marks it sent", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([{ id: "ob-1", status: "sending", lease_token: null, attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "x" }]);
    const sent: EmailMessage[] = [];
    const summary = await drainEmailOutbox(supabase, fakeProvider((m) => {
      sent.push(m);
      return { ok: true, providerMessageId: "pm-1" };
    }));
    assert.equal(summary.sent, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].idempotencyKey, "x");
    assert.equal(sent[0].subject, "Hi");
    assert.equal(sent[0].from, "hello@blockwise.sale");
    assert.equal(supabase.outbox[0].status, "sent");
    assert.equal(supabase.outbox[0].provider_message_id, "pm-1");
  });

  it("does not settle a row reclaimed by another lease owner", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([{ id: "ob-stale", status: "sending", attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "stale" }]);
    const summary = await drainEmailOutbox(supabase, fakeProvider(() => {
      supabase.outbox[0].lease_token = "reclaimed-by-other-worker";
      return { ok: true, providerMessageId: "pm-stale" };
    }));
    assert.equal(summary.sent, 0);
    assert.equal(summary.failed, 1);
    assert.equal(supabase.outbox[0].status, "sending");
    assert.equal(supabase.outbox[0].provider_message_id, undefined);
  });
  it("dead-letters a claimed row that has no stored message content", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([{ id: "ob-1", status: "pending", attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: {}, idempotency_key: "x2" }]);
    let calls = 0;
    const summary = await drainEmailOutbox(supabase, fakeProvider(() => {
      calls += 1;
      return { ok: true, providerMessageId: "pm-1" };
    }));
    assert.equal(calls, 0);
    assert.equal(summary.dead, 1);
    assert.equal(supabase.outbox[0].status, "dead");
    assert.equal(supabase.outbox[0].last_error, "missing_message_content");
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
    }));
    assert.equal(calls, 0);
    assert.equal(summary.suppressed, 1);
    assert.equal(supabase.outbox[0].status, "suppressed");
  });

  it("fails a message closed when the suppression state is unavailable", async () => {
    const supabase = makeSupabase({ failSuppressions: true });
    supabase.setClaimedBatch([{ id: "ob-1", status: "pending", attempts: 1, max_attempts: 6, recipient: "a@b.test", message_type: "welcome", template_id: "welcome", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "s1" }]);
    let calls = 0;
    const summary = await drainEmailOutbox(supabase, fakeProvider(() => {
      calls += 1;
      return { ok: true, providerMessageId: null };
    }));
    assert.equal(calls, 0, "provider must not be called while suppression state is unknown");
    assert.equal(summary.failed, 1);
    const row = supabase.outbox[0];
    assert.equal(row.status, "failed");
    assert.equal(row.last_error, "suppression_check_unavailable");
    assert.ok(typeof row.next_attempt_at === "string");
  });

  it("retries transient failures with backoff and dead-letters exhausted attempts", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([
      { id: "ob-1", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "z1" },
      { id: "ob-2", status: "sending", attempts: 6, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "z2" },
    ]);
    const summary = await drainEmailOutbox(
      supabase,
      fakeProvider(() => ({ ok: false, error: "smtp_error: 451 temporary", permanent: false })),
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
      { id: "ob-1", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "z3" },
    ]);
    await drainEmailOutbox(
      supabase,
      fakeProvider(() => ({ ok: false, error: `resend_http_422: Bearer ${"ey"}${"JhbGciOiJIUzI1NiJ9"}.x.y invalid`, permanent: true })),
    );
    assert.equal(supabase.outbox[0].status, "dead");
    assert.ok(!String(supabase.outbox[0].last_error).includes("eyJ"));
    assert.ok(String(supabase.outbox[0].last_error).includes("[redacted]"));
  });
  it("turns provider exceptions into retryable failures and continues the batch", async () => {
    const supabase = makeSupabase();
    supabase.setClaimedBatch([
      { id: "ob-throw", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "throw" },
      { id: "ob-after-throw", status: "sending", attempts: 1, max_attempts: 6, recipient: "r@x.test", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale" }, idempotency_key: "after-throw" },
    ]);
    let calls = 0;
    const summary = await drainEmailOutbox(supabase, fakeProvider(() => { calls += 1; if (calls === 1) throw new Error("provider network secret"); return { ok: true, providerMessageId: "pm-after-throw" }; }));
    assert.equal(calls, 2); assert.equal(summary.failed, 1); assert.equal(summary.sent, 1);
    assert.equal(supabase.outbox.find((row) => row.id === "ob-throw")?.status, "failed");
    assert.equal(supabase.outbox.find((row) => row.id === "ob-after-throw")?.status, "sent");
    assert.equal(supabase.outbox.find((row) => row.id === "ob-throw")?.last_error, "provider network secret");
  });

  it("projects queued business statuses only after provider settlement", async () => {
    const supabase = makeSupabase({ businessRows: { demo_requests: [{ id: "demo-1", operator_notification_status: "queued", customer_email_status: "queued" }], report_email_leads: [{ id: "lead-1", delivery_status: "queued" }] } });
    supabase.setClaimedBatch([
      { id: "operator-mail", status: "sending", attempts: 1, max_attempts: 6, recipient: "operator@example.com", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale", _deliveryProjection: { kind: "demo_request_operator", id: "demo-1" } }, idempotency_key: "projection-sent" },
      { id: "report-mail", status: "sending", attempts: 1, max_attempts: 6, recipient: "lead@example.com", message_type: "t", template_id: "t", template_version: 1, payload: { subject: "Hi", html: "<p>Hi</p>", text: "Hi", from: "hello@blockwise.sale", _deliveryProjection: { kind: "report_email", id: "lead-1" } }, idempotency_key: "projection-failed" },
    ]);
    const rows = supabase.businessRows; assert.equal(rows.demo_requests[0].operator_notification_status, "queued");
    const summary = await drainEmailOutbox(supabase, fakeProvider((message) => message.to.startsWith("operator") ? { ok: true, providerMessageId: "pm-op" } : { ok: false, error: "temporary", permanent: false }));
    assert.equal(summary.sent, 1); assert.equal(summary.failed, 1);
    assert.equal(rows.demo_requests[0].operator_notification_status, "sent"); assert.equal(rows.demo_requests[0].operator_notified_at !== undefined, true);
    assert.equal(rows.report_email_leads[0].delivery_status, "failed");
  });

  it("keeps reserved delivery fields from being overridden by payload", async () => {
    const supabase = makeSupabase();
    await enqueueEmail(supabase, { ...baseMessage, subject: "Reserved", payload: { subject: "attacker", html: "bad", from: "bad@example.com" }, idempotencyKey: "reserved" });
    const payload = supabase.outbox[0].payload as Record<string, unknown>;
    assert.equal(payload.subject, "Reserved");
    assert.equal(payload.from, "hello@blockwise.sale");
  });

});
