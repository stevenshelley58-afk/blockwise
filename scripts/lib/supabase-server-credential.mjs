function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/u, "").trim();
}

export function isLegacySupabaseJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

export function resolveSupabaseServerCredential(env = process.env) {
  const secret = clean(env.SUPABASE_SECRET_KEY);
  if (secret) {
    return { value: secret, kind: isLegacySupabaseJwt(secret) ? "legacy_jwt" : "secret", source: "SUPABASE_SECRET_KEY" };
  }

  for (const source of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SERVICE_ROLE_KEY"]) {
    const value = clean(env[source]);
    if (value) return { value, kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret", source };
  }
  return null;
}

export function createSupabaseServerFetch(credential, fetchImpl = fetch) {
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

export function createSupabaseServerClient(createClient, supabaseUrl, env = process.env, options = {}) {
  const credential = resolveSupabaseServerCredential(env);
  if (!credential) throw new Error("Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, credential.value, {
    ...options,
    global: {
      ...(options.global || {}),
      fetch: createSupabaseServerFetch(credential, options.global?.fetch),
    },
  });
}
