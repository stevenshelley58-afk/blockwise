import type { MetaAdLibraryAd } from "./schemas/index.ts";

export type OfficialMetaAdLibrarySearchInput = {
  accessToken: string;
  apiVersion?: string;
  country?: string;
  adType?: "HOUSING_ADS" | "POLITICAL_AND_ISSUE_ADS" | "ALL";
  searchTerms?: string[];
  pageIds?: string[];
  limit?: number;
  maxPagesPerSearch?: number;
};

export type OfficialMetaAdLibraryValidation = {
  status: "success" | "failed" | "partial";
  usefulForAuRealEstate: boolean;
  summary: {
    country: string;
    adType: string;
    searchesRun: number;
    adsReturned: number;
    realEstateSignals: number;
    uniquePageIds: number;
    warnings: string[];
  };
  sample: MetaAdLibraryAd[];
  error: string | null;
};

type GraphAdsArchiveResponse = {
  data?: Array<Record<string, unknown>>;
  paging?: {
    next?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
};

type SearchPlanItem =
  | { kind: "term"; value: string }
  | { kind: "page"; value: string };

const DEFAULT_FIELDS = [
  "id",
  "ad_archive_id",
  "page_id",
  "page_name",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_snapshot_url",
  "publisher_platforms",
].join(",");

export async function validateOfficialMetaAdLibraryCoverage(
  input: OfficialMetaAdLibrarySearchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<OfficialMetaAdLibraryValidation> {
  const accessToken = input.accessToken.trim();
  if (!accessToken) {
    throw new Error("Meta Ad Library access token is required.");
  }

  const country = (input.country ?? "AU").toUpperCase();
  const adType = input.adType ?? "HOUSING_ADS";
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const maxPagesPerSearch = Math.max(1, Math.min(input.maxPagesPerSearch ?? 3, 10));
  const searchPlan = buildSearchPlan(input);
  const warnings: string[] = [];
  const sample: MetaAdLibraryAd[] = [];
  let failed = 0;

  for (const item of searchPlan) {
    let url: string | null = buildAdsArchiveUrl({
      accessToken,
      apiVersion: input.apiVersion ?? "v20.0",
      country,
      adType,
      limit,
      item,
    });
    let page = 0;

    while (url && page < maxPagesPerSearch) {
      page += 1;
      const response = await fetchImpl(url);
      const body = (await response.json().catch(() => null)) as GraphAdsArchiveResponse | null;
      if (!response.ok || body?.error) {
        failed += 1;
        warnings.push(`${item.kind}:${item.value} page ${page} failed: ${body?.error?.message ?? response.status}`);
        break;
      }

      for (const raw of body?.data ?? []) {
        sample.push(normaliseOfficialMetaAd(raw));
      }

      url = safeNextAdsArchiveUrl(body?.paging?.next);
      if (body?.paging?.next && !url) {
        warnings.push(`${item.kind}:${item.value} returned an unsafe paging URL; pagination stopped.`);
      }
      if (url && page >= maxPagesPerSearch) {
        warnings.push(`${item.kind}:${item.value} still had more pages after ${maxPagesPerSearch} page(s); validation sample is truncated.`);
      }
    }
  }

  const realEstateSignals = sample.filter(hasRealEstateSignal).length;
  const uniquePageIds = new Set(sample.map((ad) => String(ad.pageID ?? "")).filter(Boolean)).size;
  const status = failed === 0 ? "success" : sample.length > 0 ? "partial" : "failed";

  return {
    status,
    usefulForAuRealEstate: country === "AU" && adType === "HOUSING_ADS" && realEstateSignals > 0,
    summary: {
      country,
      adType,
      searchesRun: searchPlan.length,
      adsReturned: sample.length,
      realEstateSignals,
      uniquePageIds,
      warnings,
    },
    sample,
    error: status === "failed" ? warnings.join("; ") || "Official API validation returned no ads." : null,
  };
}

function safeNextAdsArchiveUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "graph.facebook.com") return null;
    if (!/\/ads_archive$/u.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function buildSearchPlan(input: OfficialMetaAdLibrarySearchInput): SearchPlanItem[] {
  const terms = (input.searchTerms ?? ["real estate appraisal", "just listed", "just sold"])
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((value): SearchPlanItem => ({ kind: "term", value }));

  const pages = (input.pageIds ?? [])
    .map((pageId) => pageId.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((value): SearchPlanItem => ({ kind: "page", value }));

  return [...pages, ...terms].slice(0, 20);
}

function buildAdsArchiveUrl(input: {
  accessToken: string;
  apiVersion: string;
  country: string;
  adType: string;
  limit: number;
  item: SearchPlanItem;
}) {
  const params = new URLSearchParams({
    access_token: input.accessToken,
    ad_active_status: "ACTIVE",
    ad_reached_countries: JSON.stringify([input.country]),
    ad_type: input.adType,
    fields: DEFAULT_FIELDS,
    limit: String(input.limit),
  });

  if (input.item.kind === "page") {
    params.set("search_page_ids", JSON.stringify([input.item.value]));
  } else {
    params.set("search_terms", input.item.value);
  }

  return `https://graph.facebook.com/${input.apiVersion}/ads_archive?${params.toString()}`;
}

function normaliseOfficialMetaAd(raw: Record<string, unknown>): MetaAdLibraryAd {
  const adId = firstString(raw.ad_archive_id, raw.id);
  const pageId = firstString(raw.page_id);
  const pageName = firstString(raw.page_name);
  const bodies = stringArray(raw.ad_creative_bodies);
  const titles = stringArray(raw.ad_creative_link_titles);
  const descriptions = stringArray(raw.ad_creative_link_descriptions);

  return {
    adArchiveID: adId,
    id: adId,
    pageID: pageId,
    pageName,
    isActive: true,
    startDate: firstString(raw.ad_delivery_start_time),
    endDate: firstString(raw.ad_delivery_stop_time),
    publisherPlatform: stringArray(raw.publisher_platforms).map((platform) => platform.toLowerCase()),
    snapshot: {
      body: bodies[0] ?? null,
      title: titles[0] ?? null,
      linkDescription: descriptions[0] ?? null,
      pageId,
      pageName,
    },
    inputUrl: firstString(raw.ad_snapshot_url) ?? (adId ? `https://www.facebook.com/ads/library/?id=${adId}` : null),
    rawOfficialApi: raw,
  } as MetaAdLibraryAd;
}

function hasRealEstateSignal(ad: MetaAdLibraryAd): boolean {
  const text = [
    ad.pageName,
    ad.snapshot?.body,
    ad.snapshot?.title,
    ad.snapshot?.linkDescription,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(real estate|property|appraisal|just listed|just sold|auction|home open|open home|rental|property management)\b/u.test(text);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(firstString).filter((item): item is string => Boolean(item));
  }
  const single = firstString(value);
  return single ? [single] : [];
}
