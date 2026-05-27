const required = [
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
];

const recommendedSecurity = [
  "CLOUDFLARE_AI_GATEWAY_URL",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "AGENT_ALLOWED_OUTBOUND_DOMAINS",
  "SECURITY_AUDIT_LOG_DRAIN_URL",
];

const missing = required.filter((key) => !process.env[key]);
const missingRecommendedSecurity = recommendedSecurity.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

if (missingRecommendedSecurity.length > 0) {
  console.warn(
    `Missing recommended production security variables: ${missingRecommendedSecurity.join(", ")}`,
  );
}

console.log("All required Blockwise environment variables are present.");
