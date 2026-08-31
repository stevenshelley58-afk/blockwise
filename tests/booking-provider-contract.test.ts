import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseSnagtimeWebhook,
  SNAGTIME_EVENT_SPEC,
  signSnagtimePayload,
  verifySnagtimeWebhook,
} from "../src/lib/booking/snagtime-contract.ts";
import { BookingWebhookError } from "../src/lib/booking/provider.ts";

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
    assert.equal(event.scheduledStartAt, "2026-09-02T09:00:00.000Z");
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
  });

  it("converges both providers through the shared event application path", () => {
    assert.match(handlers, /applyProviderBookingEvent/);
    assert.match(handlers, /applyBookingWebhook/);
    assert.match(service, /applyProviderBookingEvent/);
    assert.match(service, /type ProviderBookingEvent/);
  });
});
