import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { RESEARCH_AD_SELECT, normaliseResearchAd, type ResearchAdApiRecord, type ResearchAdListRow } from "./ad-library-api.ts";

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

type CreativeVersionRow = {
  id: string;
  version: number;
  creative_hash: string;
  format: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  ad_type: string | null;
  primary_intent: string | null;
  display_state: string | null;
  created_at: string;
};

type SavedAdRow = {
  id: string;
  observed_ad_id: string;
  note: string | null;
  source_snapshot_url: string | null;
  handoff_status: string;
  created_at: string;
  updated_at: string;
};

export async function loadCustomerResearchAdDetail(
  supabase: SupabaseServerClient,
  adId: string,
): Promise<{ ad: ResearchAdApiRecord | null; versions: CustomerCreativeVersion[]; error: string | null }> {
  const { data: row, error } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RESEARCH_AD_SELECT)
    .eq("observed_ad_id", adId)
    .maybeSingle();

  if (error) return { ad: null, versions: [], error: error.message };
  if (!row) return { ad: null, versions: [], error: null };

  const { data: versions } = await supabase
    .schema("research")
    .from("ad_creative_versions")
    .select("id,version,creative_hash,format,headline,body,cta,ad_type,primary_intent,display_state,created_at")
    .eq("observed_ad_id", adId)
    .order("version", { ascending: false })
    .limit(20);

  return {
    ad: normaliseResearchAd(row as unknown as ResearchAdListRow),
    versions: ((versions ?? []) as CreativeVersionRow[]).map(normaliseCreativeVersion),
    error: null,
  };
}

export async function loadCustomerAdvertiserAds(
  supabase: SupabaseServerClient,
  advertiserPageId: string,
): Promise<{ ads: ResearchAdApiRecord[]; error: string | null }> {
  const { data, error } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RESEARCH_AD_SELECT)
    .eq("advertiser_page_id", advertiserPageId)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(120);

  if (error) return { ads: [], error: error.message };
  return { ads: ((data ?? []) as unknown as ResearchAdListRow[]).map(normaliseResearchAd), error: null };
}

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
  supabase: SupabaseServerClient,
  adIds: string[],
): Promise<ResearchAdApiRecord[]> {
  if (adIds.length === 0) return [];
  const { data } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RESEARCH_AD_SELECT)
    .in("observed_ad_id", adIds)
    .limit(200);

  return ((data ?? []) as unknown as ResearchAdListRow[]).map(normaliseResearchAd);
}

function normaliseCreativeVersion(row: CreativeVersionRow): CustomerCreativeVersion {
  return {
    id: row.id,
    version: row.version,
    creativeHash: row.creative_hash,
    format: row.format,
    headline: row.headline,
    body: row.body,
    cta: row.cta,
    adType: row.ad_type,
    primaryIntent: row.primary_intent,
    displayState: row.display_state,
    createdAt: row.created_at,
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
