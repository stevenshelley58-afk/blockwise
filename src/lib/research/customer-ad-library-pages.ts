import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { fetchAdDbAd, searchAdDbAds } from "./ad-db-client.ts";
import { mapAdDbRowToCustomerMetaCard } from "./ad-db-card-mapper.ts";
import type { AdDbRow } from "./ad-db.ts";
import type { ResearchAdApiRecord } from "./ad-library-api.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type CustomerCreativeVersion = {
  id: string;
  version: number;
  creativeHash: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  adType: string | null;
  primaryIntent: string | null;
  displayState: string | null;
  createdAt: string;
};

export type CustomerSavedResearchAd = {
  id: string;
  observedAdId: string;
  note: string | null;
  sourceSnapshotUrl: string | null;
  handoffStatus: string;
  createdAt: string;
  updatedAt: string;
};

export async function loadCustomerResearchAdDetail(
  adId: string,
): Promise<{ ad: ResearchAdApiRecord | null; versions: CustomerCreativeVersion[]; error: string | null }> {
  try {
    const row = await fetchAdDbAd(adId);
    return { ad: row ? toResearchAd(row) : null, versions: [], error: null };
  } catch {
    return { ad: null, versions: [], error: "Ad DB request failed." };
  }
}

export async function loadCustomerAdvertiserAds(
  advertiserPageId: string,
): Promise<{ ads: ResearchAdApiRecord[]; error: string | null }> {
  try {
    const result = await searchAdDbAds({ advertiserPageId, limit: 120 });
    return { ads: result.items.map(toResearchAd), error: null };
  } catch {
    return { ads: [], error: "Ad DB request failed." };
  }
}

// Saved rows are Blockwise customer state; ad content is always hydrated from Hermes.
export async function loadCustomerSavedResearchAds(
  supabase: SupabaseServerClient,
): Promise<{ saved: CustomerSavedResearchAd[]; error: string | null }> {
  const { data, error } = await supabase
    .from("research_saved_ads")
    .select("id,observed_ad_id,note,source_snapshot_url,handoff_status,created_at,updated_at")
    .neq("handoff_status", "archived")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return { saved: [], error: error.message };
  return { saved: ((data ?? []) as SavedAdRow[]).map(normaliseSavedAd), error: null };
}

export async function loadCustomerAdsByIds(
  adIds: string[],
): Promise<ResearchAdApiRecord[]> {
  if (adIds.length === 0) return [];
  const rows = await Promise.all(adIds.map((adId) => fetchAdDbAd(adId)));
  return rows.filter((row): row is AdDbRow => row !== null).map(toResearchAd);
}

type SavedAdRow = {
  id: string;
  observed_ad_id: string;
  note: string | null;
  source_snapshot_url: string | null;
  handoff_status: string;
  created_at: string;
  updated_at: string;
};

function toResearchAd(row: AdDbRow): ResearchAdApiRecord {
  const card = mapAdDbRowToCustomerMetaCard(row);
  return {
    id: row.id,
    libraryId: card.libraryId,
    page: { id: row.advertiser_page_id, name: card.pageName },
    agent: { id: card.agentId, name: card.agentName },
    agency: { id: card.agencyId, name: card.agencyName },
    status: { active: card.activeStatus, display: null },
    dates: {
      firstSeenAt: row.first_seen_at,
      lastSeenAt: card.lastSeenAt,
      lastCheckedAt: row.last_checked_at,
      startedAt: card.startedAt,
      stoppedAt: card.stoppedAt,
      createdAt: row.ad_creation_date,
    },
    platforms: card.platforms,
    creative: {
      format: row.format,
      headline: card.headline,
      body: card.body,
      cta: card.cta,
      adType: card.adType ?? null,
      primaryIntent: row.primary_intent,
      hooks: [],
    },
    media: card.media.map((media) => ({
      kind: media.kind,
      url: media.url,
      storagePath: null,
      sourceUrl: null,
    })),
    source: {
      snapshotUrl: card.libraryId
        ? "https://www.facebook.com/ads/library/?id=" + encodeURIComponent(card.libraryId)
        : null,
      snapshotCount: 0,
    },
  };
}

function normaliseSavedAd(row: SavedAdRow): CustomerSavedResearchAd {
  return {
    id: row.id,
    observedAdId: row.observed_ad_id,
    note: row.note,
    sourceSnapshotUrl: row.source_snapshot_url,
    handoffStatus: row.handoff_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
