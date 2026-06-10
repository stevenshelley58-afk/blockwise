import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  CUSTOMER_RESEARCH_AD_HISTORY_VIEW,
  RESEARCH_AD_SELECT,
  normaliseResearchAd,
  type ResearchAdListRow,
} from "@/lib/research/ad-library-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiWorkspace(request, "adstudio");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const { id } = await params;
  const { data: saved, error: savedError } = await supabase
    .from("research_saved_ads")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", access.workspaceId)
    .maybeSingle();

  if (savedError) return NextResponse.json({ error: savedError.message }, { status: 500 });
  if (!saved) return NextResponse.json({ error: "Saved ad not found." }, { status: 404 });

  const { data: row, error: adError } = await supabase
    .schema("research")
    .from(CUSTOMER_RESEARCH_AD_HISTORY_VIEW)
    .select(RESEARCH_AD_SELECT)
    .eq("observed_ad_id", saved.observed_ad_id)
    .maybeSingle();

  if (adError) return NextResponse.json({ error: adError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Research ad not found." }, { status: 404 });

  const ad = normaliseResearchAd(row as unknown as ResearchAdListRow);
  const inspiration = {
    source: "blockwise_research_swipe",
    savedAdId: id,
    observedAdId: ad.id,
    libraryId: ad.libraryId,
    pageName: ad.page.name,
    agencyName: ad.agency.name,
    headline: ad.creative.headline,
    body: ad.creative.body,
    cta: ad.creative.cta,
    adType: ad.creative.adType,
    primaryIntent: ad.creative.primaryIntent,
    hooks: ad.creative.hooks,
    media: ad.media.slice(0, 6),
    sourceUrl: ad.source.snapshotUrl,
  };

  const { data: updated, error: updateError } = await supabase
    .from("research_saved_ads")
    .update({
      handoff_status: "sent_to_adstudio",
      handoff_payload: inspiration,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", access.workspaceId)
    .select("*")
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ savedAd: updated, adStudioInspiration: inspiration });
}
