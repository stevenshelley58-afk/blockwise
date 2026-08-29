#!/usr/bin/env node
// Quick stats on the email enrichment progress.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/u, "").trim();
}

function loadEnv(path) {
  const env = {};
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, eq).trim()] = clean(value);
  }
  return env;
}

async function main() {
  const env = { ...process.env, ...loadEnv(".env.local") };
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  if (!url || !resolveSupabaseServerCredential(env)) throw new Error("Missing Supabase server credentials");
  const research = createSupabaseServerClient(createClient, url, env, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { count: total } = await research.from("agents").select("*", { count: "exact", head: true });
  const { count: haveEmail } = await research.from("agents").select("*", { count: "exact", head: true }).not("email", "is", null).neq("email", "");
  const { count: enriched } = await research.from("agents").select("*", { count: "exact", head: true }).filter("metadata->email_enrichment->>found", "eq", "true");
  const { count: searched } = await research.from("agents").select("*", { count: "exact", head: true }).not("metadata->email_enrichment->>searched_at", "is", null);
  const { count: reverted } = await research.from("agents").select("*", { count: "exact", head: true }).filter("metadata->email_enrichment->>reverted", "eq", "true");

  // Top source domains for enriched emails
  const { data: enrichedRows } = await research
    .from("agents")
    .select("email,metadata")
    .filter("metadata->email_enrichment->>found", "eq", "true")
    .limit(500);

  const domainCounts = {};
  for (const row of enrichedRows ?? []) {
    const domain = (row.email || "").split("@")[1] || "unknown";
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }
  const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  console.log(JSON.stringify({
    total_agents: total,
    have_email: haveEmail,
    missing_email: total - haveEmail,
    enriched_by_exa: enriched,
    searched_at_least_once: searched,
    unsearched_remaining: (total - haveEmail) - searched + enriched,
    reverted_cleanups: reverted,
    coverage_pct: ((haveEmail / total) * 100).toFixed(1) + "%",
    top_source_domains: topDomains,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
