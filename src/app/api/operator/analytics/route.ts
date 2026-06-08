import { NextResponse } from "next/server";

import { summarizePageViews, type PageViewEvent } from "@/lib/analytics/summarize";
import { requireOperator } from "@/lib/operator/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const ALLOWED_RANGES = new Set([7, 30, 90]);
const MAX_ROWS = 100_000;

/** Operator-only aggregate view of first-party page analytics. */
export async function GET(request: Request) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") ?? "7");
  const days = ALLOWED_RANGES.has(requestedDays) ? requestedDays : 7;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("page_views")
    .select("occurred_at, path, referrer, visitor_hash, device, country")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: "analytics_query_failed" }, { status: 500 });
  }

  return NextResponse.json({
    days,
    since,
    ...summarizePageViews((data ?? []) as PageViewEvent[], days),
  });
}
