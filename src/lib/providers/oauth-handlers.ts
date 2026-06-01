import type { NextRequest } from "next/server";

import type { MonitorProvider } from "@/lib/monitor/dashboard-data";
import { fetchGoogleAccessibleCustomers } from "@/lib/providers/google-reporting";
import { fetchMetaAdAccounts } from "@/lib/providers/meta-reporting";

export type OAuthTokenExchange = {
  accessToken: string;
  refreshToken?: string | null;
  scopes: string[];
  externalAccountId: string;
  externalAccountName: string;
  status: "connected" | "needs_attention";
  metadata?: Record<string, unknown>;
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
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/adwords"];
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION ?? process.env.META_API_VERSION ?? "v23.0";

export function buildProviderAuthorizationUrl(provider: MonitorProvider, request: NextRequest, state: string): string | null {
  if (provider === "meta") {
    const appId = process.env.META_APP_ID;

    if (!appId) {
      return null;
    }

    const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", getOAuthRedirectUri(request, "meta"));
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_SCOPES.join(","));

    return url.toString();
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return null;
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getOAuthRedirectUri(request, "google"));
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");

  return url.toString();
}

export async function exchangeProviderCode(
  provider: MonitorProvider,
  request: NextRequest,
  code: string,
): Promise<OAuthTokenExchange> {
  return provider === "meta" ? exchangeMetaCode(request, code) : exchangeGoogleCode(request, code);
}

export function getOAuthRedirectUri(request: NextRequest, provider: MonitorProvider): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || request.nextUrl.origin;

  return `${appUrl.replace(/\/$/, "")}/api/integrations/${provider}/callback`;
}

async function exchangeMetaCode(request: NextRequest, code: string): Promise<OAuthTokenExchange> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("Meta OAuth credentials are not configured.");
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", getOAuthRedirectUri(request, "meta"));
  tokenUrl.searchParams.set("code", code);

  const shortLived = await fetchJson<{ access_token?: string; expires_in?: number; error?: { message?: string } }>(tokenUrl.toString());

  if (!shortLived.access_token) {
    throw new Error(shortLived.error?.message ?? "Meta OAuth did not return an access token.");
  }

  const longLivedUrl = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLived.access_token);

  const longLived = await fetchJson<{ access_token?: string; expires_in?: number; error?: { message?: string } }>(longLivedUrl.toString()).catch(() => shortLived);
  const accessToken = longLived.access_token ?? shortLived.access_token;
  const tokenExpiresAt = expiresInToIso(longLived.expires_in ?? shortLived.expires_in);
  const accounts = await fetchMetaAdAccounts(accessToken).catch(() => []);
  const account = accounts[0];

  return {
    accessToken,
    refreshToken: null,
    scopes: META_SCOPES,
    externalAccountId: account?.id ?? "meta_account_pending",
    externalAccountName: account?.name ?? "Meta Ads account",
    status: account ? "connected" : "needs_attention",
    tokenExpiresAt,
    metadata: {
      meta: {
        metaAdAccountId: account?.id ?? "",
        pageId: "",
        instagramActorId: null,
        pixelId: null,
        leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
        privacyPolicyUrl: "",
        currency: account?.currency ?? "AUD",
        timezone: account?.timezone ?? "Australia/Perth",
        tokenExpiresAt,
      },
    },
  };
}

async function exchangeGoogleCode(request: NextRequest, code: string): Promise<OAuthTokenExchange> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const token = await fetchJson<{
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error_description?: string;
    error?: string;
  }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getOAuthRedirectUri(request, "google"),
      grant_type: "authorization_code",
    }),
  });

  if (!token.access_token) {
    throw new Error(token.error_description ?? token.error ?? "Google OAuth did not return an access token.");
  }

  const accounts = await fetchGoogleAccessibleCustomers(token.access_token).catch(() => []);
  const account = accounts[0];

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scopes: token.scope?.split(/\s+/).filter(Boolean) ?? GOOGLE_SCOPES,
    externalAccountId: account?.id ?? "google_ads_account_pending",
    externalAccountName: account?.name ?? "Google Ads account",
    status: account ? "connected" : "needs_attention",
  };
}

function expiresInToIso(expiresIn: number | undefined): string | null {
  return typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
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
