export type SupabaseServerCredential = {
  value: string;
  kind: "secret" | "legacy_jwt";
  source: "SUPABASE_SECRET_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_SERVICE_ROLE_KEY_FILE";
};

export type SupabaseServerEnv = Readonly<Record<string, string | undefined>>;

export function cleanSupabaseEnv(value?: string): string {
  return value?.replace(/^\uFEFF/u, "").trim() ?? "";
}

export function isLegacySupabaseJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value);
}

function readRootOwnedSecretFile(path: string): string {
  if (!path.startsWith("/")) throw new Error("SUPABASE_SERVICE_ROLE_KEY_FILE must be absolute.");
  const getBuiltinModule = (process as typeof process & { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  const fs = getBuiltinModule?.("node:fs") as {
    lstatSync: (file: string) => { isFile(): boolean; isSymbolicLink(): boolean; uid?: number; mode: number };
    readFileSync: (file: string, encoding: string) => string;
  } | undefined;
  if (!fs) throw new Error("node:fs is unavailable for SUPABASE_SERVICE_ROLE_KEY_FILE.");
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077) !== 0) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_FILE must be a root-owned 0600 regular file.");
  }
  return cleanSupabaseEnv(fs.readFileSync(path, "utf8"));
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

  const file = cleanSupabaseEnv(env.SUPABASE_SERVICE_ROLE_KEY_FILE);
  if (file) {
    const value = readRootOwnedSecretFile(file);
    if (value) {
      return {
        value,
        kind: isLegacySupabaseJwt(value) ? "legacy_jwt" : "secret",
        source: "SUPABASE_SERVICE_ROLE_KEY_FILE",
      };
    }
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
