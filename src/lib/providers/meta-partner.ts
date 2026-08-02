import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import { fetchMetaAdAccounts } from "./meta-reporting.ts";

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

// The deep link to Meta's Business settings → Partners screen, where the
// customer pastes Blockwise's Business ID to share their assets.
export const META_PARTNERS_URL = "https://business.facebook.com/settings/partners";

// Scopes the system user must be granted. ads_management covers campaign
// creation/publishing; business_management lets the token enumerate the
// Business Portfolio's shared assets.
export const META_PARTNER_SCOPES = ["ads_management", "business_management"];

export function getMetaPartnerConfig(): MetaPartnerConfig | null {
  const businessId = process.env.META_BUSINESS_ID?.trim();
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
  const accounts = await fetchMetaAdAccounts(systemToken);

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    currency: account.currency ?? "",
    timezone: account.timezone ?? "",
    isActive: account.isActive,
    businessName: account.businessName ?? null,
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
  url.searchParams.set("access_token", systemToken);

  const response = await fetch(url.toString(), { cache: "no-store" });

  return response.ok;
}
