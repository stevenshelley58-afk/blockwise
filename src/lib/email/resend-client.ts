/**
 * Explicit Resend compatibility client for legacy integrations.
 *
 * New transactional sends use the provider-neutral outbox. This module remains
 * only for explicit compatibility callers with EMAIL_PROVIDER=resend:
 * - Idempotency keys on every send
 * - Template-based sending (Resend-managed templates with variables)
 * - Custom tracking domain support (resend.blockwise.sale)
 * - Automation event firing (lead lifecycle sequences)
 * - Contact management (segments + topics for compliance)
 * - Batch + scheduled send
 *
 * Environment:
 *   RESEND_API_KEY          – required for any email operation
 *   RESEND_TRACKING_DOMAIN  – custom tracking domain (default: resend.blockwise.sale)
 */
import { Resend } from "resend";

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: Resend | null = null;

export function getResendClient(): Resend {
  if (_client) return _client;
  if (process.env.EMAIL_PROVIDER?.trim().toLowerCase() !== "resend") {
    throw new ResendClientError("Resend is available only as the explicit compatibility provider.", 503);
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new ResendClientError("RESEND_API_KEY is not configured.", 503);
  }
  _client = new Resend(apiKey);
  return _client;
}

export function isResendConfigured(): boolean {
  return process.env.EMAIL_PROVIDER?.trim().toLowerCase() === "resend" && Boolean(process.env.RESEND_API_KEY?.trim());
}

export class ResendClientError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ResendClientError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Tracking domain
// ---------------------------------------------------------------------------

export const TRACKING_DOMAIN =
  process.env.RESEND_TRACKING_DOMAIN?.trim() || "resend.blockwise.sale";

// ---------------------------------------------------------------------------
// Template IDs (managed in Resend dashboard, referenced by alias or ID)
// ---------------------------------------------------------------------------

export const TEMPLATE_IDS = {
  demoRequest: process.env.RESEND_TEMPLATE_DEMO_REQUEST?.trim() || "demo-request",
  alertEmail: process.env.RESEND_TEMPLATE_ALERT?.trim() || "alert",
  suburbReport: process.env.RESEND_TEMPLATE_SUBURB_REPORT?.trim() || "suburb-report",
  leadWelcome: process.env.RESEND_TEMPLATE_LEAD_WELCOME?.trim() || "lead-welcome",
  leadFollowUp: process.env.RESEND_TEMPLATE_LEAD_FOLLOWUP?.trim() || "lead-followup",
  leadDigest: process.env.RESEND_TEMPLATE_LEAD_DIGEST?.trim() || "lead-digest",
} as const;

// ---------------------------------------------------------------------------
// Idempotency helper
// ---------------------------------------------------------------------------

export function buildIdempotencyKey(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const clean = parts.filter(Boolean).join(":");
  return `${prefix}:${clean}`;
}

// ---------------------------------------------------------------------------
// Send with template
// ---------------------------------------------------------------------------

export type TemplateSendInput = {
  templateId: string;
  variables?: Record<string, string | number>;
  to: string | string[];
  from?: string;
  subject?: string;
  replyTo?: string;
  scheduledAt?: string;
  tags?: Array<{ name: string; value: string }>;
  topicId?: string;
  idempotencyKey?: string;
};

export async function sendTemplateEmail(input: TemplateSendInput): Promise<{ id: string }> {
  const client = getResendClient();
  const { data, error } = await client.emails.send(
    {
      template: { id: input.templateId, variables: input.variables },
      to: input.to,
      from: input.from,
      subject: input.subject,
      replyTo: input.replyTo,
      scheduledAt: input.scheduledAt,
      tags: input.tags,
      topicId: input.topicId,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new ResendClientError(`Template email failed: ${error.message}`, 502);
  }
  return { id: data!.id };
}

// ---------------------------------------------------------------------------
// Send raw HTML/text (fallback when no template is configured)
// ---------------------------------------------------------------------------

export type RawSendInput = {
  to: string | string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  scheduledAt?: string;
  tags?: Array<{ name: string; value: string }>;
  topicId?: string;
  idempotencyKey?: string;
};

export async function sendRawEmail(input: RawSendInput): Promise<{ id: string }> {
  const client = getResendClient();

  // Build payload ensuring at least one render option is present (SDK union requirement).
  const payload: Record<string, unknown> = {
    to: input.to,
    from: input.from,
    subject: input.subject,
    replyTo: input.replyTo,
    scheduledAt: input.scheduledAt,
    tags: input.tags,
    topicId: input.topicId,
  };
  if (input.html) payload.html = input.html;
  if (input.text) payload.text = input.text;
  // Guarantee at least one render field.
  if (!input.html && !input.text) payload.text = "";

  const { data, error } = await client.emails.send(
    payload as never,
    { idempotencyKey: input.idempotencyKey },
  );

  if (error) {
    throw new ResendClientError(`Email send failed: ${error.message}`, 502);
  }
  return { id: data!.id };
}

// ---------------------------------------------------------------------------
// Batch send
// ---------------------------------------------------------------------------

export type BatchEmailInput = {
  to: string;
  from: string;
  subject: string;
  html?: string;
  text?: string;
  template?: { id: string; variables?: Record<string, string | number> };
  scheduledAt?: string;
  tags?: Array<{ name: string; value: string }>;
};

export async function sendBatchEmails(
  emails: BatchEmailInput[],
  idempotencyKey?: string,
): Promise<{ ids: string[] }> {
  const client = getResendClient();
  const payloads = emails.map((e) => {
    if (e.template) {
      return {
        template: e.template,
        to: e.to,
        from: e.from,
        subject: e.subject,
        scheduledAt: e.scheduledAt,
        tags: e.tags,
      };
    }
    return {
      to: e.to,
      from: e.from,
      subject: e.subject,
      html: e.html,
      text: e.text,
      scheduledAt: e.scheduledAt,
      tags: e.tags,
    };
  });

  const { data, error } = await client.batch.send(payloads as never[], { idempotencyKey });
  if (error) {
    throw new ResendClientError(`Batch send failed: ${error.message}`, 502);
  }
  return { ids: (data as unknown as Array<{ id: string }>).map((d) => d.id) };
}

// ---------------------------------------------------------------------------
// Automation events
// ---------------------------------------------------------------------------

export type AutomationEventInput = {
  event: string;
  email: string;
  payload?: Record<string, unknown>;
};

export async function fireAutomationEvent(input: AutomationEventInput): Promise<void> {
  if (!isResendConfigured()) return;
  const client = getResendClient();
  const { error } = await client.events.send({
    event: input.event,
    email: input.email,
    payload: input.payload,
  });
  if (error) {
    // Non-fatal: log but don't block the caller.
    console.error(`[resend] automation event "${input.event}" failed:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type UpsertContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  properties?: Record<string, string | number>;
  segments?: Array<{ id: string }>;
  topics?: Array<{ id: string; subscription: "opt_in" | "opt_out" }>;
};

export async function upsertContact(input: UpsertContactInput): Promise<{ id: string } | null> {
  if (!isResendConfigured()) return null;
  const client = getResendClient();
  const { data, error } = await client.contacts.create({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    properties: input.properties,
    segments: input.segments,
    topics: input.topics,
  });
  if (error) {
    console.error("[resend] contact upsert failed:", error.message);
    return null;
  }
  return { id: data!.id };
}

// ---------------------------------------------------------------------------
// Topics (unsubscribe granularity)
// ---------------------------------------------------------------------------

export const TOPIC_NAMES = {
  leadNotifications: "lead-notifications",
  marketUpdates: "market-updates",
  productNews: "product-news",
} as const;

// ---------------------------------------------------------------------------
// Shared HTML escaping (replaces 3 duplicated copies)
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
