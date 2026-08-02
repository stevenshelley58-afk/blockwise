/**
 * Lead lifecycle email operations powered by Resend Automations, batch send,
 * and scheduled delivery.
 *
 * - Batch digest: send a daily summary of new leads to agents
 * - Scheduled follow-up: queue follow-up emails at business hours
 * - Automation events: fire lifecycle events that trigger Resend Automations
 *
 * The actual drip sequences (welcome → tips → check-in) are orchestrated by
 * Resend Automations configured in the dashboard. This module fires the events
 * and handles the batch/scheduled sends that don't fit the automation model.
 */
import {
  buildIdempotencyKey,
  fireAutomationEvent,
  sendBatchEmails,
  sendRawEmail,
  sendTemplateEmail,
  TEMPLATE_IDS,
  type BatchEmailInput,
} from "./resend-client.ts";

// ---------------------------------------------------------------------------
// Lifecycle event helpers
// ---------------------------------------------------------------------------

/** Fire when a lead replies or is contacted — stops nurture sequences. */
export async function fireLeadRepliedEvent(email: string, leadId: string): Promise<void> {
  await fireAutomationEvent({
    event: "lead.replied",
    email,
    payload: { lead_id: leadId },
  });
}

/** Fire when a lead converts to a client. */
export async function fireLeadConvertedEvent(email: string, leadId: string): Promise<void> {
  await fireAutomationEvent({
    event: "lead.converted",
    email,
    payload: { lead_id: leadId },
  });
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
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0"><strong>${l.fullName}</strong></td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${l.suburb}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${l.email}</td>` +
        `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0">${l.phone ?? "—"}</td></tr>`,
    )
    .join("");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px">
<h2 style="margin:0 0 12px">${input.leads.length} new lead${input.leads.length === 1 ? "" : "s"} — ${input.date}</h2>
<p style="color:#475569;margin:0 0 16px">Hi ${input.agentName}, here are your latest leads.</p>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#f8fafc"><th style="padding:6px 8px;text-align:left">#</th><th style="padding:6px 8px;text-align:left">Name</th><th style="padding:6px 8px;text-align:left">Suburb</th><th style="padding:6px 8px;text-align:left">Email</th><th style="padding:6px 8px;text-align:left">Phone</th></tr>
${leadRows}
</table>
</div>`;

  const text = `${input.leads.length} new leads — ${input.date}\n\n` +
    input.leads.map((l, i) => `${i + 1}. ${l.fullName} (${l.suburb}) — ${l.email} ${l.phone ?? ""}`).join("\n");

  const idempotencyKey = buildIdempotencyKey("digest", input.agentEmail, input.date);

  // Prefer template if configured.
  const templateId = TEMPLATE_IDS.leadDigest;
  if (templateId && templateId !== "lead-digest") {
    return sendTemplateEmail({
      templateId,
      variables: {
        AGENT_NAME: input.agentName,
        LEAD_COUNT: input.leads.length,
        DATE: input.date,
        LEAD_ROWS: leadRows,
      },
      to: input.agentEmail,
      from: input.from,
      subject: `${input.leads.length} new lead${input.leads.length === 1 ? "" : "s"} — ${input.date}`,
      idempotencyKey,
      tags: [{ name: "type", value: "lead-digest" }],
    });
  }

  return sendRawEmail({
    to: input.agentEmail,
    from: input.from,
    subject: `${input.leads.length} new lead${input.leads.length === 1 ? "" : "s"} — ${input.date}`,
    html,
    text,
    idempotencyKey,
    tags: [{ name: "type", value: "lead-digest" }],
  });
}

/**
 * Send digests to multiple agents in one batch call (up to 100).
 */
export async function sendBatchDigests(
  digests: DigestInput[],
): Promise<{ ids: string[] }> {
  const emails: BatchEmailInput[] = digests
    .filter((d) => d.leads.length > 0)
    .map((d) => ({
      to: d.agentEmail,
      from: d.from,
      subject: `${d.leads.length} new lead${d.leads.length === 1 ? "" : "s"} — ${d.date}`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:14px"><h2>${d.leads.length} new leads</h2><p>Hi ${d.agentName}, check your dashboard.</p></div>`,
      text: `${d.leads.length} new leads — ${d.date}. Check your Blockwise dashboard.`,
      tags: [{ name: "type", value: "lead-digest" }],
    }));

  if (emails.length === 0) return { ids: [] };

  const idempotencyKey = buildIdempotencyKey("batch-digest", new Date().toISOString().slice(0, 10));
  return sendBatchEmails(emails, idempotencyKey);
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
};

/**
 * Schedule a follow-up email for a specific time (e.g. 9am next business day).
 * Resend holds the email until the scheduled time. Can be cancelled via the
 * dashboard or API before delivery.
 */
export async function scheduleFollowUpEmail(input: ScheduledFollowUpInput): Promise<{ id: string }> {
  const idempotencyKey = buildIdempotencyKey("followup", input.to, input.leadId ?? input.scheduledAt);

  const templateId = TEMPLATE_IDS.leadFollowUp;
  if (templateId && templateId !== "lead-followup") {
    return sendTemplateEmail({
      templateId,
      variables: { SUBJECT: input.subject, BODY: input.text },
      to: input.to,
      from: input.from,
      subject: input.subject,
      scheduledAt: input.scheduledAt,
      idempotencyKey,
      tags: [{ name: "type", value: "lead-followup" }],
    });
  }

  return sendRawEmail({
    to: input.to,
    from: input.from,
    subject: input.subject,
    text: input.text,
    html: input.html,
    scheduledAt: input.scheduledAt,
    idempotencyKey,
    tags: [{ name: "type", value: "lead-followup" }],
  });
}
