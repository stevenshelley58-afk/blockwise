import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

export type EmailMessage = {
  /** Stable message identity, e.g. "welcome". Also the template id. */
  messageType: string;
  templateId: string;
  templateVersion: number;
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string; permanent: boolean };

export interface EmailProvider {
  readonly name: "resend" | "smtp" | "unconfigured";
  assertConfigured?: () => void;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Provider selection. EMAIL_PROVIDER must be configured explicitly — there
 * is no implicit default. An unconfigured provider remains available as a
 * testable fail-closed object, but the drain calls assertConfigured before it
 * claims anything so healthy queued mail is never dead-lettered for config.
 */
export class EmailProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderConfigurationError";
  }
}

export function assertEmailProviderConfigured(env: NodeJS.ProcessEnv = process.env): void {
  switch (env.EMAIL_PROVIDER?.trim().toLowerCase()) {
    case "smtp": {
      const host = env.SMTP_HOST?.trim();
      const port = Number(env.SMTP_PORT ?? 587);
      if (!host) throw new EmailProviderConfigurationError("SMTP_HOST is required.");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new EmailProviderConfigurationError("SMTP_PORT must be a valid TCP port.");
      }
      if (Boolean(env.SMTP_USER?.trim()) !== Boolean(env.SMTP_PASSWORD?.trim())) {
        throw new EmailProviderConfigurationError("SMTP_USER and SMTP_PASSWORD must be provided together.");
      }
      return;
    }
    case "resend":
      if (!env.RESEND_API_KEY?.trim()) {
        throw new EmailProviderConfigurationError("RESEND_API_KEY is required for the explicit Resend compatibility provider.");
      }
      return;
    case undefined:
    case "":
      throw new EmailProviderConfigurationError("EMAIL_PROVIDER must be explicitly configured.");
    default:
      throw new EmailProviderConfigurationError(`Unknown EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }
}

export function makeEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  switch (env.EMAIL_PROVIDER?.trim().toLowerCase()) {
    case "smtp":
      return makeSmtpProvider(env);
    case "resend":
      return makeResendProvider(env);
    case undefined:
    case "":
      return {
        name: "unconfigured",
        assertConfigured: () => assertEmailProviderConfigured(env),
        async send() {
          return { ok: false, error: "email_provider_not_configured", permanent: true };
        },
      };
    default:
      throw new Error(`Unknown EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }
}

export function makeResendProvider(env: NodeJS.ProcessEnv): EmailProvider {
  const apiKey = env.RESEND_API_KEY;
  return {
    name: "resend",
    assertConfigured: () => assertEmailProviderConfigured(env),
    async send(message) {
      if (!apiKey) {
        return { ok: false, error: "resend_not_configured", permanent: true };
      }
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          reply_to: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: { "X-Entity-Ref-ID": message.idempotencyKey },
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        // 4xx (other than 429) means the request itself is bad — retrying
        // unchanged will not help; treat as permanent for this message.
        const permanent = response.status < 500 && response.status !== 429;
        return { ok: false, error: `resend_http_${response.status}: ${text.slice(0, 200)}`, permanent };
      }
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerMessageId: body.id ?? null };
    },
  };
}

export function makeSmtpProvider(env: NodeJS.ProcessEnv): EmailProvider {
  const host = env.SMTP_HOST;
  const port = Number(env.SMTP_PORT ?? 587);
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  return {
    name: "smtp",
    assertConfigured: () => assertEmailProviderConfigured(env),
    async send(message) {
      if (!host) {
        return { ok: false, error: "smtp_not_configured", permanent: true };
      }
      const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
        requireTLS: true,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      try {
        const info = await transport.sendMail({
          from: message.from,
          to: message.to,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: { "X-Entity-Ref-ID": message.idempotencyKey },
        });
        return { ok: true, providerMessageId: info.messageId ?? null };
      } catch (error) {
        const err = error as { message?: string; code?: string; responseCode?: number };
        const permanent =
          typeof err.responseCode === "number" &&
          err.responseCode >= 500 &&
          err.responseCode < 600 &&
          err.responseCode !== 451 &&
          err.responseCode !== 450;
        return { ok: false, error: `smtp_${err.code ?? "error"}: ${(err.message ?? "").slice(0, 200)}`, permanent };
      } finally {
        transport.close();
      }
    },
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
