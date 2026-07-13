function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/u, "").trim();
}

export function isLegacySupabaseJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

export function resolveHermesSupabaseCredential(env = process.env) {
  for (const source of ["HERMES_SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEY"]) {
    const value = clean(env[source]);
    if (value) return { value, kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret", source };
  }
  for (const source of ["HERMES_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = clean(env[source]);
    if (value) return { value, kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret", source };
  }
  return null;
}

export function hermesSupabaseHeaders(credential, initialHeaders = {}) {
  if (!credential?.value) throw new Error("Missing Hermes Supabase server credential");

  const headers = new Headers(initialHeaders);
  headers.set("apikey", credential.value);
  const authorization = headers.get("Authorization");
  if (credential.kind === "legacy_jwt" && (!authorization || authorization === `Bearer ${credential.value}`)) {
    headers.set("Authorization", `Bearer ${credential.value}`);
  } else if (credential.kind === "secret" && authorization === `Bearer ${credential.value}`) {
    headers.delete("Authorization");
  }
  return Object.fromEntries(headers.entries());
}
