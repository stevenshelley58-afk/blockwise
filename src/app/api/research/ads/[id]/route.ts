import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  CUSTOMER_RESEARCH_AD_HISTORY_VIEW,
  RESEARCH_AD_SELECT,
  normaliseResearchAd,
  type ResearchAdListRow,
} from "@/lib/research/ad-library-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const { id } = await params;
  const { data, error } = await supabase
    .schema("research")
    .from(CUSTOMER_RESEARCH_AD_HISTORY_VIEW)
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
