function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/u, "").trim();
}

export function isLegacySupabaseJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

export function resolveHermesSupabaseCredential(env = process.env) {
  for (const source of [
    "HERMES_SUPABASE_SECRET_KEY",
    "HERMES_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    const value = clean(env[source]);
    if (value) return { value, kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret", source };
  }
  return null;
}

export function resolveHermesCustomerSupabaseCredential(env = process.env) {
  for (const source of ["HERMES_CUSTOMER_SUPABASE_SECRET_KEY", "HERMES_CUSTOMER_SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = clean(env[source]);
    if (value) return { value, kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret", source };
  }
  return null;
}

export function assertHermesOwnedStorageUrl(value) {
  const url = clean(value).replace(/\/+$/u, "");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("HERMES_RESEARCH_STORAGE_URL must be an absolute URL");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!url || !hostname || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("HERMES_RESEARCH_STORAGE_URL must be an HTTP(S) URL");
  }
  if (hostname.endsWith(".supabase.co") || hostname === "supabase.co" || hostname.endsWith(".supabase.com") || hostname === "supabase.com") {
    throw new Error("HERMES_RESEARCH_STORAGE_URL must point at Hermes-owned Storage API");
  }
  return url;
}

export function resolveHermesResearchStorageCredential(env = process.env) {
  for (const source of ["HERMES_RESEARCH_STORAGE_SECRET_KEY", "HERMES_RESEARCH_STORAGE_SERVICE_ROLE_KEY"]) {
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
