/**
 * Alert delivery for the paid-service watchdog: email via the durable provider-neutral outbox and WhatsApp via Twilio.
 * Both are no-ops when their environment variables are missing.
 *
 * Email (outbox provider):
 *   EMAIL_PROVIDER / SMTP_* / RESEND_API_KEY - explicit provider configuration
 *   ALERT_EMAIL_FROM   – falls back to DEMO_NOTIFY_FROM
 *   ALERT_EMAIL_TO     – falls back to DEMO_NOTIFY_TO
 *
 * WhatsApp (Twilio, https://www.twilio.com/docs/whatsapp/quickstart):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM – Twilio WhatsApp sender, e.g. +14155238886 (sandbox)
 *   ALERT_WHATSAPP_TO    – your number in E.164, e.g. +614xxxxxxxx
 */

import { createHash } from "node:crypto";
import { enqueueEmail } from "../email/outbox.ts";
import { escapeHtml } from "../email/provider.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";

export type AlertMessage = {
  subject: string;
  text: string;
  /** Stable per-event key: retries deliver one email, separate events do not collapse. */
  idempotencyKey?: string;
};

// Last-resort owner inbox so low-credit / fallback alerts still land even when no
// alert recipient env var is configured. Override with ALERT_EMAIL_TO (or the
// legacy DEMO_NOTIFY_TO / BLOCKWISE_OWNER_ALERT_EMAIL).
const DEFAULT_OWNER_ALERT_EMAIL = "stevenshelley58@gmail.com";

/** Resolves the owner alert recipient: explicit env first, then the owner default. */
export function resolveAlertEmailRecipient(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.ALERT_EMAIL_TO ||
    env.DEMO_NOTIFY_TO ||
    env.BLOCKWISE_OWNER_ALERT_EMAIL ||
    DEFAULT_OWNER_ALERT_EMAIL
  );
}


export async function sendAlertEmail(message: AlertMessage): Promise<boolean> {
  const from = process.env.ALERT_EMAIL_FROM || process.env.DEMO_NOTIFY_FROM || "alerts@blockwise.sale";
  const to = resolveAlertEmailRecipient();
  try {
    const result = await enqueueEmail(createSupabaseServiceClient(), {
      messageType: "operator_alert", templateId: "alert", templateVersion: 1,
      to, from, subject: message.subject, text: message.text,
      html: '<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">' + escapeHtml(message.text) + "</pre>",
      idempotencyKey: message.idempotencyKey?.trim() || "alert:" + createHash("sha256").update([message.subject, message.text, String(Math.floor(Date.now() / 3_600_000))].join("\0")).digest("hex"),
    });
    return result.queued || result.duplicateOf !== null;
  } catch (err) {
    console.error("Alert email enqueue failed", err);
    return false;
  }
}
function whatsappAddress(value: string): string {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}

export async function sendAlertWhatsApp(message: AlertMessage): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.ALERT_WHATSAPP_TO;

  if (!sid || !token || !from || !to) return false;

  // WhatsApp messages have a 1600-char ceiling; keep alerts comfortably under it.
  const body = `${message.subject}\n\n${message.text}`.slice(0, 1500);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: whatsappAddress(from),
        To: whatsappAddress(to),
        Body: body,
      }),
    });
    if (!res.ok) {
      console.error("Alert WhatsApp send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Alert WhatsApp send threw", err);
    return false;
  }
}

/** Sends to both channels; each silently skips when unconfigured. */
export async function sendPaidServiceAlert(
  message: AlertMessage,
): Promise<{ email: boolean; whatsapp: boolean }> {
  const [email, whatsapp] = await Promise.all([
    sendAlertEmail(message),
    sendAlertWhatsApp(message),
  ]);
  return { email, whatsapp };
}
