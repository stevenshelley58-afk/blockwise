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
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Provider selection. EMAIL_PROVIDER must be configured explicitly — there
 * is no implicit default (the legacy Resend path is never chosen by
 * silence). An unconfigured provider reports a permanent failure so the
 * outbox worker dead-letters instead of silently dropping mail.
 */
export function makeEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return makeSmtpProvider(env);
    case "resend":
      return makeResendProvider(env);
    case undefined:
    case "":
      return {
        name: "unconfigured",
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
