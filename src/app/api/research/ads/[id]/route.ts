import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { RESEARCH_AD_SELECT, normaliseResearchAd, type ResearchAdListRow } from "@/lib/research/ad-library-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RESEARCH_AD_SELECT)
    .eq("observed_ad_id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Ad not found." }, { status: 404 });

  const ad = normaliseResearchAd(data as unknown as ResearchAdListRow);
  const { data: versions } = await supabase
    .schema("research")
    .from("ad_creative_versions")
    .select("version,creative_hash,format,headline,body,cta,created_at,diff")
    .eq("observed_ad_id", id)
    .order("version", { ascending: false })
    .limit(20);

  return NextResponse.json({
    ad,
    versions: versions ?? [],
  });
}
