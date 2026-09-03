import { createHmac, timingSafeEqual } from "node:crypto";

import {
  BookingWebhookError,
  type BookingState,
  type ProviderBookingEvent,
} from "./provider.ts";

/**
 * SnagTime booking event contract — frozen before the Blockwise adapter is
 * built, so the fork emits exactly this envelope and the adapter consumes it.
 *
 * Envelope (spec `blockwise.booking.v1`):
 * {
 *   "spec": "blockwise.booking.v1",
 *   "id": "<immutable event id, uuid>",       // dedupe key per provider
 *   "type": "booking.created" | "booking.rescheduled" | "booking.cancelled",
 *   "occurredAt": "<ISO-8601>",
 *   "data": {
 *     "booking": { "uid": "...", "eventTypeId": "cuid"|1|null, "startTime": "...",
 *                  "endTime": "...", "rescheduleUrl": "..."|null },
 *     "invitation": "<opaque Blockwise invitation token>",
 *     "attendee": { "email": "...", "name": "..." } | null
 *   }
 * }
 *
 * Transport: POST from the SnagTime worker with
 *   x-snagtime-timestamp: <unix seconds>
 *   x-snagtime-signature: sha256=hex(HMAC_SHA256(secret, "<timestamp>.<rawBody>"))
 * Replay protection: signatures older than the window are rejected; delivery
 * retries reuse the SAME event id, and Blockwise dedupes on (provider, event
 * id) via claim_booking_webhook_event, so retries converge without
 * duplication. Never include OAuth/SMTP/payment credentials in events.
 */

export const SNAGTIME_EVENT_SPEC = "blockwise.booking.v1";

const SUPPORTED_SNAGTIME_TYPES = ["booking.created", "booking.rescheduled", "booking.cancelled"] as const;
export type SnagTimeEventType = (typeof SUPPORTED_SNAGTIME_TYPES)[number];

const DEFAULT_REPLAY_WINDOW_SECONDS = 300;

export function verifySnagtimeWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret?: string | null;
  now?: Date;
  replayWindowSeconds?: number;
}): boolean {
  const secret = input.secret?.trim();
  if (!secret || !input.signature || !input.timestamp) return false;
  if (!/^\d{10}$/.test(input.timestamp.trim())) return false;
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) return false;
  const window = input.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS;
  if (!Number.isSafeInteger(window) || window < 1 || window > 3600) return false;
  if (Math.abs(nowSeconds - timestamp) > window) return false;

  const match = /^sha256=([a-f0-9]{64})$/i.exec(input.signature.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${input.rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], "hex"));
}

export function signSnagtimePayload(input: {
  rawBody: string;
  timestamp: number;
  secret: string;
}): string {
  return createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The signed envelope's `id` is the immutable event id — it is covered by the
 * HMAC, unlike transport headers. A captured signed body therefore cannot be
 * replayed inside the timestamp window with a different event identity: any
 * x-snagtime-event-id header must match the envelope id exactly.
 */
export function resolveSnagtimeEventId(
  raw: Record<string, unknown>,
  headerEventId: string | null | undefined,
): string {
  const envelopeId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!UUID_PATTERN.test(envelopeId)) {
    throw new BookingWebhookError("Booking webhook is missing an immutable event id.", 400);
  }
  const headerId = headerEventId?.trim() ?? "";
  if (headerId && headerId !== envelopeId) {
    throw new BookingWebhookError("Booking webhook event id does not match the signed envelope.", 400);
  }
  return envelopeId;
}

export function parseSnagtimeWebhook(input: {
  raw: Record<string, unknown>;
  providerEventId: string;
}): ProviderBookingEvent {
  assertExactKeys(input.raw, ["spec", "id", "type", "occurredAt", "data"], "envelope");
  if (input.raw.spec !== SNAGTIME_EVENT_SPEC) {
    throw new BookingWebhookError(`Unsupported booking event spec.`, 202);
  }
  const type = input.raw.type;
  if (!isSupportedType(type)) {
    throw new BookingWebhookError("Unsupported booking webhook event.", 202);
  }
  const data = requiredRecord(input.raw.data, "data");
  assertExactKeys(data, ["booking", "invitation", "attendee"], "data");
  const booking = requiredRecord(data.booking, "data.booking");
  assertExactKeys(booking, ["uid", "eventTypeId", "startTime", "endTime", "rescheduleUrl"], "data.booking");
  const providerBookingId = requiredString(booking.uid, "data.booking.uid");
  const occurredAt = requiredTimestamp(input.raw.occurredAt, "occurredAt");
  const invitationToken = requiredString(data.invitation, "data.invitation");
  const attendee = data.attendee === null ? null : requiredRecord(data.attendee, "data.attendee");
  if (attendee) assertExactKeys(attendee, ["email", "name"], "data.attendee");
  const scheduledStartAt = optionalTimestamp(booking.startTime, "data.booking.startTime");
  const scheduledEndAt = optionalTimestamp(booking.endTime, "data.booking.endTime");
  if (scheduledStartAt && scheduledEndAt && new Date(scheduledEndAt).getTime() <= new Date(scheduledStartAt).getTime()) {
    throw new BookingWebhookError("Booking webhook has an invalid schedule.", 400);
  }
  if (!providerBookingId) {
    throw new BookingWebhookError("Booking webhook is missing a booking identifier.");
  }
  return {
    provider: "snagtime",
    providerEventId: input.providerEventId,
    providerBookingId,
    providerEventTypeId: optionalEventTypeId(booking.eventTypeId),
    trigger: triggerForType(type),
    state: stateForType(type),
    occurredAt,
    invitationToken,
    customerEmail: attendee ? requiredEmail(attendee.email) : null,
    customerName: attendee ? requiredString(attendee.name, "data.attendee.name") : null,
    scheduledStartAt,
    scheduledEndAt,
    rescheduleUrl: optionalHttpsUrl(booking.rescheduleUrl, "data.booking.rescheduleUrl"),
    raw: input.raw,
  };
}

function isSupportedType(value: unknown): value is SnagTimeEventType {
  return SUPPORTED_SNAGTIME_TYPES.includes(value as SnagTimeEventType);
}

function triggerForType(type: SnagTimeEventType): ProviderBookingEvent["trigger"] {
  if (type === "booking.created") return "BOOKING_CREATED";
  if (type === "booking.rescheduled") return "BOOKING_RESCHEDULED";
  return "BOOKING_CANCELLED";
}

function stateForType(type: SnagTimeEventType): BookingState {
  if (type === "booking.created") return "booked";
  if (type === "booking.rescheduled") return "rescheduled";
  return "cancelled";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingWebhookError(`Booking webhook ${path} must be an object.`, 400);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !(key in value))) {
    throw new BookingWebhookError(`Booking webhook ${path} does not match the frozen schema.`, 400);
  }
}

function requiredString(value: unknown, path: string): string {
  const result = stringValue(value);
  if (!result || result.length > 512) throw new BookingWebhookError(`Booking webhook ${path} is invalid.`, 400);
  return result;
}

function optionalString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return requiredString(value, path);
}

function requiredEmail(value: unknown): string {
  const result = requiredString(value, "data.attendee.email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new BookingWebhookError("Booking webhook data.attendee.email is invalid.", 400);
  }
  return result;
}

function optionalHttpsUrl(value: unknown, path: string): string | null {
  const result = optionalString(value, path);
  if (!result) return null;
  try {
    if (new URL(result).protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    throw new BookingWebhookError(`Booking webhook ${path} must be an HTTPS URL.`, 400);
  }
  return result;
}

function requiredTimestamp(value: unknown, path: string): string {
  const result = optionalTimestamp(value, path);
  if (!result) throw new BookingWebhookError(`Booking webhook ${path} is invalid.`, 400);
  return result;
}

function optionalTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  const result = requiredString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result)) {
    throw new BookingWebhookError(`Booking webhook ${path} must be an ISO-8601 UTC timestamp.`, 400);
  }
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalizeIso(result)) {
    throw new BookingWebhookError(`Booking webhook ${path} is invalid.`, 400);
  }
  return parsed.toISOString();
}

function normalizeIso(value: string): string {
  const match = /^(.*?)(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return value;
  return `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
}

function optionalEventTypeId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized && normalized.length <= 128) return normalized;
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  {
    throw new BookingWebhookError("Booking webhook data.booking.eventTypeId is invalid.", 400);
  }
}
