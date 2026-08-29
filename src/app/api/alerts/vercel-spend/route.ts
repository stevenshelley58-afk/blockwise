import { NextResponse } from "next/server";

import { sendPaidServiceAlert } from "@/lib/alerts/notify";
import { verifyVercelSignature } from "@/lib/alerts/vercel-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Receives Vercel Spend Management webhooks (fired at 50%, 75% and 100% of the
 * configured spend amount — https://vercel.com/docs/spend-management) and fans
 * them out through the same email + WhatsApp channels as the watchdog.
 *
 * Configure in Vercel: Team Settings → Billing → Spend Management → Webhook,
 * pointing at https://<production-domain>/api/alerts/vercel-spend, and set
 * VERCEL_SPEND_WEBHOOK_SECRET to the secret shown when saving the webhook.
 */
type VercelSpendPayload = {
  budgetAmount?: number;
  currentSpend?: number;
  thresholdPercent?: number;
  teamId?: string;
};

export async function POST(request: Request) {
  const secret = process.env.VERCEL_SPEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyVercelSignature(rawBody, request.headers.get("x-vercel-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: VercelSpendPayload = {};
  try {
    payload = JSON.parse(rawBody) as VercelSpendPayload;
  } catch {
    // Alert anyway — a signed-but-unparseable payload still means a threshold fired.
  }

  const pct = payload.thresholdPercent ?? 0;
  const level = pct >= 100 ? "CRITICAL" : "WARN";
  const spend = payload.currentSpend != null ? `$${payload.currentSpend.toFixed(2)}` : "unknown";
  const budget = payload.budgetAmount != null ? `$${payload.budgetAmount.toFixed(2)}` : "unknown";

  await sendPaidServiceAlert({
    subject: `[Blockwise ${level}] Vercel spend at ${pct}%`,
    text: `Vercel Spend Management threshold hit.\n\n  • Spend: ${spend} of ${budget} (${pct}%)\n  • Team: ${payload.teamId ?? "unknown"}\n\nAt 100% Vercel may pause production deployments depending on your Spend Management settings — check the Vercel dashboard.`,
  });

  return NextResponse.json({ ok: true });
}
