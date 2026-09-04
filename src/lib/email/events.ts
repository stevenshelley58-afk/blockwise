import { recordEmailSuppression } from "./outbox";

export type EmailEvent = {
  type?: unknown;
  email?: unknown;
  messageId?: unknown;
  permanent?: unknown;
  source?: unknown;
};

export type NormalizedEmailEvent = {
  email: string;
  reason: "bounce" | "complaint";
  source: string;
};

/** Shared normalization for every signed suppression ingress. */
export function normalizeEmailEvent(event: EmailEvent): NormalizedEmailEvent | null {
  if (event.type !== "bounce" && event.type !== "complaint") return null;
  if (typeof event.email !== "string" || !event.email.includes("@")) return null;
  const source = typeof event.source === "string" && event.source.length > 0 ? event.source : "mail-relay";
  return { email: event.email, reason: event.type, source };
}

export function parseEmailEvents(body: unknown): NormalizedEmailEvent[] {
  const rawEvents = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: unknown[] }).events as EmailEvent[])
    : [];
  return rawEvents
    .map(normalizeEmailEvent)
    .filter((event): event is NormalizedEmailEvent => event !== null);
}

export async function ingestEmailSuppressions(
  service: Parameters<typeof recordEmailSuppression>[0],
  events: readonly NormalizedEmailEvent[],
): Promise<void> {
  for (const event of events) {
    await recordEmailSuppression(service, event);
  }
}
