/**
 * Sends a notification email when a demo request is submitted, using the
 * Resend REST API (https://resend.com/docs/api-reference/emails/send-email).
 *
 * This calls Resend's HTTP endpoint directly with fetch, so it works on the
 * Vercel Node runtime with no extra npm dependency.
 *
 * Required environment variables (set these in Vercel):
 *   RESEND_API_KEY      – API key from the Resend dashboard
 *   DEMO_NOTIFY_FROM    – verified sender on your domain, e.g. "Blockwise <notifications@blockwise.sale>"
 *   DEMO_NOTIFY_TO       – where to send the alert, e.g. "hello@blockwise.sale"
 *
 * If any of these are missing the function is a no-op (returns false) so a
 * missing config never breaks form submission.
 */

export type DemoRequestNotification = {
  name: string;
  email: string;
  agency?: string | null;
  phone?: string | null;
  suburb?: string | null;
  message?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendDemoRequestNotification(
  lead: DemoRequestNotification,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.DEMO_NOTIFY_FROM;
  const to = process.env.DEMO_NOTIFY_TO;

  if (!apiKey || !from || !to) {
    // Notifications not configured — submissions still land in the database.
    return false;
  }

  const rows: Array<[string, string | null | undefined]> = [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Agency", lead.agency],
    ["Phone", lead.phone],
    ["Suburb", lead.suburb],
    ["Message", lead.message],
  ];

  const visible = rows.filter(([, v]) => v);
  const textBody = visible.map(([k, v]) => `${k}: ${v}`).join("\n");
  const htmlBody = `<h2>New Blockwise demo request</h2><table cellpadding="6" style="font-family:system-ui,sans-serif;font-size:14px;border-collapse:collapse">${visible
    .map(
      ([k, v]) =>
        `<tr><td style="color:#475569">${k}</td><td><strong>${escapeHtml(String(v))}</strong></td></tr>`,
    )
    .join("")}</table>`;

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
        subject: `New demo request — ${lead.name}${lead.suburb ? ` (${lead.suburb})` : ""}`,
        html: htmlBody,
        text: textBody,
        // Replies go straight to the prospect.
        reply_to: lead.email,
      }),
    });

    if (!res.ok) {
      console.error("Resend email send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend email send threw", err);
    return false;
  }
}
