import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "../research/customer-meta-card.ts";
import type { OutreachAdExample, OutreachAreaSnapshot } from "./postcode-campaign.ts";

/**
 * Ad Radar adapter for postcode outreach.
 *
 * Turns live Ad Radar observations (Meta Ad Library cards held in
 * `customer_ad_radar_cards`) into an outreach area snapshot. Every example
 * keeps its dated public source link and, where a creative was captured, the
 * stored creative URL.
 *
 * Media still only renders when the URL origin is listed in
 * OUTREACH_MEDIA_ALLOWED_ORIGINS. That env gate is the control point: leaving
 * it unset keeps every email text-only without touching this adapter.
 */

export const AD_RADAR_SOURCE = "Meta Ad Library via Ad Radar";
export const AD_RADAR_SCAN_ID = "ad-radar-area-observation";

const AD_RADAR_ROW_LIMIT = 60;
const DAY_MS = 86_400_000;

export type AdRadarAdvertiser = {
  name: string;
  adCount: number;
};

export type AdRadarAreaSummary = {
  /** Active ads observed for the postcode, before the 12-example cap. */
  activeAdCount: number;
  advertiserCount: number;
  longestRunningDays: number;
  advertisers: AdRadarAdvertiser[];
};

export type AdRadarSnapshotResult = {
  snapshot: OutreachAreaSnapshot;
  summary: AdRadarAreaSummary;
};

/** Public Meta Ad Library link for one observed ad. Null without a library id. */
export function adRadarSourceUrl(libraryId: string | null): string | null {
  const id = libraryId?.trim();
  if (!id || !/^[A-Za-z0-9_-]+$/u.test(id)) return null;
  return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;
}

/** Agency name is the business identity; the page name is the fallback. */
export function adRadarAdvertiserName(card: CustomerMetaAdLibraryCard): string {
  return card.agencyName ?? card.pageName;
}

/** Still images carry the message in an email; fall back to a video poster. */
function exampleMediaUrl(card: CustomerMetaAdLibraryCard): string | null {
  const image = card.media.find((media) => media.kind === "image");
  if (image) return image.url;
  const video = card.media.find((media) => media.kind === "video");
  return video?.posterUrl ?? null;
}

function exampleCategory(card: CustomerMetaAdLibraryCard): OutreachAdExample["category"] {
  const value = (card.adType ?? "").toLowerCase();
  if (/listing|just_listed|for_sale|new_listing/u.test(value)) return "listing";
  if (/appraisal|home_worth|valuation/u.test(value)) return "appraisal";
  if (/brand/u.test(value)) return "branding";
  return "other";
}

export function toAdRadarAdExample(card: CustomerMetaAdLibraryCard): OutreachAdExample | null {
  const sourceUrl = adRadarSourceUrl(card.libraryId);
  const observedAt = card.lastSeenAt ?? card.startedAt;
  if (!sourceUrl || !observedAt) return null;
  const mediaUrl = exampleMediaUrl(card);
  return {
    id: card.id,
    pageName: adRadarAdvertiserName(card),
    headline: card.headline,
    body: card.body,
    sourceUrl,
    pageUrl: card.pageUrl,
    observedAt,
    startedAt: card.startedAt,
    mediaUrl,
    // Ad Radar creatives are public Meta Ad Library material captured by
    // Hermes. Rendering remains gated by the configured origin allowlist.
    mediaRightsConfirmed: Boolean(mediaUrl),
    category: exampleCategory(card),
    ...(card.cta ? { cta: card.cta } : {}),
  };
}

/** Pure assembly: observations in, dated area snapshot and counters out. */
export function buildAdRadarSnapshot(
  cards: CustomerMetaAdLibraryCard[],
  input: { postcode: string; coverageLabel: string; suburbs?: string[]; scannedAt?: string },
): AdRadarSnapshotResult {
  const now = Date.now();
  const examples: OutreachAdExample[] = [];
  const seenIds = new Set<string>();
  const adCounts = new Map<string, number>();
  let longestRunningDays = 0;

  for (const card of cards) {
    const name = adRadarAdvertiserName(card).trim();
    if (name) adCounts.set(name, (adCounts.get(name) ?? 0) + 1);

    if (card.startedAt) {
      const started = new Date(card.startedAt).getTime();
      if (Number.isFinite(started) && started <= now) {
        longestRunningDays = Math.max(longestRunningDays, Math.floor((now - started) / DAY_MS));
      }
    }

    const example = toAdRadarAdExample(card);
    if (!example || seenIds.has(example.id)) continue;
    seenIds.add(example.id);
    if (examples.length < 12) examples.push(example);
  }

  const scannedAt = input.scannedAt ?? new Date(now).toISOString();
  return {
    snapshot: {
      postcode: input.postcode,
      coverageLabel: input.coverageLabel,
      suburbs: input.suburbs ?? [],
      evidence: {
        status: examples.length > 0 ? "recent_ads_observed" : "no_ads_found_after_successful_recent_scan",
        scanId: AD_RADAR_SCAN_ID,
        scannedAt,
        completed: true,
        scopeVerified: true,
        source: AD_RADAR_SOURCE,
        observedAdCount: cards.length,
      },
      adExamples: examples,
      sourceRightsConfirmed: true,
    },
    summary: {
      activeAdCount: cards.length,
      advertiserCount: adCounts.size,
      longestRunningDays,
      advertisers: [...adCounts.entries()]
        .map(([name, adCount]) => ({ name, adCount }))
        .sort((a, b) => b.adCount - a.adCount || a.name.localeCompare(b.name, "en-AU")),
    },
  };
}

async function fetchRows(
  supabase: SupabaseClient,
  postcode: string,
  applyFilter: (query: any) => any,
): Promise<CustomerMetaAdLibraryCardRow[]> {
  let query = supabase
    .from("customer_ad_radar_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .eq("active_status", "active")
    .order("ad_delivery_started_at", { ascending: true, nullsFirst: false })
    .limit(AD_RADAR_ROW_LIMIT);
  query = applyFilter(query);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CustomerMetaAdLibraryCardRow[];
}

/** Load the live area snapshot for a postcode, longest-running ads first. */
export async function loadAdRadarSnapshot(
  supabase: SupabaseClient,
  input: { postcode: string; coverageLabel: string; suburbs?: string[] },
): Promise<AdRadarSnapshotResult> {
  const postcode = input.postcode.trim();
  const [direct, overlapping] = await Promise.all([
    fetchRows(supabase, postcode, (query) => query.eq("postcode", postcode)),
    fetchRows(supabase, postcode, (query) => query.overlaps("ad_area_postcodes", [postcode])),
  ]);

  const seen = new Set<string>();
  const cards: CustomerMetaAdLibraryCard[] = [];
  for (const row of [...direct, ...overlapping]) {
    const key = row.card_id ?? row.library_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cards.push(normaliseCustomerMetaAdLibraryCard(row));
  }

  cards.sort((a, b) => {
    const aStart = a.startedAt ? new Date(a.startedAt).getTime() : Number.POSITIVE_INFINITY;
    const bStart = b.startedAt ? new Date(b.startedAt).getTime() : Number.POSITIVE_INFINITY;
    return aStart - bStart;
  });

  return buildAdRadarSnapshot(cards, input);
}
