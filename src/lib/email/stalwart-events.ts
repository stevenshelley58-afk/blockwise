import { createHmac, timingSafeEqual } from "node:crypto";

import type { NormalizedEmailEvent } from "./events";

type StalwartEvent = { type?: unknown; data?: unknown };

/** Stalwart's current EventType list exposes permanent DSN failures, but no complaint event. */
export const STALWART_PERMANENT_FAILURE_EVENT = "delivery.dsn-perm-fail" as const;

export type StalwartMappingResult = {
  events: NormalizedEmailEvent[];
  malformedPermanentFailures: number;
  ignored: number;
};

export function verifyStalwartSignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret?.trim() || !signature?.trim()) return false;
  let supplied: Buffer;
  try { supplied = Buffer.from(signature.trim(), "base64"); } catch { return false; }
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function mapStalwartPermanentFailures(body: unknown): StalwartMappingResult {
  const rawEvents = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: unknown[] }).events as StalwartEvent[])
    : [];
  const mapped: NormalizedEmailEvent[] = [];
  let malformedPermanentFailures = 0;
  let ignored = 0;
  for (const event of rawEvents) {
    if (event.type !== STALWART_PERMANENT_FAILURE_EVENT) { ignored += 1; continue; }
    if (!event.data || typeof event.data !== "object") { malformedPermanentFailures += 1; continue; }
    const data = event.data as { to?: unknown };
    const recipients = typeof data.to === "string" ? [data.to] : Array.isArray(data.to) ? data.to : [];
    const validRecipients = recipients.filter((recipient): recipient is string => typeof recipient === "string" && recipient.includes("@"));
    if (validRecipients.length === 0 || validRecipients.length !== recipients.length) {
      malformedPermanentFailures += 1;
      continue;
    }
    for (const email of validRecipients) mapped.push({ email, reason: "bounce", source: "stalwart" });
  }
  return { events: mapped, malformedPermanentFailures, ignored };
}
