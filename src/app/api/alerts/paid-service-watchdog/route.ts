import { NextResponse } from "next/server";

import { runPaidServiceWatchdog } from "@/lib/alerts/paid-service-runner";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret) {
    return NextResponse.json({ error: "cron secret is not configured" }, { status: 503 });
  }

  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runPaidServiceWatchdog(createSupabaseServiceClient());
  return NextResponse.json({ ok: true, ...result });
}
