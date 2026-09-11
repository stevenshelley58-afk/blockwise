/**
 * Recovery for a provider callback that lands on the wrong route.
 *
 * GoTrue returns the browser to the app after Google (or another provider)
 * finishes. Its error path honours the stored `redirect_to`, but its success
 * path was measured sending the browser to the site root with the auth code in
 * the query string. Without this, the code is stranded on the marketing page,
 * no session is ever created, and the customer sees the homepage instead of
 * their workspace while the provider thinks the sign-in succeeded.
 *
 * Any public route that can receive those parameters forwards them to
 * /auth/confirm, which is the only place that exchanges the code for a session.
 */

/** Parameters that identify a provider callback rather than a real query. */
const CALLBACK_PARAMETERS = ["code", "error", "error_code", "error_description"] as const;

/**
 * `error` alone is not proof of a provider callback: the sign-in page uses
 * /login?error=confirm_failed to show its own message. Recovering on that would
 * redirect the page to itself forever.
 */
const OWN_ERROR_VALUES = new Set(["confirm_failed"]);

const CONFIRM_PATH = "/auth/confirm";

/** Rebuild a query string from Next's searchParams shape. */
export function searchParamsToQuery(params: Record<string, string | string[] | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  return search.toString();
}

/** Strip a redirect back to the confirm route itself, so this cannot loop. */
function withoutConfirmParameters(search: string): string {
  const params = new URLSearchParams(search);
  for (const name of CALLBACK_PARAMETERS) params.delete(name);
  return params.toString();
}

/**
 * Returns the /auth/confirm target for a provider callback that arrived on the
 * wrong route, or null when the query is not a callback at all.
 */
export function providerCallbackRecovery(search: string): string | null {
  const params = new URLSearchParams(search);

  const isCallback =
    params.has("code") ||
    params.has("error_code") ||
    params.has("error_description") ||
    (params.has("error") && !OWN_ERROR_VALUES.has(params.get("error") ?? ""));
  if (!isCallback) return null;

  const target = new URLSearchParams();
  for (const name of CALLBACK_PARAMETERS) {
    const value = params.get(name);
    if (value !== null) target.set(name, value);
  }

  // Keep every other parameter, such as next and flow, so the confirm route
  // still knows where to send the customer afterwards.
  const carried = withoutConfirmParameters(search);
  const query = [target.toString(), carried].filter(Boolean).join("&");
  return `${CONFIRM_PATH}?${query}`;
}
