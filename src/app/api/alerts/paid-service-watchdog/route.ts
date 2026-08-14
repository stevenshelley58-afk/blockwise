import { NextResponse } from "next/server";

import { runPaidServiceWatchdog } from "@/lib/alerts/paid-service-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json({ error: "cron secret is not configured" }, { status: 503 });
  }

  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The private research API is retired with the operator research console
  // (BW-D2). The watchdog keeps the provider/VPS checks and skips the
  // research-schema ones (Apify spend + state persistence).
  const result = await runPaidServiceWatchdog(null);
  return NextResponse.json({ ok: true, ...result });
}
