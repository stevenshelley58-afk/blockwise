import { NextResponse } from "next/server";
import { verifiedResendSuppressions } from "@/lib/email/resend-webhook";
import { recordEmailSuppression } from "@/lib/email/outbox";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  const payload = await request.text();
  if (payload.length > 100_000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let events;
  try {
    events = verifiedResendSuppressions(payload, {
      id: request.headers.get("svix-id") ?? "",
      timestamp: request.headers.get("svix-timestamp") ?? "",
      signature: request.headers.get("svix-signature") ?? "",
    }, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (!events.length) return NextResponse.json({ ok: true, recorded: 0 });
  try {
    const service = createSupabaseServiceClient();
    for (const event of events) await recordEmailSuppression(service, event);
  } catch {
    // Retry on persistence failure. Never log payloads or personal information.
    return NextResponse.json({ error: "suppression_record_failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, recorded: events.length });
}
