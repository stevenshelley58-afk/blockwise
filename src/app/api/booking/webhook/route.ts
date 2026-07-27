import { NextResponse } from "next/server";

import { BookingWebhookError, verifyCalcomWebhook } from "@/lib/booking/provider";
import { applyBookingWebhook, bookingEventId } from "@/lib/booking/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
