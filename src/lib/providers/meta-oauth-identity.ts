import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import { requestDeadline } from "./request-deadline.ts";

/** Identity lookup runs inside the OAuth callback; bound it like the token swap. */
const META_IDENTITY_TIMEOUT_MS = 10_000;

export async function fetchMetaUserIdentity(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${DEFAULT_META_GRAPH_VERSION}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", accessToken);
  const response = await fetchImpl(url.toString(), {
    cache: "no-store",
    signal: requestDeadline(META_IDENTITY_TIMEOUT_MS),
  });
  const payload = (await response.json()) as { id?: unknown; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Meta identity request failed with ${response.status}.`);
  }
  if (typeof payload.id !== "string" || !payload.id.trim()) {
    throw new Error("Meta OAuth did not return a user identity.");
  }
  return payload.id.trim();
}
