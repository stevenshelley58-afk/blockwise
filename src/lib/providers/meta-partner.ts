import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";

/**
 * Meta partner access (Flow B).
 *
 * Instead of every customer authorizing a Meta app (which needs Meta App
 * Review before non-developers can use it), customers share their ad account
 * with Blockwise's own Business Manager via Meta's Partners page. One
 * long-lived system-user token, held server-side, can then see and act on
 * every account shared with the BM. Storing that token in the connection
 * vault means all existing Meta flows (asset catalog, campaigns, leads,
 * reporting, publishing) work unchanged — they all read the token through
 * `loadStoredProviderTokens(connection.id)`.
 */

export type MetaPartnerConfig = {
  businessId: string;
  systemToken: string;
};

export const META_PARTNER_STARTS_ENABLED_ENV = "BLOCKWISE_META_PARTNER_STARTS_ENABLED";

/** Public onboarding information, available to the manual guide while automated partner starts stay disabled. */
export function getMetaPartnerBusinessId(): string | null {
  const businessId = process.env.META_BUSINESS_ID?.trim();
  return businessId && /^\d{6,25}$/.test(businessId) ? businessId : null;
}

/**
 * Partner-start is deliberately opt-in. Existing provider connections continue
 * to use their stored vault credentials; this gate only protects the unproven
 * partner assignment/claim onboarding path.
 */
export function isMetaPartnerStartEnabled(): boolean {
  return process.env[META_PARTNER_STARTS_ENABLED_ENV]?.trim() === "true";
}

// The deep link to Meta's Business settings → Partners screen, where the
// customer pastes Blockwise's Business ID to share their assets.
export const META_PARTNERS_URL = "https://business.facebook.com/settings/partners";

// Scopes the system user must be granted. ads_management covers campaign
// creation/publishing; business_management lets the token enumerate the
// Business Portfolio's shared assets.
export const META_PARTNER_SCOPES = ["ads_management", "business_management"];

export function getMetaPartnerConfig(): MetaPartnerConfig | null {
  if (!isMetaPartnerStartEnabled()) return null;

  const businessId = getMetaPartnerBusinessId();
  const systemToken = process.env.META_SYSTEM_USER_TOKEN?.trim();

  // A placeholder value is treated as unconfigured so the connect page can
  // show a clear "finish setup" state instead of hitting Meta with a fake
  // token and surfacing a confusing auth error to the customer.
  if (!businessId || !systemToken || systemToken.startsWith("PLACEHOLDER")) {
    return null;
  }

  return { businessId, systemToken };
}

export type PartnerAdAccountCandidate = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  isActive: boolean;
  businessName: string | null;
};

/**
 * List the ad accounts currently visible to Blockwise's system token. When a
 * customer shares an account via the Partners page it appears here on the next
 * Graph call — this is the polling mechanism behind the connect modal.
 */
export async function listPartnerVisibleAdAccounts(
  systemToken: string,
): Promise<PartnerAdAccountCandidate[]> {
  const accounts = await fetchPartnerAdAccounts(systemToken);

  return accounts.filter((account) => account.id || account.account_id).map((account) => ({
    id: account.id ?? `act_${account.account_id}`,
    name: account.name ?? account.id ?? "Meta ad account",
    currency: account.currency ?? "",
    timezone: account.timezone_name ?? "",
    isActive: account.account_status == null || account.account_status === 1,
    businessName: account.business?.name ?? null,
  }));
}

/**
 * Confirm a single ad account is readable with the system token. Used at claim
 * time so we never persist a connection for an account the token cannot
 * actually act on (e.g. the customer shared view-only, or shared then revoked
 * before confirming).
 */
export async function verifyPartnerAccountAccess(
  systemToken: string,
  adAccountId: string,
): Promise<boolean> {
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const url = new URL(
    `https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/${encodeURIComponent(accountId)}`,
  );
  url.searchParams.set("fields", "id,name");

  const response = await fetch(url.toString(), {
    cache: "no-store",
    headers: { authorization: `Bearer ${systemToken}` },
  });

  return response.ok;
}

async function fetchPartnerAdAccounts(systemToken: string): Promise<Array<{
  id?: string;
  account_id?: string;
  name?: string | null;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { name?: string | null } | null;
}>> {
  const rows: Array<{
    id?: string;
    account_id?: string;
    name?: string | null;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
    business?: { name?: string | null } | null;
  }> = [];
  let nextUrl: string | null = null;
  const firstUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/me/adaccounts`);
  firstUrl.searchParams.set("fields", "id,account_id,name,currency,timezone_name,account_status,business{name}");
  firstUrl.searchParams.set("limit", "25");
  nextUrl = firstUrl.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      cache: "no-store",
      headers: { authorization: `Bearer ${systemToken}` },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: typeof rows;
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Meta request failed with ${response.status}.`);
    }
    rows.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return rows;
}
