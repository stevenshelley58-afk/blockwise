import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

type MetaCampaignRow = {
  id?: string;
  name?: string | null;
  objective?: string | null;
  effective_status?: string | null;
  configured_status?: string | null;
  special_ad_categories?: string[] | null;
  created_time?: string | null;
  updated_time?: string | null;
};

type MetaCampaignListResponse = {
  data?: MetaCampaignRow[];
  paging?: { next?: string | null } | null;
  error?: { message?: string };
};

export type EligibleMetaCampaign = {
  id: string;
  name: string;
  status: "active" | "paused";
  objective: "leads";
  createdAt: string | null;
  updatedAt: string | null;
};

export function normalizeEligibleMetaCampaigns(rows: MetaCampaignRow[]): EligibleMetaCampaign[] {
  return rows
    .flatMap((row): EligibleMetaCampaign[] => {
      const id = row.id?.trim();
      const name = row.name?.trim();
      const objective = row.objective?.toUpperCase();
      const effectiveStatus = row.effective_status?.toUpperCase();
      const configuredStatus = row.configured_status?.toUpperCase();
      const specialAdCategories = (row.special_ad_categories ?? []).map((category) => category.toUpperCase());
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
  firstUrl.searchParams.set("fields", "id,name,objective,effective_status,configured_status,special_ad_categories,created_time,updated_time");
  firstUrl.searchParams.set("limit", "200");

  const rows: MetaCampaignRow[] = [];
  let nextUrl: string | null = firstUrl.toString();

  while (nextUrl) {
    const response = await fetchImpl(nextUrl, { cache: "no-store" });
    const payload = (await response.json()) as MetaCampaignListResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
    }

    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return normalizeEligibleMetaCampaigns(rows);
}
