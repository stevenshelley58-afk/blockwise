import { NextResponse } from "next/server";

import { BookingWebhookError, verifyCalcomWebhook } from "./provider.ts";
import { parseSnagtimeWebhook, verifySnagtimeWebhook } from "./snagtime-contract.ts";
import { applyProviderBookingEvent, applyBookingWebhook, bookingEventId } from "./service.ts";

/**
 * Provider-aware webhook handlers. Cal.com and SnagTime deliveries arrive on
 * separate endpoints but converge on applyProviderBookingEvent, so legacy
 * Cal.com bookings keep rescheduling/cancelling after the SnagTime cutover.
 */

export async function handleCalcomBookingWebhook(request: Request): Promise<NextResponse> {
  const secret = process.env.CALCOM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Booking webhook credentials are not configured." },
      { status: 503 },
    );
  }
  const rawBody = await request.text();
  if (!verifyCalcomWebhook({
    rawBody,
    signature: request.headers.get("x-cal-signature-256"),
    secret,
  })) {
    return NextResponse.json({ error: "Invalid booking webhook signature." }, { status: 401 });
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid booking webhook JSON." }, { status: 400 });
  }
  const providerEventId = bookingEventId(
    rawBody,
    request.headers.get("x-cal-webhook-id") ?? request.headers.get("x-webhook-id"),
  );
  try {
    const result = await applyBookingWebhook({ raw, providerEventId });
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof BookingWebhookError && error.status === 202) {
      return NextResponse.json({ received: true, ignored: true }, { status: 202 });
    }
    console.error("Booking webhook failed", error);
    return NextResponse.json({ error: "Booking webhook failed." }, { status: 500 });
  }
}

export async function handleSnagtimeBookingWebhook(request: Request): Promise<NextResponse> {
  const secret = process.env.SNAGTIME_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "Booking webhook credentials are not configured." },
      { status: 503 },
    );
  }
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-snagtime-timestamp");
  if (!verifySnagtimeWebhook({
    rawBody,
    signature: request.headers.get("x-snagtime-signature"),
    timestamp,
    secret,
  })) {
    return NextResponse.json({ error: "Invalid booking webhook signature." }, { status: 401 });
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid booking webhook JSON." }, { status: 400 });
  }
  const providerEventId = bookingEventId(
    rawBody,
    request.headers.get("x-snagtime-event-id") ?? request.headers.get("x-webhook-id"),
  );
  try {
    const event = parseSnagtimeWebhook({ raw, providerEventId });
    const result = await applyProviderBookingEvent({ event });
    return NextResponse.json({ received: true, duplicate: result.duplicate });
  } catch (error) {
    if (error instanceof BookingWebhookError && error.status === 202) {
      return NextResponse.json({ received: true, ignored: true }, { status: 202 });
    }
    console.error("Booking webhook failed", error);
    return NextResponse.json({ error: "Booking webhook failed." }, { status: 500 });
  }
}
