import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { recordEmailSuppression } from "@/lib/email/outbox";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Delivery-signal ingestion (bounces, complaints). Invoked by the mail
 * transport relay/Stalwart feedback forwarder with the internal HMAC headers
 * (scope "email.events"). Every accepted signal writes a suppression row so
 * the outbox worker stops retrying or re-sending to the address. Fail-closed:
 * a persistence error is a 503 so the relay retries rather than dropping the
 * signal silently.
 */
type EmailEvent = {
  type?: unknown;
  email?: unknown;
  messageId?: unknown;
  permanent?: unknown;
  source?: unknown;
};

function normalize(event: EmailEvent): { email: string; reason: "bounce" | "complaint"; source: string } | null {
  if (event.type !== "bounce" && event.type !== "complaint") return null;
  if (typeof event.email !== "string" || !event.email.includes("@")) return null;
  const source = typeof event.source === "string" && event.source.length > 0 ? event.source : "mail-relay";
  return { email: event.email, reason: event.type, source };
}

export async function POST(request: Request) {
  // Read once and authenticate the exact bytes that will be parsed below.
  const rawBody = await request.text();
  const auth = await verifyInternalRequest(request, "email.events", { body: rawBody });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawEvents = Array.isArray((body as { events?: unknown })?.events)
    ? ((body as { events: unknown[] }).events as EmailEvent[])
    : [];
  const events = rawEvents.map(normalize).filter((e): e is NonNullable<ReturnType<typeof normalize>> => e !== null);
  if (events.length === 0) {
    return NextResponse.json({ error: "no_valid_events" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  try {
    for (const event of events) {
      await recordEmailSuppression(service, event);
    }
  } catch (error) {
    console.error(
      "[email-events] suppression recording failed",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "suppression_record_failed" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, recorded: events.length });
}
