import { NextResponse } from "next/server";

import { queueScheduledMetaLeadSyncs } from "@/lib/providers/scheduled-maintenance";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = requireCron(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({
    ok: true,
    ...await queueScheduledMetaLeadSyncs(createSupabaseServiceClient()),
  });
}

function requireCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron secret is not configured" }, { status: 503 });
  return request.headers.get("authorization") === `Bearer ${secret}`
    ? null
    : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
