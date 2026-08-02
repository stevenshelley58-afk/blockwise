import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import { BILLING_OFFER_VERSION } from "../billing/offers.ts";

type MetaCampaignRow = {
  id?: string;
  name?: string | null;
  objective?: string | null;
  effective_status?: string | null;
  configured_status?: string | null;
  special_ad_categories?: string[] | null;
  daily_budget?: string | null;
  lifetime_budget?: string | null;
  created_time?: string | null;
  updated_time?: string | null;
};

type MetaCampaignListResponse = {
  data?: MetaCampaignRow[];
  paging?: { next?: string | null } | null;
  error?: { message?: string };
};

type MetaTargetingLocationRow = {
  key?: string | number;
  name?: string | null;
  type?: string | null;
  country_code?: string | null;
  region?: string | null;
  supports_city?: boolean | null;
};

type MetaTargetingLocationResponse = {
  data?: MetaTargetingLocationRow[];
  error?: { message?: string };
};

export type MetaTargetingLocation = {
  key: string;
  name: string;
  region: string | null;
};

export type EligibleMetaCampaign = {
  id: string;
  name: string;
  status: "active" | "paused";
  objective: "leads";
  budgetMode: "campaign" | "adset";
  createdAt: string | null;
  updatedAt: string | null;
};

export function metaExistingCampaignReuseIssue(input: {
  billingAccessState?: string | null;
  billingOfferKey?: string | null;
  billingOfferVersion?: string | null;
  stripeSubscriptionStatus?: string | null;
}): string | null {
  const automaticallyActivates = input.billingAccessState === "unbilled" || (
    input.billingOfferKey?.startsWith("self_serve_") === true
    && input.stripeSubscriptionStatus === "trialing"
    && input.billingOfferVersion !== BILLING_OFFER_VERSION
  );
  return automaticallyActivates
    ? "Your free three-day campaign must use a new Meta campaign so its budget, schedule, and activation stay isolated."
    : null;
}

export function normalizeEligibleMetaCampaigns(rows: MetaCampaignRow[]): EligibleMetaCampaign[] {
  return rows
    .flatMap((row): EligibleMetaCampaign[] => {
      const id = row.id?.trim();
      const name = row.name?.trim();
      const objective = row.objective?.toUpperCase();
      const effectiveStatus = row.effective_status?.toUpperCase();
      const configuredStatus = row.configured_status?.toUpperCase();
      const specialAdCategories = (row.special_ad_categories ?? []).map((category) => category.toUpperCase());
      const hasCampaignBudget = [row.daily_budget, row.lifetime_budget]
        .some((value) => Number(value ?? 0) > 0);
      const status = effectiveStatus === "ACTIVE" || configuredStatus === "ACTIVE"
        ? "active"
        : effectiveStatus === "PAUSED" || configuredStatus === "PAUSED"
          ? "paused"
          : null;

      if (!id || !name || objective !== "OUTCOME_LEADS" || !specialAdCategories.includes("HOUSING") || !status) {
        return [];
      }

      return [{
        id,
        name,
        status,
        objective: "leads",
        budgetMode: hasCampaignBudget ? "campaign" : "adset",
        createdAt: row.created_time ?? null,
        updatedAt: row.updated_time ?? null,
      }];
    })
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? ""));
}

export async function fetchEligibleMetaCampaigns(input: {
  accessToken: string;
  accountId: string;
  fetchImpl?: typeof fetch;
}): Promise<EligibleMetaCampaign[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const accountId = input.accountId.startsWith("act_") ? input.accountId : `act_${input.accountId}`;
  const firstUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${accountId}/campaigns`);
  firstUrl.searchParams.set("access_token", input.accessToken);
  firstUrl.searchParams.set("fields", "id,name,objective,effective_status,configured_status,special_ad_categories,daily_budget,lifetime_budget,created_time,updated_time");
  firstUrl.searchParams.set("limit", "200");

  const rows: MetaCampaignRow[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    const response = await fetchImpl(nextUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json()) as MetaCampaignListResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
    }

    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return normalizeEligibleMetaCampaigns(rows);
}

export function normalizeMetaTargetingLocations(rows: MetaTargetingLocationRow[]): MetaTargetingLocation[] {
  const seen = new Set<string>();
  return rows.flatMap((row): MetaTargetingLocation[] => {
    const key = String(row.key ?? "").trim();
    const name = row.name?.trim();
    const countryCode = row.country_code?.trim().toUpperCase();
    const type = row.type?.trim().toLowerCase();
    if (!key || !name || countryCode !== "AU" || row.supports_city === false || !type || !["city", "subcity", "neighborhood", "small_geo_area"].includes(type)) {
      return [];
    }
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, name, region: row.region?.trim() || null }];
  });
}

export async function fetchMetaTargetingLocations(input: {
  accessToken: string;
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<MetaTargetingLocation[]> {
  const query = input.query.trim();
  if (query.length < 2) return [];

  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/search`);
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("type", "adgeolocation");
  url.searchParams.set("location_types", JSON.stringify(["city"]));
  url.searchParams.set("country_code", "AU");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");

  const response = await (input.fetchImpl ?? fetch)(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json()) as MetaTargetingLocationResponse;
  if (!response.ok) throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
  return normalizeMetaTargetingLocations(payload.data ?? []).slice(0, 6);
}
