import { NextResponse } from "next/server";

import { runScheduledMetaPublishWatchdog } from "@/lib/providers/scheduled-maintenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron secret is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runScheduledMetaPublishWatchdog();
  return NextResponse.json({ ok: true, ...result });
}
