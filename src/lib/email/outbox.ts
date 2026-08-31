import type { SupabaseClient } from "@supabase/supabase-js";

import { redactString } from "../redact.ts";
import type { EmailMessage, EmailProvider } from "./provider.ts";

/**
 * Durable transactional email outbox.
 *
 * Enqueue happens after the business-state change commits: the outbox row is
 * durable and idempotent, so a retry of the business action collapses onto
 * the same message via the idempotency key. Delivery is a separate worker
 * pass through a provider-neutral interface with exponential backoff, lease
 * expiry, dead-lettering and suppression enforcement. Duplicate enqueues
 * with the same idempotency key collapse to one message.
 */

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
          from: input.from,
          replyTo: input.replyTo ?? null,
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.payload ?? {}),
        },
        idempotency_key: input.idempotencyKey,
        status: "pending",
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
  const { data: claimed, error: claimError } = await supabase.rpc("claim_email_outbox_batch", {
    p_batch_size: batchSize,
  });
  if (claimError) {
    throw new Error(`claim_email_outbox_batch failed: ${claimError.message}`);
  }

  const rows = (Array.isArray(claimed) ? claimed : []) as OutboxRow[];
  const summary: DrainSummary = { claimed: rows.length, sent: 0, suppressed: 0, failed: 0, dead: 0 };

  for (const row of rows) {
    let suppressed: boolean;
    try {
      suppressed = await isEmailSuppressed(supabase, row.recipient);
    } catch {
      // Suppression state unknown -> fail the message for a later pass.
      await finalizeRow(supabase, row.id, {
        status: "failed",
        lastError: "suppression_check_unavailable",
        nextAttemptAt: retryAt(row.attempts),
      });
      summary.failed += 1;
      continue;
    }
    if (suppressed) {
      const finalized = await finalizeRow(supabase, row.id, { status: "suppressed", lastError: "suppressed" });
      if (finalized) summary.suppressed += 1;
      else summary.failed += 1;
      continue;
    }

    const message = toMessage(row);
    if (!message) {
      // Enqueue without content: dead-letter, never deliver a broken body.
      const finalized = await finalizeRow(supabase, row.id, {
        status: "dead",
        lastError: "missing_message_content",
      });
      if (finalized) summary.dead += 1;
      else summary.failed += 1;
      continue;
    }

    const result = await provider.send(message);
    if (result.ok) {
      const finalized = await finalizeRow(supabase, row.id, {
        status: "sent",
        sentAt: true,
        lastError: null,
      });
      if (finalized) {
        summary.sent += 1;
      } else {
        summary.failed += 1;
      }
      continue;
    }

    const dead = result.permanent || row.attempts >= row.max_attempts;
    const finalized = await finalizeRow(supabase, row.id, {
      status: dead ? "dead" : "failed",
      lastError: redactString(result.error),
      nextAttemptAt: dead ? undefined : retryAt(row.attempts),
    });
    if (dead) {
      summary.dead += 1;
    } else {
      summary.failed += 1;
    }
    void finalized;
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
};

/** Returns true when the row was actually finalized. */
async function finalizeRow(
  supabase: SupabaseClient,
  id: string,
  input: FinalizeInput,
): Promise<boolean> {
  const update: Record<string, unknown> = {
    status: input.status,
    last_error: input.lastError,
  };
  if (input.sentAt) update.sent_at = new Date().toISOString();
  if (input.nextAttemptAt) update.next_attempt_at = input.nextAttemptAt;

  const { data, error } = await supabase.from("email_outbox").update(update).eq("id", id).select("id");
  if (error) {
    console.error(`[email-outbox] finalize ${input.status} failed for ${id}`, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}
