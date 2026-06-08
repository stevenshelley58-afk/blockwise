/**
 * Alert delivery for the paid-service watchdog: email via Resend and WhatsApp
 * via Twilio. Both use plain fetch (no npm dependency) and are no-ops when
 * their environment variables are missing, mirroring demo-request-email.ts.
 *
 * Email (Resend):
 *   RESEND_API_KEY     – shared with demo notifications
 *   ALERT_EMAIL_FROM   – falls back to DEMO_NOTIFY_FROM
 *   ALERT_EMAIL_TO     – falls back to DEMO_NOTIFY_TO
 *
 * WhatsApp (Twilio, https://www.twilio.com/docs/whatsapp/quickstart):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM – Twilio WhatsApp sender, e.g. +14155238886 (sandbox)
 *   ALERT_WHATSAPP_TO    – your number in E.164, e.g. +614xxxxxxxx
 */

export type AlertMessage = {
  subject: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendAlertEmail(message: AlertMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM || process.env.DEMO_NOTIFY_FROM;
  const to = process.env.ALERT_EMAIL_TO || process.env.DEMO_NOTIFY_TO;

  if (!apiKey || !from || !to) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${escapeHtml(message.text)}</pre>`,
      }),
    });
    if (!res.ok) {
      console.error("Alert email send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Alert email send threw", err);
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
