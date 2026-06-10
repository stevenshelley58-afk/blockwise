import { NextResponse, type NextRequest } from "next/server";

import { requireApiWorkspace } from "@/lib/auth/api-guards";
import {
  CUSTOMER_RESEARCH_AD_HISTORY_VIEW,
  RESEARCH_AD_SELECT,
  normaliseResearchAd,
  type ResearchAdListRow,
} from "@/lib/research/ad-library-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AreaCardIdRow = {
  card_id: string | null;
};

export async function GET(request: NextRequest) {
  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase } = guard;

  const params = request.nextUrl.searchParams;
  const limit = Math.min(Number.parseInt(params.get("limit") ?? "80", 10) || 80, 200);
  const areaIds = await loadAreaFilteredIds(supabase, {
    postcode: params.get("postcode"),
    suburb: params.get("suburb"),
  });

  let query = supabase
    .schema("research")
    .from(CUSTOMER_RESEARCH_AD_HISTORY_VIEW)
    .select(RESEARCH_AD_SELECT)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(limit, areaIds ? Math.min(areaIds.length, 1000) : limit));

  if (params.get("activeStatus")) query = query.eq("active_status", params.get("activeStatus"));
  if (params.get("platform")) query = query.eq("platform", params.get("platform"));
  if (params.get("pageId")) query = query.eq("advertiser_page_id", params.get("pageId"));
  if (params.get("agencyId")) query = query.eq("agency_id", params.get("agencyId"));
  if (params.get("classification")) {
    const classification = params.get("classification");
    query = query.or(`ad_type.eq.${classification},primary_intent.eq.${classification}`);
  }
  if (areaIds) {
    if (areaIds.length === 0) return NextResponse.json({ ads: [] });
    query = query.in("observed_ad_id", areaIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const q = params.get("q")?.trim().toLowerCase();
  const ads = ((data ?? []) as unknown as ResearchAdListRow[])
    .map(normaliseResearchAd)
    .filter((ad) => !q || adMatches(ad, q))
    .slice(0, limit);

  return NextResponse.json({ ads });
}

async function loadAreaFilteredIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: { postcode: string | null; suburb: string | null },
): Promise<string[] | null> {
  if (!input.postcode && !input.suburb) return null;

  const loadIds = async (applyFilter: (query: any) => any) => {
    let query = supabase
      .schema("research")
      .from("v_customer_meta_ad_library_cards")
      .select("card_id")
      .limit(1000);

    if (input.suburb) query = query.ilike("suburb", `%${input.suburb}%`);
    const { data, error } = await applyFilter(query);
    if (error) return [];
    return ((data ?? []) as AreaCardIdRow[]).map((row) => row.card_id).filter((id): id is string => Boolean(id));
  };

  const batches = input.postcode
    ? await Promise.all([
        loadIds((query) => query.eq("postcode", input.postcode)),
        loadIds((query) => query.overlaps("postcodes", [input.postcode])),
      ])
    : [await loadIds((query) => query)];

  return [...new Set(batches.flat())];
}

function adMatches(ad: ReturnType<typeof normaliseResearchAd>, q: string): boolean {
  return [
    ad.libraryId,
    ad.page.name,
    ad.agent.name,
    ad.agency.name,
    ad.status.active,
    ad.creative.headline,
    ad.creative.body,
    ad.creative.cta,
    ad.creative.adType,
    ad.creative.primaryIntent,
    ...ad.creative.hooks,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}
