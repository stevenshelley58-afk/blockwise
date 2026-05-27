export const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "TRIGGER_SECRET_KEY",
  "TRIGGER_PROJECT_ID",
  "META_APP_ID",
  "META_APP_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
] as const;

export const RECOMMENDED_SECURITY_ENV_KEYS = [
  "CLOUDFLARE_AI_GATEWAY_URL",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AGENT_ALLOWED_OUTBOUND_DOMAINS",
  "SECURITY_AUDIT_LOG_DRAIN_URL",
] as const;

const PLACEHOLDER_ENV_PATTERNS = [
  /^replace(_me|_with)/i,
  /^proj_replace/i,
  /^example(\.|$)/i,
  /^https:\/\/example\.supabase\.co$/i,
  /^your_/i,
] as const;

export function getMissingEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]);
}

export function getInvalidEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();

    return !value || PLACEHOLDER_ENV_PATTERNS.some((pattern) => pattern.test(value));
  });
}

export function getMissingRecommendedSecurityEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return RECOMMENDED_SECURITY_ENV_KEYS.filter((key) => !env[key]);
}

export function getDeploymentReadiness(env: NodeJS.ProcessEnv = process.env) {
  const missing = getMissingEnvKeys(env);
  const invalid = getInvalidEnvKeys(env);
  const missingRecommendedSecurity = getMissingRecommendedSecurityEnvKeys(env);

  return {
    ok: invalid.length === 0,
    missing,
    invalid,
    security: {
      recommendedOk: missingRecommendedSecurity.length === 0,
      missingRecommended: missingRecommendedSecurity,
    },
    requiredCount: REQUIRED_ENV_KEYS.length,
    checkedAt: new Date().toISOString(),
  };
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
