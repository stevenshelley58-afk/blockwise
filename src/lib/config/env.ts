import { resolveSupabaseServerCredential } from "../supabase/credentials.ts";

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

  const missing: string[] = MAIL_REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
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
  if (env.EMAIL_PROVIDER?.trim().toLowerCase() !== "smtp") invalid.push("EMAIL_PROVIDER");
  // This is a non-secret operator receipt: the host-side validator checks the
  // actual GoTrue credentials, while the app only needs to know that check
  // completed. Never inject the GoTrue password into product-app.
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
    requiredCount: REQUIRED_ENV_KEYS.length,
    checkedAt: new Date().toISOString(),
  };
}

function isLocalOrManagedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".vercel.app") || host.endsWith(".supabase.co");
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
