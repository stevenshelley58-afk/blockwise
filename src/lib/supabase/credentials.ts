export type SupabaseServerCredential = {
  value: string;
  kind: "secret" | "legacy_jwt";
  source: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
};

export type SupabaseServerEnv = Readonly<Record<string, string | undefined>>;

export function cleanSupabaseEnv(value?: string): string {
  return value?.replace(/^\uFEFF/u, "").trim() ?? "";
}

/**
 * Origin for server-side Supabase traffic.
 *
 * Server code must not reach Supabase through the app's own public origin.
 * On the VPS that URL resolves to the host's public address, so every query
 * left the container, crossed the public TLS edge and came back: measured at
 * ~200 ms per request from inside the app container versus ~3 ms when the
 * request goes straight to the internal router. Every customer page pays this
 * per query, so the internal origin is both a correctness-of-topology fix and
 * the single largest server-side latency win.
 *
 * `BLOCKWISE_SUPABASE_SERVER_URL` is only ever set for the server runtime and
 * must stay an internal, plain-HTTP address. When it is absent the public URL
 * is used, which is what the browser and every non-VPS environment rely on.
 */
export function resolveSupabaseServerUrl(env: SupabaseServerEnv = process.env): string {
  const internal = cleanSupabaseEnv(env.BLOCKWISE_SUPABASE_SERVER_URL);
  if (internal) return internal.replace(/\/+$/u, "");
  return cleanSupabaseEnv(env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL).replace(/\/+$/u, "");
}

export function isLegacySupabaseJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

export function resolveSupabaseServerCredential(
  env: SupabaseServerEnv = process.env,
): SupabaseServerCredential | null {
  const secret = cleanSupabaseEnv(env.SUPABASE_SECRET_KEY);
  if (secret) {
    return {
      value: secret,
      kind: isLegacySupabaseJwt(secret) ? "legacy_jwt" : "secret",
      source: "SUPABASE_SECRET_KEY",
    };
  }

  const legacy = cleanSupabaseEnv(env.SUPABASE_SERVICE_ROLE_KEY);
  if (legacy) {
    return {
      value: legacy,
      kind: isLegacySupabaseJwt(legacy) ? "legacy_jwt" : "secret",
      source: "SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  return null;
}

export function supabaseServerCredentialHeaders(
  credential: SupabaseServerCredential,
): Record<string, string> {
  return {
    apikey: credential.value,
    ...(credential.kind === "legacy_jwt"
      ? { Authorization: `Bearer ${credential.value}` }
      : {}),
  };
}

export function createSupabaseServerFetch(
  credential: SupabaseServerCredential,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): typeof fetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Supabase server request timeout must be positive.");
  }

  return async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined),
    );
    headers.set("apikey", credential.value);
    const authorization = headers.get("Authorization");
    if (credential.kind === "legacy_jwt" && (!authorization || authorization === `Bearer ${credential.value}`)) {
      headers.set("Authorization", `Bearer ${credential.value}`);
    } else if (credential.kind === "secret" && authorization === `Bearer ${credential.value}`) {
      headers.delete("Authorization");
    }

    const inheritedSignal = init?.signal ?? (
      typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined
    );
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error(`Supabase request timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
    const signal = inheritedSignal
      ? AbortSignal.any([inheritedSignal, timeoutController.signal])
      : timeoutController.signal;

    try {
      return await fetchImpl(input, { ...init, headers, signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}
