import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import {
  fetchEligibleMetaCampaigns,
  type EligibleMetaCampaign,
} from "./meta-campaigns.ts";

type MetaAdSetRow = {
  id?: string | null;
  name?: string | null;
  campaign_id?: string | null;
  effective_status?: string | null;
  configured_status?: string | null;
  status?: string | null;
};

type MetaAdSetListResponse = {
  data?: MetaAdSetRow[];
  paging?: { next?: string | null } | null;
  error?: { message?: string };
};

const MAX_META_OPTION_PAGES = 20;

export type MetaPublishOptionStatus = "active" | "paused" | "unknown";

export type MetaPublishAdSetOption = {
  id: string;
  name: string;
  status: MetaPublishOptionStatus;
  budgetMode: "campaign" | "adset";
  eligible: boolean;
  eligibilityReasons: string[];
};

export type MetaPublishCampaignOption = {
  id: string;
  name: string;
  status: EligibleMetaCampaign["status"];
  budgetMode: EligibleMetaCampaign["budgetMode"];
  eligible: boolean;
  eligibilityReasons: string[];
  adSets: MetaPublishAdSetOption[];
};

/** Fetch safe names and statuses for the existing-target picker. */
export async function fetchMetaPublishOptions(input: {
  accessToken: string;
  accountId: string;
  fetchImpl?: typeof fetch;
}): Promise<MetaPublishCampaignOption[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const campaigns = await fetchEligibleMetaCampaigns({
    accessToken: input.accessToken,
    accountId: input.accountId,
    fetchImpl,
  });
  const adSets = await fetchMetaAdSets({
    accessToken: input.accessToken,
    accountId: input.accountId,
    fetchImpl,
  });
  const adSetsByCampaign = new Map<string, MetaAdSetRow[]>();
  for (const adSet of adSets) {
    const campaignId = adSet.campaign_id?.trim();
    if (!campaignId) continue;
    const rows = adSetsByCampaign.get(campaignId) ?? [];
    rows.push(adSet);
    adSetsByCampaign.set(campaignId, rows);
  }

  return campaigns.map((campaign) => {
    const campaignReasons = campaign.status === "active"
      ? []
      : ["Campaign is paused in Meta and must be active before this ad can run."];
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      budgetMode: campaign.budgetMode,
      eligible: campaignReasons.length === 0,
      eligibilityReasons: campaignReasons,
      adSets: (adSetsByCampaign.get(campaign.id) ?? [])
        .map((adSet) => normalizeAdSet(adSet, campaign))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  });
}

function normalizeAdSet(row: MetaAdSetRow, campaign: EligibleMetaCampaign): MetaPublishAdSetOption {
  const id = row.id?.trim() ?? "";
  const name = row.name?.trim() ?? "";
  const status = normalizeStatus(row);
  const eligibilityReasons = status === "active"
    ? campaign.status === "active"
      ? []
      : ["Its campaign is paused in Meta and must be active before this ad can run."]
    : status === "paused"
      ? ["Ad set is paused in Meta and must be active before this ad can run."]
      : ["Meta did not report this ad set as active or paused."];

  return {
    id,
    name,
    status,
    // Reusing an ad set inherits the campaign's live budget ownership.
    budgetMode: campaign.budgetMode,
    eligible: eligibilityReasons.length === 0,
    eligibilityReasons,
  };
}

function normalizeStatus(row: MetaAdSetRow): MetaPublishOptionStatus {
  const status = (row.effective_status ?? row.configured_status ?? row.status ?? "").trim().toUpperCase();
  if (status === "ACTIVE") return "active";
  if (status === "PAUSED") return "paused";
  return "unknown";
}

async function fetchMetaAdSets(input: {
  accessToken: string;
  accountId: string;
  fetchImpl: typeof fetch;
}): Promise<MetaAdSetRow[]> {
  const accountId = input.accountId.startsWith("act_") ? input.accountId : `act_${input.accountId}`;
  const firstUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${accountId}/adsets`);
  firstUrl.searchParams.set("access_token", input.accessToken);
  firstUrl.searchParams.set("fields", "id,name,campaign_id,effective_status,configured_status,status");
  firstUrl.searchParams.set("limit", "500");

  const rows: MetaAdSetRow[] = [];
  let nextUrl: string | null = firstUrl.toString();
  let pages = 0;
  while (nextUrl) {
    if (++pages > MAX_META_OPTION_PAGES || new URL(nextUrl).origin !== "https://graph.facebook.com") throw new Error("Meta options pagination could not be verified.");
    const response = await input.fetchImpl(nextUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json()) as MetaAdSetListResponse;
    if (!response.ok) throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }
  return rows.filter((row) => Boolean(row.id?.trim() && row.name?.trim() && row.campaign_id?.trim()));
}
/** Read and validate exact existing Meta parents before publish. */
export async function fetchMetaPublishParentState(input: { accessToken: string; accountId: string; campaignId: string; adSetIds?: string[]; fetchImpl?: typeof fetch }): Promise<import("./meta-execution.ts").MetaParentState> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const accountId = input.accountId.replace(/^act_/, "");
  const campaignId = input.campaignId.trim();
  if (!campaignId) throw new Error("A Meta campaign must be selected.");
  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${campaignId}`);
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("fields", "id,account_id,objective,effective_status,configured_status,special_ad_categories,special_ad_category_country,daily_budget,lifetime_budget");
  const response = await fetchImpl(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const row = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error((row.error as { message?: string } | undefined)?.message ?? `Meta request failed with ${response.status}.`);
  if (String(row.id ?? "") !== campaignId || String(row.account_id ?? "").replace(/^act_/, "") !== accountId) throw new Error("The selected Meta campaign does not belong to the connected ad account.");
  if (row.configured_status !== "ACTIVE" || row.effective_status !== "ACTIVE") throw new Error("The selected campaign must be active before adding this ad.");
  const categories = Array.isArray(row.special_ad_categories) ? row.special_ad_categories.map(String) : [];
  if (String(row.objective ?? "") !== "OUTCOME_LEADS" || !categories.some((item) => item.toUpperCase() === "HOUSING")) throw new Error("The selected Meta campaign is not compatible with lead-generation housing ads.");
  const budgetMode = Number(row.daily_budget ?? 0) > 0 || Number(row.lifetime_budget ?? 0) > 0 ? "campaign" : "adset";
  const parent: import("./meta-execution.ts").MetaParentState = { campaign: { id: campaignId, objective: "OUTCOME_LEADS", specialAdCategories: categories, specialAdCategoryCountries: Array.isArray(row.special_ad_category_country) ? row.special_ad_category_country.map(String) : [], budgetMode } };
  const ids = [...new Set((input.adSetIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return parent;
  const setsUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${campaignId}/adsets`);
  setsUrl.searchParams.set("access_token", input.accessToken);
  setsUrl.searchParams.set("fields", "id,account_id,campaign_id,configured_status,effective_status,targeting,optimization_goal,billing_event,destination_type,promoted_object,daily_budget,lifetime_budget");
  setsUrl.searchParams.set("limit", "500");
  const setsResponse = await fetchImpl(setsUrl, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const payload = await setsResponse.json() as { data?: Array<Record<string, unknown>>; error?: { message?: string } };
  if (!setsResponse.ok) throw new Error(payload.error?.message ?? `Meta request failed with ${setsResponse.status}.`);
  const rows = payload.data ?? [];
  const selected = ids.map((id) => rows.find((item) => String(item.id ?? "") === id));
  if (selected.some((item) => !item || String(item.account_id ?? "").replace(/^act_/, "") !== accountId || String(item.campaign_id ?? "") !== campaignId)) throw new Error("One or more selected Meta ad sets do not belong to the selected campaign.");
  if (selected.some(item => item!.configured_status !== "ACTIVE" || item!.effective_status !== "ACTIVE")) throw new Error("The selected ad sets must be active before adding this ad.");
  parent.adSets = selected.map((item) => ({ id: String(item!.id), campaignId, targeting: (item!.targeting as Record<string, unknown>) ?? {}, optimizationGoal: String(item!.optimization_goal ?? ""), billingEvent: String(item!.billing_event ?? ""), dailyBudgetMinorUnits: Number(item!.daily_budget ?? 0), destination: item!.destination_type ? { type: String(item!.destination_type) } : null, promotedObject: (item!.promoted_object as Record<string, unknown>) ?? null }));
  return parent;
}
