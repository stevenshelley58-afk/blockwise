import type { NextRequest } from "next/server";

import { DEFAULT_META_GRAPH_VERSION } from "@/lib/providers/meta-graph-version";
import { fetchMetaUserIdentity } from "./meta-oauth-identity.ts";
import { fetchMetaAdAccounts } from "@/lib/providers/meta-reporting";
import { requestDeadline } from "./request-deadline.ts";

/** The customer is waiting on a login redirect, so a stalled token exchange
 * fails at 10s rather than holding the redirect open. */
const OAUTH_TOKEN_TIMEOUT_MS = 10_000;

export type OAuthTokenExchange = {
  accessToken: string;
  refreshToken?: string | null;
  scopes: string[];
  externalAccountId: string;
  externalAccountName: string;
  status: "connected" | "needs_attention";
  metadata?: Record<string, unknown>;
  // Meta returns an app-scoped user id. Persisting it is required so signed
  // deauthorization/data-deletion callbacks can identify this connection.
  metaUserId?: string;
  tokenExpiresAt?: string | null;
};

// Scopes requested at OAuth consent. Ordering and membership matter for
// Meta App Review:
//   - pages_manage_ads is a documented dependency of leads_retrieval
//   - pages_show_list + pages_read_engagement are documented dependencies of
//     ads_management and business_management
//   - business_management is requested only as a documented dependency of
//     leads_retrieval; Blockwise does not call Business Manager write endpoints
//   - instagram_basic is intentionally NOT requested in the v1 review; add it
//     back only when the screencast can demo Instagram identity end-to-end
const META_SCOPES = [
  "ads_read",
  "ads_management",
  "business_management",
  "leads_retrieval",
  "pages_manage_ads",
  "pages_show_list",
  "pages_read_engagement",
];

export function buildProviderAuthorizationUrl(request: NextRequest, state: string): string | null {
  const appId = process.env.META_APP_ID;

  if (!appId) {
    return null;
  }

  const url = new URL(`https://www.facebook.com/${DEFAULT_META_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", getOAuthRedirectUri(request));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));

  return url.toString();
}

export async function exchangeProviderCode(request: NextRequest, code: string): Promise<OAuthTokenExchange> {
  return exchangeMetaCode(request, code);
}

export function getOAuthRedirectUri(request: NextRequest): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;

  return `${appUrl.replace(/\/$/, "")}/api/integrations/meta/callback`;
}

async function exchangeMetaCode(request: NextRequest, code: string): Promise<OAuthTokenExchange> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Meta OAuth credentials are not configured.");
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", getOAuthRedirectUri(request));
  tokenUrl.searchParams.set("code", code);

  const shortLived = await fetchJson<{ access_token?: string; expires_in?: number; error?: { message?: string } }>(tokenUrl.toString());

  if (!shortLived.access_token) {
    throw new Error(shortLived.error?.message ?? "Meta OAuth did not return an access token.");
  }

  const longLivedUrl = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLived.access_token);

  const longLived = await fetchJson<{ access_token?: string; expires_in?: number; error?: { message?: string } }>(longLivedUrl.toString()).catch(() => shortLived);
  const accessToken = longLived.access_token ?? shortLived.access_token;
  const tokenExpiresAt = expiresInToIso(longLived.expires_in ?? shortLived.expires_in);
  // Do not persist a Meta token unless its app-scoped owner can be recorded.
  // Without this identity, a later deauthorization callback cannot safely
  // match and clear the workspace connection.
  const metaUserId = await fetchMetaUserIdentity(accessToken);
  const [accounts, pages] = await Promise.all([
    fetchMetaAdAccounts(accessToken).catch(() => []),
    fetchMetaPages(accessToken).catch(() => []),
  ]);
  // Honor what the user granted in the Meta dialog: when a single ad account
  // or Page was shared there is no choice left to make, so configure it
  // directly instead of asking again in Settings. With multiple grants,
  // prefer an active account over disabled/closed ones.
  const account = accounts.length === 1 ? accounts[0] : (accounts.find((candidate) => candidate.isActive) ?? accounts[0]);
  const page = pages.length === 1 ? pages[0] : undefined;

  return {
    accessToken,
    refreshToken: null,
    scopes: META_SCOPES,
    externalAccountId: account?.id ?? "meta_account_pending",
    externalAccountName: account?.name ?? "Meta Ads account",
    status: account ? "connected" : "needs_attention",
    metaUserId,
    tokenExpiresAt,
    metadata: {
      // Keep the id at the root for the data-deletion matcher and inside the
      // provider metadata for existing consumers that read metadata.meta.
      metaUserId,
      meta: {
        metaUserId,
        metaAdAccountId: account?.id ?? "",
        metaBusinessId: account?.businessId ?? "",
        metaBusinessName: account?.businessName ?? "",
        pageId: page?.id ?? "",
        instagramActorId: null,
        pixelId: null,
        leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
        privacyPolicyUrl: defaultPrivacyPolicyUrl(),
        currency: account?.currency ?? "AUD",
        timezone: account?.timezone ?? "Australia/Perth",
        tokenExpiresAt,
      },
    },
  };
}

export { fetchMetaUserIdentity } from "./meta-oauth-identity.ts";

async function fetchMetaPages(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name");
  url.searchParams.set("limit", "25");
  url.searchParams.set("access_token", accessToken);

  const response = await fetchJson<{ data?: Array<{ id?: string; name?: string | null }> }>(url.toString());

  return (response.data ?? [])
    .filter((page): page is { id: string; name?: string | null } => Boolean(page.id))
    .map((page) => ({ id: page.id, name: page.name ?? page.id }));
}

function defaultPrivacyPolicyUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  return appUrl ? `${appUrl.replace(/\/$/, "")}/privacy` : "";
}

function expiresInToIso(expiresIn: number | undefined): string | null {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    signal: requestDeadline(OAUTH_TOKEN_TIMEOUT_MS, init?.signal),
  });
  const payload = (await response.json()) as T;

  if (!response.ok) {
    const errorPayload = payload as { error_description?: string; error?: string | { message?: string } };
    const message =
      errorPayload.error_description ??
      (typeof errorPayload.error === "string" ? errorPayload.error : errorPayload.error?.message) ??
      `OAuth request failed with ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}
