import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  CUSTOMER_RESEARCH_AD_HISTORY_VIEW,
  RESEARCH_AD_SELECT,
  normaliseResearchAd,
  type ResearchAdListRow,
} from "@/lib/research/ad-library-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  observedAdId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { data: savedRows, error } = await supabase
    .from("research_saved_ads")
    .select("*")
    .eq("workspace_id", access.access.workspaceId)
    .neq("handoff_status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const observedIds = (savedRows ?? []).map((row) => row.observed_ad_id).filter(Boolean);
  const ads = observedIds.length
    ? await loadAds(supabase, observedIds)
    : [];

  return NextResponse.json({
    savedAds: (savedRows ?? []).map((saved) => ({
      ...saved,
      ad: ads.find((ad) => ad.id === saved.observed_ad_id) ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const parsed = saveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const [adRows, creativeRows] = await Promise.all([
    loadAds(supabase, [parsed.data.observedAdId]),
    supabase
      .schema("research")
      .from("ad_creatives")
      .select("id")
      .eq("observed_ad_id", parsed.data.observedAdId)
      .maybeSingle(),
  ]);

  const ad = adRows[0];
  if (!ad) return NextResponse.json({ error: "Ad not found." }, { status: 404 });

  const { data, error } = await supabase
    .from("research_saved_ads")
    .upsert(
      {
        workspace_id: access.access.workspaceId,
        observed_ad_id: parsed.data.observedAdId,
        ad_creative_id: creativeRows.data?.id ?? null,
        note: parsed.data.note ?? null,
        source_snapshot_url: ad.source.snapshotUrl,
        created_by: access.access.userId,
        handoff_status: "saved",
      },
      { onConflict: "workspace_id,observed_ad_id" },
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ savedAd: data, ad }, { status: 201 });
}

async function loadAds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  observedIds: string[],
) {
  const { data } = await supabase
    .schema("research")
    .from(CUSTOMER_RESEARCH_AD_HISTORY_VIEW)
    .select(RESEARCH_AD_SELECT)
    .in("observed_ad_id", observedIds)
    .limit(200);

  return ((data ?? []) as unknown 