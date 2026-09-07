import { Resend } from "resend";

/** The official SDK verifies raw bytes, timestamp and signature; no API request occurs. */
export function verifiedResendSuppressions(payload: string, headers: { id: string; timestamp: string; signature: string }, secret: string) {
  const event = new Resend("verification-only").webhooks.verify({ payload, headers, webhookSecret: secret });
  if (event.type !== "email.bounced" && event.type !== "email.complained") return [];
  // A shared provider account must not apply another domain's events here.
  const from = event.data.from.trim().toLowerCase();
  if (!/(?:^|<)[^<>\s@]+@blockwise\.sale>?$/.test(from)) return [];
  const reason = event.type === "email.bounced" ? "bounce" as const : "complaint" as const;
  return event.data.to.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .map((email) => ({ email: email.trim().toLowerCase(), reason, source: "resend-webhook" }));
}
