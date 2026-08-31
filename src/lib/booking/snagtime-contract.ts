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
 *     "booking": { "uid": "...", "eventTypeId": 1|null, "startTime": "...",
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
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const window = input.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS;
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

export function parseSnagtimeWebhook(input: {
  raw: Record<string, unknown>;
  providerEventId: string;
}): ProviderBookingEvent {
  if (input.raw.spec !== SNAGTIME_EVENT_SPEC) {
    throw new BookingWebhookError(`Unsupported booking event spec.`, 202);
  }
  const type = input.raw.type;
  if (!isSupportedType(type)) {
    throw new BookingWebhookError("Unsupported booking webhook event.", 202);
  }
  const data = recordValue(input.raw.data);
  const booking = recordValue(data?.booking);
  const providerBookingId = stringValue(booking?.uid) ?? stringValue(booking?.bookingUid);
  if (!providerBookingId) {
    throw new BookingWebhookError("Booking webhook is missing a booking identifier.");
  }
  const attendee = recordValue(data?.attendee);
  const occurredAt = stringValue(input.raw.occurredAt) ?? new Date().toISOString();

  return {
    provider: "snagtime",
    providerEventId: input.providerEventId,
    providerBookingId,
    providerEventTypeId: stringValue(booking?.eventTypeId),
    trigger: triggerForType(type),
    state: stateForType(type),
    occurredAt,
    invitationToken: stringValue(data?.invitation),
    customerEmail: stringValue(attendee?.email),
    customerName: stringValue(attendee?.name),
    scheduledStartAt: stringValue(booking?.startTime),
    scheduledEndAt: stringValue(booking?.endTime),
    rescheduleUrl: stringValue(booking?.rescheduleUrl) ?? stringValue(booking?.bookerUrl),
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
