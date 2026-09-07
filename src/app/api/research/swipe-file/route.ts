import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { featureDisabledResponse, requireApiWorkspace } from "@/lib/auth/api-guards";
import { fetchAdDbAd } from "@/lib/research/ad-db-client";
import { mapAdDbRowToCustomerMetaCard } from "@/lib/research/ad-db-card-mapper";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const saveSchema = z.object({
  observedAdId: z.string().uuid(),
  note: z.string().max(1000).optional(),
});

export async function GET(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const { data: savedRows, error } = await supabase
    .from("research_saved_ads")
    .select("*")
    .eq("workspace_id", access.workspaceId)
    .neq("handoff_status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const observedIds = (savedRows ?? []).map((row) => row.observed_ad_id).filter(Boolean);
  let ads: Awaited<ReturnType<typeof loadAds>> = [];
  try {
    ads = observedIds.length ? await loadAds(observedIds) : [];
  } catch {
    return NextResponse.json({ error: "Ad DB is unavailable." }, { status: 502 });
  }

  return NextResponse.json({
    savedAds: (savedRows ?? []).map((saved) => ({
      id: saved.id,
      observedAdId: saved.observed_ad_id,
      notes: saved.note,
      status: saved.status,
      createdAt: saved.created_at,
      ad: ads.find((ad) => ad.id === saved.observed_ad_id) ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const featureGate = featureDisabledResponse("adRadar");
  if (featureGate) return featureGate;

  const guard = await requireApiWorkspace(request, "monitor");
  if (!guard.ok) return guard.response;
  const { supabase, access } = guard;

  const parsed = saveSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  let adRows: Awaited<ReturnType<typeof loadAds>> = [];
  try {
    adRows = await loadAds([parsed.data.observedAdId]);
  } catch {
    return NextResponse.json({ error: "Ad DB is unavailable." }, { status: 502 });
  }
  const ad = adRows[0];
  if (!ad) return NextResponse.json({ error: "Ad not found." }, { status: 404 });

  const { data, error } = await supabase
    .from("research_saved_ads")
    .upsert(
      {
        workspace_id: access.workspaceId,
        observed_ad_id: parsed.data.observedAdId,
        ad_creative_id: null,
        note: parsed.data.note ?? null,
        source_snapshot_url: ad.libraryId
          ? "https://www.facebook.com/ads/library/?id=" + encodeURIComponent(ad.libraryId)
          : null,
        created_by: access.userId,
        handoff_status: "saved",
      },
      { onConflict: "workspace_id,observed_ad_id" },
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    savedAd: data
      ? {
          id: data.id,
          observedAdId: data.observed_ad_id,
          notes: data.note,
          status: data.status,
          createdAt: data.created_at,
        }
      : null,
    ad,
  }, { status: 201 });
}

async function loadAds(observedIds: string[]) {
  if (observedIds.length === 0) return [];
  const rows = await Promise.all(observedIds.map((id) => fetchAdDbAd(id)));
  return rows
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .map(mapAdDbRowToCustomerMetaCard);
}
