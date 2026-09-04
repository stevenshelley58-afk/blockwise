/**
 * Lead lifecycle email operations queued durably for provider-neutral delivery.
 *
 * - Batch digest: send a daily summary of new leads to agents
 * - Scheduled follow-up: queue follow-up emails at their explicit not-before time
 * - Lifecycle events: persist provider-neutral events for CRM/nurture consumers
 *
 * Drip automation is intentionally outside the transactional outbox; lifecycle
 * events are durably recorded for a separate CRM/nurture projection.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enqueueEmail } from "./outbox.ts";
import { escapeHtml } from "./provider.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";

// ---------------------------------------------------------------------------
// Lifecycle event helpers
// ---------------------------------------------------------------------------

/** Fire when a lead replies or is contacted — stops nurture sequences. */
export async function fireLeadRepliedEvent(email: string, leadId: string, supabase?: SupabaseClient): Promise<{ recorded: boolean }> {
  return recordLeadLifecycleEvent("lead.replied", email, leadId, supabase);
}

/** Fire when a lead converts to a client. */
export async function fireLeadConvertedEvent(email: string, leadId: string, supabase?: SupabaseClient): Promise<{ recorded: boolean }> {
  return recordLeadLifecycleEvent("lead.converted", email, leadId, supabase);
}

async function recordLeadLifecycleEvent(eventType: "lead.replied" | "lead.converted", email: string, leadId: string, supabase?: SupabaseClient): Promise<{ recorded: boolean }> {
  const { error } = await (supabase ?? createSupabaseServiceClient()).from("email_lifecycle_events").upsert({
    event_key: `${eventType}:${leadId}`, event_type: eventType, lead_id: leadId, email: email.toLowerCase().trim(),
  }, { onConflict: "event_key", ignoreDuplicates: true });
  if (error) throw new Error(`lead lifecycle event record failed: ${error.message}`);
  return { recorded: true };
}

// ---------------------------------------------------------------------------
// Batch digest
// ---------------------------------------------------------------------------

export type DigestLead = {
  email: string;
  fullName: string;
  suburb: string;
  phone?: string;
  source?: string;
};

export type DigestInput = {
  agentEmail: string;
  agentName: string;
  from: string;
  leads: DigestLead[];
  date: string; // ISO date string for the digest period
  supabase?: SupabaseClient;
};

/**
 * Send a daily lead digest to an agent. Uses batch API when sending to
 * multiple agents, or single send for one recipient.
 */
export async function sendLeadDigest(input: DigestInput): Promise<{ id: string } | null> {
  if (input.leads.length === 0) return null;

  const leadRows = input.leads
    .map(
      (l, i) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${i + 1}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0"><strong>${escapeHtml(l.fullName)}</strong></td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(l.suburb)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(l.email)}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(l.phone ?? "—")}</td></tr>`,
    )
    .join("");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px">
<h2 style="margin:0 0 12px">${input.leads.length} new lead${input.leads.length === 1 ? "" : "s"} — ${input.date}</h2>
<p style="color:#475569;margin:0 0 16px">Hi ${escapeHtml(input.agentName)}, here are your latest leads.</p>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#f8fafc"><th style="padding:6px 8px;text-align:left">#</th><th style="padding:6px 8px;text-align:left">Name</th><th style="padding:6px 8px;text-align:left">Suburb</th><th style="padding:6px 8px;text-align:left">Email</th><th style="padding:6px 8px;text-align:left">Phone</th></tr>
${leadRows}
</table>
</div>`;

  const text = `${input.leads.length} new leads — ${input.date}\n\n` +
    input.leads.map((l, i) => `${i + 1}. ${l.fullName} (${l.suburb}) — ${l.email} ${l.phone ?? ""}`).join("\n");

  const idempotencyKey = `digest:${createHash("sha256").update([input.agentEmail, input.date].join("\0")).digest("hex")}`;

  const result = await enqueueEmail(input.supabase ?? createSupabaseServiceClient(), {
    messageType: "lead_digest", templateId: "lead-digest", templateVersion: 1,
    to: input.agentEmail, from: input.from,
    subject: `${input.leads.length} new lead${input.leads.length === 1 ? "" : "s"} — ${input.date}`,
    html, text, payload: { agentName: input.agentName }, idempotencyKey,
  });
  return result.queued ? { id: result.id } : result.duplicateOf ? { id: result.duplicateOf } : null;
}

/**
 * Send digests to multiple agents in one batch call (up to 100).
 */
export async function sendBatchDigests(digests: DigestInput[]): Promise<{ ids: string[] }> {
  const sent = await Promise.all(digests.filter((d) => d.leads.length > 0).map((d) => sendLeadDigest(d)));
  return { ids: sent.flatMap((result) => result ? [result.id] : []) };
}

// ---------------------------------------------------------------------------
// Scheduled follow-up
// ---------------------------------------------------------------------------

export type ScheduledFollowUpInput = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  scheduledAt: string; // ISO 8601 future timestamp
  leadId?: string;
  supabase?: SupabaseClient;
};

/**
 * Schedule a follow-up email for a specific time (e.g. 9am next business day).
 * The outbox holds the email until the scheduled time; the drain honours its
 * not-before timestamp.
 */
export async function scheduleFollowUpEmail(input: ScheduledFollowUpInput): Promise<{ id: string }> {
  const idempotencyKey = buildFollowupKey(input);
  const result = await enqueueEmail(input.supabase ?? createSupabaseServiceClient(), {
    messageType: "lead_followup", templateId: "lead-followup", templateVersion: 1,
    to: input.to, from: input.from, subject: input.subject,
    html: input.html ?? `<p>${escapeHtml(input.text).replace(/\n/g, "<br>")}</p>`, text: input.text, nextAttemptAt: input.scheduledAt,
    payload: { scheduledAt: input.scheduledAt, leadId: input.leadId ?? null }, idempotencyKey,
  });
  return { id: result.queued ? result.id : (result.duplicateOf ?? "queued") };
}

function buildFollowupKey(input: ScheduledFollowUpInput): string {
  const identity = input.leadId ?? input.to;
  return `followup:${createHash("sha256").update([identity, input.scheduledAt].join("\0")).digest("hex")}`;
}
