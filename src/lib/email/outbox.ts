import type { SupabaseClient } from "@supabase/supabase-js";

import { redactString } from "../redact.ts";
import { escapeHtml } from "./provider.ts";
import type { EmailMessage, EmailProvider } from "./provider.ts";

/**
 * Durable transactional email outbox.
 *
 * Producers should enqueue in the same transaction as the business state when
 * practical. Where the current route commits first, it records an explicit
 * pending recovery state and the drain scanner repairs the gap. Delivery is
 * at-least-once: lease fencing prevents stale workers settling reclaimed rows,
 * but a crash after provider acceptance can still result in a duplicate. */

export type OutboxEnqueueInput = {
  messageType: string;
  templateId: string;
  templateVersion: number;
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  locale?: string;
  timezone?: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  /** Do not deliver before this timestamp (used by scheduled follow-ups). */
  nextAttemptAt?: string;
};

export type OutboxEnqueueResult =
  | { queued: true; id: string }
  | { queued: false; duplicateOf: string | null };

type OutboxRow = {
  id: string;
  message_type: string;
  template_id: string;
  template_version: number;
  recipient: string;
  locale: string;
  timezone: string;
  payload: Record<string, unknown> | null;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  status: string;
  lease_token: string | null;
};

export async function enqueueEmail(
  supabase: SupabaseClient,
  input: OutboxEnqueueInput,
): Promise<OutboxEnqueueResult> {
  const { data, error } = await supabase
    .from("email_outbox")
    .upsert(
      {
        message_type: input.messageType,
        template_id: input.templateId,
        template_version: input.templateVersion,
        recipient: input.to,
        locale: input.locale ?? "en-AU",
        timezone: input.timezone ?? "Australia/Perth",
        // The rendered message content is stored here and read back at
        // delivery time — enqueue without content is a programming error.
        payload: {
          ...(input.payload ?? {}),
          // Reserved delivery fields always win over caller payload variables.
          from: input.from,
          replyTo: input.replyTo ?? null,
          subject: input.subject,
          html: input.html,
          text: input.text,
        },
        idempotency_key: input.idempotencyKey,
        status: "pending",
        ...(input.nextAttemptAt ? { next_attempt_at: input.nextAttemptAt } : {}),
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    throw new Error(`email_outbox enqueue failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.id) {
    return { queued: true, id: row.id };
  }

  // Duplicate idempotency key: resolve the original message.
  const { data: existing } = await supabase
    .from("email_outbox")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  return { queued: false, duplicateOf: existing?.id ?? null };
}

export async function recordEmailSuppression(
  supabase: SupabaseClient,
  input: { email: string; reason: "bounce" | "complaint" | "unsubscribe" | "admin"; source: string },
): Promise<void> {
  const { error } = await supabase
    .from("email_suppressions")
    .upsert(
      { email: input.email.toLowerCase().trim(), reason: input.reason, source: input.source },
      { onConflict: "email,reason", ignoreDuplicates: true },
    );
  if (error) {
    throw new Error(`email_suppressions record failed: ${error.message}`);
  }
}

export async function isEmailSuppressed(supabase: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_suppressions")
    .select("email")
    .eq("email", email.toLowerCase().trim())
    .limit(1);
  if (error) {
    // Fail closed: never send to an address when its suppression state is
    // unknown (a complained/unsubscribed address must not receive retries).
    throw new Error(`email_suppressions check failed: ${error.message}`);
  }
  return Array.isArray(data) && data.length > 0;
}

export type DrainSummary = {
  claimed: number;
  sent: number;
  suppressed: number;
  failed: number;
  dead: number;
};

/**
 * Claim and deliver one batch. Retry policy: exponential backoff
 * (60s * 2^(attempts-1), capped at 24h) for retryable failures; permanent
 * failures and exhausted attempts dead-letter with a redacted error. A
 * finalization failure marks the message failed for a later pass — the
 * summary never reports a message as sent unless its row was finalized.
 */
export async function drainEmailOutbox(
  supabase: SupabaseClient,
  provider: EmailProvider,
  batchSize = 10,
): Promise<DrainSummary> {
  provider.assertConfigured?.();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_email_outbox_batch", {
    p_batch_size: batchSize,
  });
  if (claimError) {
    throw new Error(`claim_email_outbox_batch failed: ${claimError.message}`);
  }

  const rows = (Array.isArray(claimed) ? claimed : []) as OutboxRow[];
  const summary: DrainSummary = { claimed: rows.length, sent: 0, suppressed: 0, failed: 0, dead: 0 };

  for (const row of rows) {
    const leaseToken = row.lease_token?.trim();
    if (!leaseToken) {
      console.error(`[email-outbox] claimed row ${row.id} has no lease token; leaving it for lease recovery`);
      summary.failed += 1;
      continue;
    }
    let suppressed: boolean;
    try {
      suppressed = await isEmailSuppressed(supabase, row.recipient);
    } catch {
      // Suppression state unknown -> fail the message for a later pass.
      await finalizeRow(supabase, row.id, leaseToken, {
        status: "failed",
        lastError: "suppression_check_unavailable",
        nextAttemptAt: retryAt(row.attempts),
      });
      summary.failed += 1;
      continue;
    }
    if (suppressed) {
      const finalized = await finalizeRow(supabase, row.id, leaseToken, { status: "suppressed", lastError: "suppressed" });
      if (finalized) summary.suppressed += 1;
      else summary.failed += 1;
      continue;
    }

    const message = toMessage(row);
    if (!message) {
      // Enqueue without content: dead-letter, never deliver a broken body.
      const finalized = await finalizeRow(supabase, row.id, leaseToken, {
        status: "dead",
        lastError: "missing_message_content",
      });
      if (finalized) summary.dead += 1;
      else summary.failed += 1;
      continue;
    }

    const result = await provider.send(message);
    if (result.ok) {
      const finalized = await finalizeRow(supabase, row.id, leaseToken, {
        status: "sent",
        sentAt: true,
        lastError: null,
        providerMessageId: result.providerMessageId,
      });
      if (finalized) {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
      continue;
    }

    const dead = result.permanent || row.attempts >= row.max_attempts;
    const finalized = await finalizeRow(supabase, row.id, leaseToken, {
      status: dead ? "dead" : "failed",
      lastError: redactString(result.error),
      nextAttemptAt: dead ? undefined : retryAt(row.attempts),
    });
    if (finalized) {
      if (dead) summary.dead += 1;
      else summary.failed += 1;
    } else summary.failed += 1;
  }

  return summary;
}

function retryAt(attempts: number): string {
  const delayMs = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 24 * 60 * 60 * 1000);
  return new Date(Date.now() + delayMs).toISOString();
}

/**
 * Rebuild the message from the stored payload. Returns null when the row has
 * no usable content (subject/html/text), which is dead-lettered above.
 */
function toMessage(row: OutboxRow): EmailMessage | null {
  const payload = row.payload ?? {};
  const subject = typeof payload.subject === "string" ? payload.subject : null;
  const html = typeof payload.html === "string" ? payload.html : null;
  const text = typeof payload.text === "string" ? payload.text : null;
  const from = typeof payload.from === "string" ? payload.from : null;
  if (!subject || (!html && !text) || !from) {
    return null;
  }
  return {
    messageType: row.message_type,
    templateId: row.template_id,
    templateVersion: row.template_version,
    to: row.recipient,
    from,
    replyTo: typeof payload.replyTo === "string" ? payload.replyTo : undefined,
    subject,
    html: html ?? "",
    text: text ?? "",
    idempotencyKey: row.idempotency_key,
  };
}

type FinalizeInput = {
  status: "sent" | "failed" | "dead" | "suppressed";
  sentAt?: boolean;
  lastError: string | null;
  nextAttemptAt?: string;
  providerMessageId?: string | null;
};

/** Returns true when the row was actually finalized. */
async function finalizeRow(
  supabase: SupabaseClient,
  id: string,
  leaseToken: string,
  input: FinalizeInput,
): Promise<boolean> {
  const update: Record<string, unknown> = {
    status: input.status,
    last_error: input.lastError,
  };
  if (input.sentAt) update.sent_at = new Date().toISOString();
  if (input.providerMessageId !== undefined) update.provider_message_id = input.providerMessageId;
  if (input.nextAttemptAt) update.next_attempt_at = input.nextAttemptAt;

  const { data, error } = await supabase
    .from("email_outbox")
    .update({ ...update, lease_token: null, lease_expires_at: null })
    .eq("id", id)
    .eq("lease_token", leaseToken)
    .eq("status", "sending")
    .select("id");
  if (error) {
    console.error(`[email-outbox] finalize ${input.status} failed for ${id}`, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export type PendingLeadWelcomeRecovery = { scanned: number; queued: number; failed: number };

/** Repairs the route-commit/outbox-commit gap without relying on a later user submission. */
export async function recoverPendingLeadWelcomeEmails(
  supabase: SupabaseClient,
  limit = 100,
): Promise<PendingLeadWelcomeRecovery> {
  const { data: pending, error } = await supabase
    .from("demo_requests")
    .select("id,name,email")
    .in("lead_welcome_enqueue_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) throw new Error(`lead_welcome recovery scan failed: ${error.message}`);
  const rows = (pending ?? []) as Array<{ id: string; name: string; email: string }>;
  let queued = 0;
  let failed = 0;
  for (const row of rows) {
    const firstName = escapeHtml(row.name.split(/\s+/)[0] || "there");
    try {
      await enqueueEmail(supabase, {
        messageType: "lead_welcome", templateId: "lead-welcome", templateVersion: 1,
        to: row.email, from: process.env.DEMO_NOTIFY_FROM?.trim() || "hello@blockwise.sale",
        replyTo: "support@blockwise.sale", subject: "Your Blockwise demo request — what happens next",
        html: `<p>Hi ${firstName},</p><p>Thanks for requesting a demo. The Blockwise team has your details and will be in touch within one business day.</p><p>— Blockwise</p>`,
        text: `Hi ${row.name.split(/\s+/)[0] || "there"},\n\nThanks for requesting a demo. The Blockwise team has your details and will be in touch within one business day.\n\n— Blockwise`,
        payload: { demoRequestId: row.id }, idempotencyKey: `lead-welcome:${row.id}`,
      });
      const update = await supabase.from("demo_requests").update({ lead_welcome_enqueue_status: "queued", lead_welcome_enqueue_error: null }).eq("id", row.id);
      if (update.error) throw update.error;
      queued += 1;
    } catch (recoveryError) {
      failed += 1;
      await supabase.from("demo_requests").update({ lead_welcome_enqueue_status: "failed", lead_welcome_enqueue_error: redactString(recoveryError instanceof Error ? recoveryError.message : String(recoveryError)) }).eq("id", row.id);
    }
  }
  return { scanned: rows.length, queued, failed };
}
