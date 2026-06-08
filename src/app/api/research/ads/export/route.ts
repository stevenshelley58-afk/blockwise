import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  CUSTOMER_RESEARCH_AD_HISTORY_VIEW,
  RESEARCH_AD_SELECT,
  normaliseResearchAd,
  researchAdsToCsv,
  type ResearchAdListRow,
} from "@/lib/research/ad-library-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length === 0) {
    return NextResponse.json({ error: "At least one ad id is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .schema("research")
    .from(CUSTOMER_RESEARCH_AD_HISTORY_VIEW)
    .select(RESEARCH_AD_SELECT)
    .in("observed_ad_id", ids)
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ads = ((data ?? []) as unknown as ResearchAdListRow[]).map(normaliseResearchAd);
  const format = request.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  if (format === "csv") {
    return new NextResponse(researchAdsToCsv(ads), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=blockwise-research-ads.csv",
      },
    });
  }

  return NextResponse.json({ ads });
}
