import { NextResponse } from "next/server";

import { verifyInternalRequest } from "@/lib/internal-auth";
import { isEmailDeliveryEnabled, makeEmailProvider } from "@/lib/email/provider";
import { drainEmailOutbox, recoverPendingLeadWelcomeEmails } from "@/lib/email/outbox";
import { recoverMissingTrialReminders } from "@/lib/billing/trial-reminder";
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

  // A healthy scheduler may run before launch, but it must not claim rows or
  // rebuild welcome mail until the operator explicitly opens this gate.
  if (!isEmailDeliveryEnabled(process.env)) {
    return NextResponse.json({
      ok: true,
      deliveryEnabled: false,
      recovery: { scanned: 0, queued: 0, failed: 0 },
      trialReminders: { scanned: 0, queued: 0, failed: 0 },
      claimed: 0,
      sent: 0,
      suppressed: 0,
      failed: 0,
      dead: 0,
    });
  }

  const service = createSupabaseServiceClient();
  try {
    const provider = makeEmailProvider(process.env);
    const recovery = await recoverPendingLeadWelcomeEmails(service, 100);
    // The single producer for day-six trial reminders. Runs before the drain so
    // a reminder whose trial end moved is superseded in the same pass, and
    // doubles as the catch-up scan after downtime. A failure here must not stop
    // the rest of the outbox from draining.
    let trialReminders = { scanned: 0, queued: 0, failed: 0 };
    try {
      trialReminders = await recoverMissingTrialReminders(service, 50);
    } catch (reminderError) {
      console.error(
        "[email-drain] trial reminder recovery failed",
        reminderError instanceof Error ? reminderError.message : reminderError,
      );
    }
    const summary = await drainEmailOutbox(service, provider, 25);
    return NextResponse.json({ ok: true, recovery, trialReminders, ...summary });
  } catch (error) {
    console.error("[email-drain] batch failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "email_drain_failed" }, { status: 503 });
  }
}
