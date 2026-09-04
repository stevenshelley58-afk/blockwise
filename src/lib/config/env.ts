import { resolveSupabaseServerCredential } from "../supabase/credentials.ts";
import { getBookingProviderReadiness } from "../booking/provider.ts";

export const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
] as const;

// Provider integrations have their own readiness gates so the top-level
// deployment can report ready even when an optional provider (e.g. Google
// Ads) has not been wired up yet. This is also what Meta App Review expects
// to see on /api/health.
export const PROVIDER_ENV_KEYS = {
  ai: ["OPENAI_API_KEY"],
  meta: ["META_APP_ID", "META_APP_SECRET"],
  google: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
} as const;

export type ProviderKey = keyof typeof PROVIDER_ENV_KEYS;

export const RECOMMENDED_SECURITY_ENV_KEYS = [
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "CLOUDFLARE_AI_GATEWAY_URL",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
] as const;

const MAIL_REQUIRED_ENV_KEYS = [
  "BLOCKWISE_MAIL_HOSTNAME",
  "BLOCKWISE_MAIL_DOMAIN",
  "BLOCKWISE_MAIL_PUBLIC_URL",
  "STALWART_WEBHOOK_SECRET",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
] as const;

const AUTH_SMTP_REQUIRED_ENV_KEYS = [
  "BLOCKWISE_AUTH_SMTP_HOST",
  "BLOCKWISE_AUTH_SMTP_USER",
  "BLOCKWISE_AUTH_SMTP_PASS",
  "BLOCKWISE_AUTH_SMTP_ADMIN_EMAIL",
] as const;

export const FIRST_TESTER_ENV_KEYS = [
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "CRON_SECRET",
  "RESEND_API_KEY",
  "DEMO_NOTIFY_FROM",
  "DEMO_NOTIFY_TO",
] as const;

const PLACEHOLDER_ENV_PATTERNS = [
  /^replace(_me|_with)/i,
  /^replace[-_]/i,
  /^proj_replace/i,
  /^example(\.|$)/i,
  /^https:\/\/example\.supabase\.co$/i,
  /^your_/i,
] as const;

export function getMissingEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => {
    if (key === "SUPABASE_SERVICE_ROLE_KEY") return !resolveSupabaseServerCredential(env);
    return !env[key];
  });
}

export function getInvalidEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = key === "SUPABASE_SERVICE_ROLE_KEY"
      ? resolveSupabaseServerCredential(env)?.value
      : env[key]?.trim();

    return !value || PLACEHOLDER_ENV_PATTERNS.some((pattern) => pattern.test(value));
  });
}

export function getMissingRecommendedSecurityEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return RECOMMENDED_SECURITY_ENV_KEYS.filter((key) => !env[key]);
}

export function getInvalidFirstTesterEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return uniqueStrings([
    ...getInvalidEnvKeys(env),
    ...FIRST_TESTER_ENV_KEYS.filter((key) => isMissingOrPlaceholder(env[key])),
  ]);
}

export function getProviderReadiness(
  provider: ProviderKey,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; missing: string[]; invalid: string[] } {
  const keys = PROVIDER_ENV_KEYS[provider];
  const missing = keys.filter((key) => !env[key]);
  const invalid = keys.filter((key) => isMissingOrPlaceholder(env[key]));

  return { ok: invalid.length === 0, missing, invalid };
}

export function getAllProviderReadiness(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    (Object.keys(PROVIDER_ENV_KEYS) as ProviderKey[]).map((provider) => [
      provider,
      getProviderReadiness(provider, env),
    ]),
  ) as Record<ProviderKey, ReturnType<typeof getProviderReadiness>>;
}

/**
 * Mail is opt-in for local/preview environments, but once enabled it is a
 * production dependency. Do not report a healthy app with an unconfigured
 * GoTrue or outbox transport: signup/recovery would otherwise fail at send
 * time and queued mail could be stranded.
 */
export function getMailReadiness(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.BLOCKWISE_MAIL_ENABLED?.trim().toLowerCase() === "true";
  const deploymentEnv = env.BLOCKWISE_DEPLOYMENT_ENV?.trim().toLowerCase();
  const production = deploymentEnv === "production" || (!deploymentEnv && env.NODE_ENV?.trim().toLowerCase() === "production");
  if (!enabled) {
    return production
      ? { enabled: false, ok: false, missing: ["BLOCKWISE_MAIL_ENABLED"], invalid: ["BLOCKWISE_MAIL_ENABLED"] }
      : { enabled: false, ok: true, missing: [], invalid: [] };
  }

  const missing: string[] = [
    ...MAIL_REQUIRED_ENV_KEYS,
    ...AUTH_SMTP_REQUIRED_ENV_KEYS,
  ].filter((key) => !env[key]?.trim());
  const invalid = [...missing];
  const publicUrl = env.BLOCKWISE_MAIL_PUBLIC_URL?.trim();
  const smtpPort = Number(env.SMTP_PORT ?? 587);
  const authSmtpPort = Number(env.BLOCKWISE_AUTH_SMTP_PORT ?? 587);

  if (publicUrl) {
    try {
      const url = new URL(publicUrl);
      if (url.protocol !== "https:") invalid.push("BLOCKWISE_MAIL_PUBLIC_URL");
      if (isLocalOrManagedHost(url.hostname)) invalid.push("BLOCKWISE_MAIL_PUBLIC_URL");
    } catch {
      invalid.push("BLOCKWISE_MAIL_PUBLIC_URL");
    }
  }
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) invalid.push("SMTP_PORT");
  if (!Number.isInteger(authSmtpPort) || authSmtpPort < 1 || authSmtpPort > 65535) invalid.push("BLOCKWISE_AUTH_SMTP_PORT");
  for (const key of ["SMTP_HOST", "BLOCKWISE_AUTH_SMTP_HOST"] as const) {
    const host = env[key]?.trim();
    if (host && /[\s/:]/u.test(host)) invalid.push(key);
  }
  if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== "smtp") invalid.push("EMAIL_PROVIDER");
  // This non-secret receipt is supplementary. The real GoTrue identity and
  // app identity must both be present above; a manually toggled flag alone
  // can never make readiness healthy. The host validator sets this only after
  // a live TLS + AUTH check, and the values are never exposed in health JSON.
  if (env.BLOCKWISE_AUTH_SMTP_CONFIGURED?.trim().toLowerCase() !== "true") {
    invalid.push("BLOCKWISE_AUTH_SMTP_CONFIGURED");
  }

  return {
    enabled: true,
    ok: missing.length === 0 && invalid.length === 0,
    missing: Array.from(new Set(missing)),
    invalid: Array.from(new Set(invalid)),
  };
}

export function getDeploymentReadiness(env: NodeJS.ProcessEnv = process.env) {
  const missing = getMissingEnvKeys(env);
  const invalid = getInvalidEnvKeys(env);
  const missingRecommendedSecurity = getMissingRecommendedSecurityEnvKeys(env);
  const invalidFirstTester = getInvalidFirstTesterEnvKeys(env);
  const providers = getAllProviderReadiness(env);
  const mail = getMailReadiness(env);
  const booking = getBookingProviderReadiness(env);
  const allInvalid = uniqueStrings([...invalid, ...mail.invalid]);

  return {
    ok: allInvalid.length === 0,
    missing,
    invalid: allInvalid,
    firstTester: {
      ok: invalidFirstTester.length === 0,
      invalid: invalidFirstTester,
      requiredCount: uniqueStrings([...REQUIRED_ENV_KEYS, ...FIRST_TESTER_ENV_KEYS]).length,
    },
    security: {
      recommendedOk: missingRecommendedSecurity.length === 0,
      missingRecommended: missingRecommendedSecurity,
    },
    providers,
    mail,
    booking,
    requiredCount: REQUIRED_ENV_KEYS.length,
    checkedAt: new Date().toISOString(),
  };
}

function isLocalOrManagedHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === "localhost" || isReservedIp(host) || host.endsWith(".vercel.app") || host.endsWith(".supabase.co");
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/u, "");
}

/** Reject hosts that cannot be an external production mail target. */
function isReservedIp(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && octets[2] === 0) || (a === 192 && b === 0 && octets[2] === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && b >= 18 && b <= 19) || (a === 198 && b === 51 && octets[2] === 100) ||
      (a === 203 && b === 0 && octets[2] === 113) || a >= 224;
  }
  if (!host.includes(":")) return false;
  const first = Number.parseInt(host.split(":")[0] || "0", 16);
  const second = Number.parseInt(host.split(":")[1] || "0", 16);
  return host === "::" || host === "::1" || (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 || (first === 0x2001 && second === 0x0db8) ||
    (first & 0xff00) === 0xff00 || host.startsWith("::ffff:") && isReservedIp(host.slice(7));
}

function isMissingOrPlaceholder(rawValue: string | undefined): boolean {
  const value = rawValue?.trim();

  return !value || PLACEHOLDER_ENV_PATTERNS.some((pattern) => pattern.test(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

export function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

    if (!match) {
      continue;
    }

    let value = match[2] ?? "";

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[match[1]] = value;
  }

  return parsed;
}
