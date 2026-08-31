import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { makeEmailProvider } from "@/lib/email/provider";
import { drainEmailOutbox } from "@/lib/email/outbox";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Outbox delivery worker entry point. Invoked on a schedule (cron/worker)
 * with the internal HMAC headers (scope "email.drain"). Drains one batch of
 * due messages per call through the configured provider; the scheduler
 * should call this every minute so backoff windows are honoured.
 */
export async function POST(request: Request) {
  const auth = await verifyInternalRequest(request, "email.drain");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const service = createSupabaseServiceClient();
  const provider = makeEmailProvider(process.env);
  try {
    const summary = await drainEmailOutbox(service, provider, 25);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    console.error("[email-drain] batch failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "email_drain_failed" }, { status: 503 });
  }
}
