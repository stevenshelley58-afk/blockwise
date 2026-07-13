export type SupabaseServerCredential = {
  value: string;
  kind: "secret" | "legacy_jwt";
  source: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY";
};

export type SupabaseServerEnv = Readonly<Record<string, string | undefined>>;

export function cleanSupabaseEnv(value?: string): string {
  return value?.replace(/^\uFEFF/u, "").trim() ?? "";
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
): typeof fetch {
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

    return fetchImpl(input, { ...init, headers });
  };
}
