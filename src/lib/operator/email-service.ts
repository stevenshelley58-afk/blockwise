const RESEND_API_BASE = "https://api.resend.com";
const DEFAULT_MAILBOX_ADDRESS = "steven@blockwise.sale";
const DEFAULT_MAILBOX_DOMAIN = "blockwise.sale";
const DEFAULT_MAIL_FROM = "Steven at Blockwise <steven@blockwise.sale>";

export type OperatorMailboxConfig = {
  mailboxAddress: string;
  mailboxDomain: string;
  mailboxLabel: string;
  fromAddress: string;
  replyAddress: string;
  configured: boolean;
};

export type OperatorEmailAttachment = {
  id?: string | null;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  size?: number | null;
};

export type OperatorEmailSummary = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  createdAt: string;
  messageId: string | null;
  attachments: OperatorEmailAttachment[];
};

export type OperatorEmailDetail = OperatorEmailSummary & {
  cc: string[];
  bcc: string[];
  replyTo: string[];
  text: string | null;
  html: string | null;
};

export type OperatorEmailContact = {
  id: string;
  name: string;
  email: string;
};

type OperatorEmailContactRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ResendListResponse = {
  object: "list";
  has_more: boolean;
  data: ResendReceivedEmailSummary[];
};

type ResendReceivedEmailSummary = {
  id: string;
  to?: string[] | null;
  from?: string | null;
  subject?: string | null;
  created_at?: string | null;
  message_id?: string | null;
  attachments?: OperatorEmailAttachment[] | null;
};

type ResendReceivedEmailDetail = ResendReceivedEmailSummary & {
  cc?: string[] | null;
  bcc?: string[] | null;
  reply_to?: string[] | null;
  text?: string | null;
  html?: string | null;
};

type ResendSendResponse = {
  id: string;
};

type ResendError = {
  error?: {
    message?: string;
    code?: string;
  };
};

export function getOperatorMailboxConfig(env: NodeJS.ProcessEnv = process.env): OperatorMailboxConfig {
  const mailboxAddress = normalizeEmailAddress(env.OPERATOR_MAILBOX_ADDRESS) || DEFAULT_MAILBOX_ADDRESS;
  const mailboxDomain =
    normalizeDomain(env.OPERATOR_MAILBOX_DOMAIN) || domainFromEmail(mailboxAddress) || DEFAULT_MAILBOX_DOMAIN;
  const replyAddress = normalizeEmailAddress(env.OPERATOR_MAIL_REPLY_TO) || mailboxAddress;

  return {
    mailboxAddress,
    mailboxDomain,
    mailboxLabel: env.OPERATOR_MAILBOX_LABEL?.trim() || `All @${mailboxDomain}`,
    fromAddress: env.OPERATOR_MAIL_FROM?.trim() || DEFAULT_MAIL_FROM,
    replyAddress,
    configured: Boolean(env.RESEND_API_KEY?.trim()),
  };
}

export function normalizeEmailAddress(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

export function parseEmailRecipients(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(",") : typeof value === "string" ? value : "";
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const part of raw.split(/[,\n;]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    recipients.push(trimmed);
  }

  return recipients;
}

export function normalizeOperatorEmailContacts(rows: OperatorEmailContactRow[]): OperatorEmailContact[] {
  const contacts = new Map<string, OperatorEmailContact>();

  for (const row of rows) {
    const email = normalizeEmailAddress(row.email);
    if (!email || contacts.has(email)) continue;
    contacts.set(email, {
      id: row.id,
      name: row.full_name?.trim() || email,
      email,
    });
  }

  return [...contacts.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en-AU", { sensitivity: "base" }),
  );
}

export function belongsToMailbox(email: { to?: string[] | null }, mailboxScope: string): boolean {
  const scope = normalizeEmailAddress(mailboxScope);
  const domain = normalizeDomain(mailboxScope);

  return (email.to ?? []).some((address) => {
    const recipient = normalizeEmailAddress(address);
    if (!recipient) return false;
    if (scope.includes("@")) return recipient === scope;
    return recipient.endsWith(`@${domain}`);
  });
}

export function buildReplySubject(subject: string | null | undefined): string {
  const clean = (subject ?? "").trim();
  if (!clean) return "Re:";
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function listOperatorEmails(input?: { limit?: number; before?: string | null; after?: string | null }) {
  const config = getOperatorMailboxConfig();
  const limit = clampLimit(input?.limit ?? 50);
  const params = new URLSearchParams({ limit: String(limit) });
  if (input?.before) params.set("before", input.before);
  if (input?.after) params.set("after", input.after);

  const data = await resendRequest<ResendListResponse>(`/emails/receiving?${params.toString()}`, {
    method: "GET",
  });
  const messages = (data.data ?? [])
    .filter((email) => belongsToMailbox(email, config.mailboxDomain))
    .map(normalizeSummary);

  return {
    mailbox: config.mailboxLabel,
    hasMore: data.has_more,
    messages,
  };
}

export async function getOperatorEmail(id: string): Promise<{ mailbox: string; message: OperatorEmailDetail | null }> {
  const config = getOperatorMailboxConfig();
  const data = await resendRequest<ResendReceivedEmailDetail>(`/emails/receiving/${encodeURIComponent(id)}`, {
    method: "GET",
  });

  if (!belongsToMailbox(data, config.mailboxDomain)) {
    return { mailbox: config.mailboxLabel, message: null };
  }

  return {
    mailbox: config.mailboxLabel,
    message: normalizeDetail(data),
  };
}

export async function sendOperatorEmail(input: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string | null;
}): Promise<{ id: string; from: string }> {
  const config = getOperatorMailboxConfig();
  const subject = input.subject.trim();
  const text = input.text.trim();
  const to = input.to.map((recipient) => recipient.trim()).filter(Boolean);

  if (to.length === 0) {
    throw new OperatorEmailError("At least one recipient is required.", 400);
  }
  if (!subject) {
    throw new OperatorEmailError("Subject is required.", 400);
  }
  if (!text) {
    throw new OperatorEmailError("Message body is required.", 400);
  }

  const data = await resendRequest<ResendSendResponse>("/emails", {
    method: "POST",
    body: JSON.stringify({
      from: config.fromAddress,
      to,
      subject,
      text,
      html: textToHtml(text),
      reply_to: input.replyTo || config.replyAddress,
    }),
  });

  return { id: data.id, from: config.fromAddress };
}

export class OperatorEmailError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "OperatorEmailError";
    this.status = status;
  }
}

async function resendRequest<T>(path: string, init: RequestInit): Promise<T> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new OperatorEmailError("Resend is not configured.", 503);
  }

  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as T & ResendError;

  if (!response.ok) {
    throw new OperatorEmailError(json.error?.message || "Resend request failed.", response.status || 500);
  }

  return json;
}

function normalizeSummary(email: ResendReceivedEmailSummary): OperatorEmailSummary {
  return {
    id: email.id,
    to: email.to ?? [],
    from: email.from ?? "Unknown sender",
    subject: email.subject?.trim() || "(no subject)",
    createdAt: email.created_at ?? new Date(0).toISOString(),
    messageId: email.message_id ?? null,
    attachments: email.attachments ?? [],
  };
}

function normalizeDetail(email: ResendReceivedEmailDetail): OperatorEmailDetail {
  return {
    ...normalizeSummary(email),
    cc: email.cc ?? [],
    bcc: email.bcc ?? [],
    replyTo: email.reply_to ?? [],
    text: email.text ?? null,
    html: email.html ?? null,
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function domainFromEmail(address: string): string {
  const parts = address.split("@");
  return normalizeDomain(parts.length === 2 ? parts[1] : "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
