import { createHmac, timingSafeEqual } from "node:crypto";

import { hasBookingSecret } from "./secret.ts";

export type BookingProvider = "calcom" | "snagtime";
export type BookingMarket = "US" | "AU";
export type BookingState = "link_sent" | "booked" | "rescheduled" | "cancelled" | "completed" | "failed";

export type ProviderBookingEvent = {
  provider: BookingProvider;
  providerEventId: string;
  providerBookingId: string;
  providerEventTypeId: string | null;
  trigger:
    | "BOOKING_CREATED"
    | "BOOKING_RESCHEDULED"
    | "BOOKING_CANCELLED"
    | "MEETING_ENDED";
  state: BookingState;
  occurredAt: string;
  invitationToken: string | null;
  customerEmail: string | null;
  customerName: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  rescheduleUrl: string | null;
  raw: Record<string, unknown>;
};

export class BookingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingConfigurationError";
  }
}

export class BookingWebhookError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BookingWebhookError";
    this.status = status;
  }
}

export function normalizeBookingMarket(value: string | null | undefined): BookingMarket {
  return value?.trim().toUpperCase() === "US" ? "US" : "AU";
}

export function getHostedBookingUrl(
  market: BookingMarket,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = market === "US" ? env.CALCOM_ONBOARDING_URL_US : env.CALCOM_ONBOARDING_URL_AU;
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Provider selection is explicit; the legacy Cal.com route remains available
 * regardless of which provider owns newly-created invitations. */
export function resolveBookingProvider(env: NodeJS.ProcessEnv = process.env): BookingProvider {
  const configured = env.BOOKING_PROVIDER?.trim().toLowerCase();
  // Provider selection is explicit. This prevents a partially provisioned
  // host from silently switching booking systems based on URL presence.
  if (!configured) throw new BookingConfigurationError("BOOKING_PROVIDER must be explicitly set to calcom or snagtime.");
  if (configured === "calcom" || configured === "snagtime") return configured;
  throw new BookingConfigurationError("BOOKING_PROVIDER must be calcom or snagtime.");
}

function getSnagtimeBookingUrl(env: NodeJS.ProcessEnv): string | null {
  const base = env.SNAGTIME_BASE_URL?.trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getBookingProviderReadiness(env: NodeJS.ProcessEnv = process.env): {
  provider: BookingProvider | null;
  ok: boolean;
  missing: string[];
  invalid: string[];
} {
  let provider: BookingProvider;
  try {
    provider = resolveBookingProvider(env);
  } catch {
    return {
      provider: null,
      ok: false,
      missing: env.BOOKING_PROVIDER?.trim() ? [] : ["BOOKING_PROVIDER"],
      invalid: env.BOOKING_PROVIDER?.trim() ? ["BOOKING_PROVIDER"] : [],
    };
  }
  const missing: string[] = [];
  const invalid: string[] = [];
  if (!env.BOOKING_INVITATION_SECRET?.trim()) missing.push("BOOKING_INVITATION_SECRET");
  if (provider === "snagtime") {
    if (!env.SNAGTIME_BASE_URL?.trim()) missing.push("SNAGTIME_BASE_URL");
    else if (!getSnagtimeBookingUrl(env)) invalid.push("SNAGTIME_BASE_URL");
    if (!hasBookingSecret(env, "SNAGTIME_WEBHOOK_SECRET", "SNAGTIME_WEBHOOK_SECRET_FILE")) missing.push("SNAGTIME_WEBHOOK_SECRET");
  } else {
    for (const key of ["CALCOM_ONBOARDING_URL_US", "CALCOM_ONBOARDING_URL_AU"] as const) {
      if (!env[key]?.trim()) missing.push(key);
      else if (!getHostedBookingUrl(key.endsWith("US") ? "US" : "AU", env)) invalid.push(key);
    }
    if (!hasBookingSecret(env, "CALCOM_WEBHOOK_SECRET", "CALCOM_WEBHOOK_SECRET_FILE")) missing.push("CALCOM_WEBHOOK_SECRET");
  }
  return { provider, ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export function buildHostedBookingUrl(input: {
  market: BookingMarket;
  invitationId: string;
  provider?: BookingProvider;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = input.env ?? process.env;
  const provider = input.provider ?? resolveBookingProvider(env);
  if (provider === "snagtime") {
    const base = getSnagtimeBookingUrl(env);
    if (!base) {
      throw new BookingConfigurationError("The SnagTime booking base URL is not configured.");
    }
    const url = new URL(base);
    const invitationToken = signBookingInvitation(input.invitationId, env);
    url.searchParams.set("invitation", invitationToken);
    url.searchParams.set("market", input.market);
    url.searchParams.set("utm_source", "blockwise");
    url.searchParams.set("utm_medium", "product");
    url.searchParams.set("utm_campaign", "onboarding");
    return url.toString();
  }
  const configured = getHostedBookingUrl(input.market, env);
  if (!configured) {
    throw new BookingConfigurationError(`The ${input.market} onboarding booking URL is not configured.`);
  }
  const url = new URL(configured);
  const invitationToken = signBookingInvitation(input.invitationId, env);
  url.searchParams.set("utm_source", "blockwise");
  url.searchParams.set("utm_medium", "product");
  url.searchParams.set("utm_campaign", "onboarding");
  url.searchParams.set("metadata[invitation]", invitationToken);
  return url.toString();
}

export function signBookingInvitation(
  invitationId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.BOOKING_INVITATION_SECRET?.trim();
  if (!secret) throw new BookingConfigurationError("The booking invitation signing secret is not configured.");
  if (!isUuid(invitationId)) throw new BookingConfigurationError("Booking invitation ID is invalid.");
  const signature = createHmac("sha256", secret).update(invitationId).digest("hex");
  return `${invitationId}.${signature}`;
}

export function verifyBookingInvitationToken(
  token: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = env.BOOKING_INVITATION_SECRET?.trim();
  if (!secret || !token) return null;
  const [invitationId, received, extra] = token.split(".");
  if (extra || !invitationId || !received || !isUuid(invitationId) || !/^[a-f0-9]{64}$/i.test(received)) {
    return null;
  }
  const expected = createHmac("sha256", secret).update(invitationId).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex")) ? invitationId : null;
}

export function verifyCalcomWebhook(input: {
  rawBody: string;
  signature: string | null;
  secret?: string | null;
}): boolean {
  const secret = input.secret?.trim();
  if (!secret || !input.signature) return false;
  const expected = createHmac("sha256", secret).update(input.rawBody).digest("hex");
  const received = input.signature.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export function parseCalcomWebhook(input: {
  raw: Record<string, unknown>;
  providerEventId: string;
}): ProviderBookingEvent {
  assertRecord(input.raw, "Booking webhook body must be a JSON object.");
  const trigger = stringValue(input.raw.triggerEvent);
  if (!isSupportedTrigger(trigger)) {
    throw new BookingWebhookError("Unsupported booking webhook event.", 202);
  }
  const payload = recordValue(input.raw.payload) ?? input.raw;
  const providerBookingId =
    stringValue(payload.uid) ??
    stringValue(payload.bookingUid) ??
    stringValue(recordValue(payload.booking)?.uid);
  if (!providerBookingId) {
    throw new BookingWebhookError("Booking webhook is missing a booking identifier.");
  }
  const attendee = Array.isArray(payload.attendees)
    ? recordValue(payload.attendees[0])
    : null;
  const metadata = recordValue(payload.metadata);
  const occurredAt = stringValue(input.raw.createdAt) ?? new Date().toISOString();

  return {
    provider: "calcom",
    providerEventId: input.providerEventId,
    providerBookingId,
    providerEventTypeId: stringValue(payload.eventTypeId),
    trigger,
    state: stateForTrigger(trigger),
    occurredAt,
    invitationToken: stringValue(metadata?.invitation),
    customerEmail: stringValue(attendee?.email),
    customerName: stringValue(attendee?.name),
    scheduledStartAt: stringValue(payload.startTime),
    scheduledEndAt: stringValue(payload.endTime),
    rescheduleUrl:
      stringValue(payload.rescheduleUrl) ??
      stringValue(payload.rescheduleLink) ??
      stringValue(payload.bookerUrl),
    raw: input.raw,
  };
}

function isSupportedTrigger(value: string | null): value is ProviderBookingEvent["trigger"] {
  return ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED", "MEETING_ENDED"].includes(value ?? "");
}

function stateForTrigger(trigger: ProviderBookingEvent["trigger"]): BookingState {
  if (trigger === "BOOKING_CREATED") return "booked";
  if (trigger === "BOOKING_RESCHEDULED") return "rescheduled";
  if (trigger === "BOOKING_CANCELLED") return "cancelled";
  return "completed";
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingWebhookError(message, 400);
  }
}
