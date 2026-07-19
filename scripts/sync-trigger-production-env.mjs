import { configure, envvars, runs } from "@trigger.dev/sdk";

const accessToken = process.env.TRIGGER_ACCESS_TOKEN?.trim();
const projectRef = process.env.TRIGGER_PROJECT_ID?.trim();

if (!accessToken || !projectRef) {
  throw new Error("Trigger deployment credentials are required to sync production environment variables.");
}

// Trigger tasks receive only the release secrets used by their runtime. Keep
// unrelated billing, auth, and integration secrets out of the worker.
const allowlist = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "OPENAI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "META_APP_ID",
  "META_APP_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "BLOCKWISE_ENABLE_PROVIDER_WRITES",
];

const variables = Object.fromEntries(
  allowlist
    .map((name) => [name, process.env[name]?.trim()])
    .filter((entry) => Boolean(entry[1])),
);

const hasSupabaseUrl = Boolean(variables.NEXT_PUBLIC_SUPABASE_URL || variables.SUPABASE_URL);
const hasSupabaseCredential = Boolean(variables.SUPABASE_SECRET_KEY || variables.SUPABASE_SERVICE_ROLE_KEY);
if (!hasSupabaseUrl || !hasSupabaseCredential) {
  throw new Error("The release environment is missing the Supabase runtime required by Trigger tasks.");
}

const supabaseUrl = variables.NEXT_PUBLIC_SUPABASE_URL || variables.SUPABASE_URL;
try {
  const parsed = new URL(supabaseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported protocol");
} catch {
  throw new Error("The release environment has an invalid Supabase URL.");
}

configure({ secretKey: accessToken });
await envvars.upload(projectRef, "prod", { variables, override: true });
console.log(`Synced ${Object.keys(variables).length} allowlisted production variables to Trigger.dev.`);

// Leave a safe post-deploy signal in the release log. This catches runs that
// dispatch successfully but are waiting for a compatible production version.
const recentRuns = await runs.list(projectRef, {
  env: "prod",
  limit: 10,
  period: "1h",
  taskIdentifier: "adstudio.generate.template",
});
for (const run of recentRuns.data) {
  console.log(
    `Trigger run ${run.id}: ${run.status} (version ${run.version ?? "unassigned"}, created ${run.createdAt.toISOString()})`,
  );
}
