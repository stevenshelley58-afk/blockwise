import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseSnagtimeWebhook,
  resolveSnagtimeEventId,
  SNAGTIME_EVENT_SPEC,
  signSnagtimePayload,
  verifySnagtimeWebhook,
} from "../src/lib/booking/snagtime-contract.ts";
import { BookingConfigurationError, BookingWebhookError, buildHostedBookingUrl, getBookingProviderReadiness, resolveBookingProvider, signBookingInvitation } from "../src/lib/booking/provider.ts";
import { isOutOfOrderEvent } from "../src/lib/booking/service.ts";

const SECRET = "test-snagtime-webhook-secret";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    spec: SNAGTIME_EVENT_SPEC,
    id: "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0",
    type: "booking.created",
    occurredAt: "2026-08-31T04:00:00.000Z",
    data: {
      booking: {
        uid: "bk_123",
        eventTypeId: 7,
        startTime: "2026-09-02T09:00:00.000Z",
        endTime: "2026-09-02T09:30:00.000Z",
        rescheduleUrl: "https://book.blockwise.sale/reschedule/bk_123",
      },
      invitation: "inv-uuid.sig",
      attendee: { email: "customer@example.com", name: "Customer" },
    },
    ...overrides,
  };
}

function signedRequestParts(raw: string, timestampSeconds: number, secret = SECRET) {
  return { signature: `sha256=${signSnagtimePayload({ rawBody: raw, timestamp: timestampSeconds, secret })}`, timestamp: String(timestampSeconds) };
}

describe("snagtime event contract", () => {
  const now = new Date("2026-08-31T04:00:00.000Z");

  it("verifies correct signatures and rejects tampering, staleness and replay-window violations", () => {
    const raw = JSON.stringify(envelope());
    const good = signedRequestParts(raw, Math.floor(now.getTime() / 1000));
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, ...good, secret: SECRET, now }), true);

    // Tampered body
    assert.equal(
      verifySnagtimeWebhook({ rawBody: raw + " ", ...good, secret: SECRET, now }),
      false,
    );
    // Wrong secret
    assert.equal(
      verifySnagtimeWebhook({ rawBody: raw, ...signedRequestParts(raw, Math.floor(now.getTime() / 1000), "other"), secret: SECRET, now }),
      false,
    );
    // Stale timestamp (outside replay window)
    const stale = signedRequestParts(raw, Math.floor(now.getTime() / 1000) - 3600);
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, ...stale, secret: SECRET, now }), false);
    // Missing pieces
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, signature: null, timestamp: good.timestamp, secret: SECRET, now }), false);
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, ...good, secret: null, now }), false);
  });

  it("parses a created event into a provider-neutral snagtime booking event", () => {
    const event = parseSnagtimeWebhook({ raw: envelope(), providerEventId: "evt-1" });
    assert.equal(event.provider, "snagtime");
    assert.equal(event.providerBookingId, "bk_123");
    assert.equal(event.trigger, "BOOKING_CREATED");
    assert.equal(event.state, "booked");
    assert.equal(event.invitationToken, "inv-uuid.sig");
    assert.equal(event.customerEmail, "customer@example.com");
    assert.equal(event.providerEventTypeId, "7");
    assert.equal(event.scheduledStartAt, "2026-09-02T09:00:00.000Z");
  });

  it("accepts SnagTime CUID event type IDs and normalizes them to strings", () => {
    const raw = envelope();
    ((raw.data as Record<string, unknown>).booking as Record<string, unknown>).eventTypeId = "evt_cuid_123";
    const event = parseSnagtimeWebhook({ raw, providerEventId: "evt-cuid" });
    assert.equal(event.providerEventTypeId, "evt_cuid_123");

    for (const eventTypeId of ["", ` ${"x".repeat(129)} `, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      ((raw.data as Record<string, unknown>).booking as Record<string, unknown>).eventTypeId = eventTypeId;
      assert.throws(() => parseSnagtimeWebhook({ raw, providerEventId: "evt-invalid-type" }), BookingWebhookError);
    }
  });

  it("maps rescheduled and cancelled events, and rejects unsupported types without failing the delivery", () => {
    const rescheduled = parseSnagtimeWebhook({ raw: envelope({ type: "booking.rescheduled" }), providerEventId: "e2" });
    assert.equal(rescheduled.state, "rescheduled");
    const cancelled = parseSnagtimeWebhook({ raw: envelope({ type: "booking.cancelled" }), providerEventId: "e3" });
    assert.equal(cancelled.state, "cancelled");
    assert.throws(
      () => parseSnagtimeWebhook({ raw: envelope({ type: "meeting.ended" }), providerEventId: "e4" }),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 202,
    );
    assert.throws(
      () => parseSnagtimeWebhook({ raw: envelope({ spec: "other.spec.v9" }), providerEventId: "e5" }),
      BookingWebhookError,
    );
  });

  it("requires a booking identifier", () => {
    const raw = envelope();
    (raw.data as Record<string, unknown>).booking = {};
    assert.throws(
      () => parseSnagtimeWebhook({ raw, providerEventId: "e6" }),
      BookingWebhookError,
    );
  });

  it("rejects schema drift and non-canonical timestamps before application", () => {
    assert.throws(
      () => parseSnagtimeWebhook({ raw: envelope({ extra: true }), providerEventId: "e7" }),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 400,
    );
    assert.throws(
      () => parseSnagtimeWebhook({ raw: envelope({ occurredAt: "2026-08-31T04:00:00+00:00" }), providerEventId: "e8" }),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 400,
    );
    assert.throws(
      () => parseSnagtimeWebhook({ raw: envelope({ occurredAt: "2026-02-30T04:00:00.000Z" }), providerEventId: "e9" }),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 400,
    );
    const raw = JSON.stringify(envelope());
    const signed = signedRequestParts(raw, 1725076800);
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, ...signed, secret: SECRET, now: new Date("2026-08-31T00:00:00.000Z") }), false);
    assert.equal(verifySnagtimeWebhook({ rawBody: raw, signature: signed.signature, timestamp: "1725076800.5", secret: SECRET, now: new Date("2024-08-31T00:00:00.000Z") }), false);
  });
});

describe("out-of-order event protection", () => {
  const existing = {
    booked_at: "2026-08-31T04:00:00.000Z",
    cancelled_at: null,
    completed_at: null,
  };

  it("treats an event older than the latest transition as stale", () => {
    assert.equal(isOutOfOrderEvent(existing, "2026-08-31T03:59:00.000Z"), true);
    assert.equal(isOutOfOrderEvent(existing, "2026-08-31T04:00:00.000Z"), true);
  });

  it("applies events that are newer than every recorded transition", () => {
    assert.equal(isOutOfOrderEvent(existing, "2026-08-31T05:00:00.000Z"), false);
    assert.equal(
      isOutOfOrderEvent({ booked_at: null, cancelled_at: null, completed_at: null }, "2026-08-31T04:00:00.000Z"),
      false,
    );
  });

  it("treats a stale event as stale against a recorded cancellation", () => {
    assert.equal(
      isOutOfOrderEvent(
        { booked_at: "2026-08-31T04:00:00.000Z", cancelled_at: "2026-08-31T06:00:00.000Z", completed_at: null },
        "2026-08-31T05:00:00.000Z",
      ),
      true,
    );
  });
});

describe("snagtime event identity", () => {
  const ENVELOPE_ID = "6a2f0a44-2df2-4d63-9d1e-6a30ec5f51f0";

  it("uses the HMAC-covered envelope id as the immutable event id", () => {
    assert.equal(resolveSnagtimeEventId(envelope(), null), ENVELOPE_ID);
    assert.equal(resolveSnagtimeEventId(envelope(), ` ${ENVELOPE_ID} `), ENVELOPE_ID);
  });

  it("rejects an envelope without a valid event id", () => {
    assert.throws(
      () => resolveSnagtimeEventId(envelope({ id: "" }), null),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 400,
    );
    assert.throws(
      () => resolveSnagtimeEventId(envelope({ id: "attacker-chosen-id" }), null),
      BookingWebhookError,
    );
  });

  it("rejects a replay that swaps the transport event-id header", () => {
    // A captured signed body replayed with a different event id header must
    // not be processed under the attacker's identity.
    assert.throws(
      () => resolveSnagtimeEventId(envelope(), "00000000-0000-4000-8000-000000000009"),
      (error: unknown) => error instanceof BookingWebhookError && error.status === 400,
    );
  });
});

describe("provider-aware invitations", () => {
  const INVITATION_SECRET = "test-booking-invitation-secret";

  it("requires an explicit allowlisted provider", () => {
    assert.equal(resolveBookingProvider({ BOOKING_PROVIDER: "snagtime" } as unknown as NodeJS.ProcessEnv), "snagtime");
    assert.equal(resolveBookingProvider({ BOOKING_PROVIDER: "calcom" } as unknown as NodeJS.ProcessEnv), "calcom");
    assert.throws(() => resolveBookingProvider({} as unknown as NodeJS.ProcessEnv), BookingConfigurationError);
    assert.throws(() => resolveBookingProvider({ BOOKING_PROVIDER: "other" } as unknown as NodeJS.ProcessEnv), BookingConfigurationError);
  });

  it("reports provider-specific readiness and fails closed for missing selection", () => {
    assert.deepEqual(getBookingProviderReadiness({} as unknown as NodeJS.ProcessEnv), {
      provider: null,
      ok: false,
      missing: ["BOOKING_PROVIDER"],
      invalid: [],
    });
    const ready = getBookingProviderReadiness({
      BOOKING_PROVIDER: "snagtime",
      SNAGTIME_BASE_URL: "https://book.blockwise.sale",
      SNAGTIME_WEBHOOK_SECRET: "webhook-secret",
      BOOKING_INVITATION_SECRET: "invitation-secret",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(ready.ok, true);
  });

  it("builds snagtime invitation URLs from SNAGTIME_BASE_URL with the signed token", () => {
    const url = new URL(buildHostedBookingUrl({
      market: "AU",
      invitationId: "d1000000-0000-4000-8000-00000000000a",
      provider: "snagtime",
      env: {
        SNAGTIME_BASE_URL: "https://book.blockwise.sale/onboarding",
        BOOKING_INVITATION_SECRET: INVITATION_SECRET,
      } as unknown as NodeJS.ProcessEnv,
    }));
    assert.equal(url.origin + url.pathname, "https://book.blockwise.sale/onboarding");
    assert.equal(url.searchParams.get("market"), "AU");
    const token = url.searchParams.get("invitation") ?? "";
    assert.equal(
      token,
      signBookingInvitation("d1000000-0000-4000-8000-00000000000a", { BOOKING_INVITATION_SECRET: INVITATION_SECRET } as unknown as NodeJS.ProcessEnv),
    );
  });

  it("fails closed when the snagtime base URL is missing for a snagtime invitation", () => {
    assert.throws(
      () => buildHostedBookingUrl({
        market: "AU",
        invitationId: "d1000000-0000-4000-8000-00000000000a",
        provider: "snagtime",
        env: {} as unknown as NodeJS.ProcessEnv,
      }),
      BookingConfigurationError,
    );
  });

  it("still builds the legacy calcom invitation path when the fork is not configured", () => {
    const url = new URL(buildHostedBookingUrl({
      market: "AU",
      invitationId: "d1000000-0000-4000-8000-00000000000a",
      provider: "calcom",
      env: {
        CALCOM_ONBOARDING_URL_AU: "https://cal.com/blockwise/onboarding-au",
        BOOKING_INVITATION_SECRET: INVITATION_SECRET,
      } as unknown as NodeJS.ProcessEnv,
    }));
    assert.equal(url.host, "cal.com");
    assert.match(url.searchParams.get("metadata[invitation") ?? url.toString(), /d1000000/);
  });
});

describe("dual provider webhook coexistence contract", () => {
  const legacy = readFileSync("src/app/api/booking/webhook/route.ts", "utf8");
  const calcomRoute = readFileSync("src/app/api/booking/webhooks/calcom/route.ts", "utf8");
  const snagtimeRoute = readFileSync("src/app/api/booking/webhooks/snagtime/route.ts", "utf8");
  const handlers = readFileSync("src/lib/booking/webhook-handlers.ts", "utf8");
  const service = readFileSync("src/lib/booking/service.ts", "utf8");

  it("keeps the legacy Cal.com endpoint operational", () => {
    assert.match(legacy, /verifyCalcomWebhook/);
    assert.match(legacy, /CALCOM_WEBHOOK_SECRET/);
  });

  it("serves calcom and snagtime on separate provider endpoints", () => {
    assert.match(calcomRoute, /handleCalcomBookingWebhook/);
    assert.match(snagtimeRoute, /handleSnagtimeBookingWebhook/);
    assert.match(handlers, /SNAGTIME_WEBHOOK_SECRET/);
    assert.match(handlers, /x-snagtime-signature/);
    // The event identity must come from the HMAC-covered envelope, not the
    // replayable transport header.
    assert.match(handlers, /resolveSnagtimeEventId/);
  });

  it("creates invitations provider-aware and guards against out-of-order events", () => {
    assert.match(service, /resolveBookingProvider\(\)/);
    assert.doesNotMatch(service, /provider: "calcom"/);
    assert.match(service, /isOutOfOrderEvent/);
  });

  it("converges both providers through the shared event application path", () => {
    assert.match(handlers, /applyProviderBookingEvent/);
    assert.match(handlers, /applyBookingWebhook/);
    assert.match(service, /applyProviderBookingEvent/);
    assert.match(service, /type ProviderBookingEvent/);
  });
});
