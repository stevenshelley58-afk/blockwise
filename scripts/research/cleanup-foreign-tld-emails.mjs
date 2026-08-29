#!/usr/bin/env node
// Revert enriched emails whose domain has a foreign country-code TLD (wrong person).
// Sets email back to null and marks enrichment found:false / reverted:true.
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

const FOREIGN_CCTLD = [
  ".ca", ".us", ".uk", ".nz", ".za", ".in", ".sg", ".ie", ".ae", ".hk",
  ".cn", ".jp", ".de", ".fr", ".nl", ".es", ".it", ".br", ".mx", ".ph",
  ".my", ".th", ".id", ".vn", ".pk", ".bd", ".lk", ".ru", ".se", ".no",
];

async function fetchAll(query) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows = rows.concat(data ?? []);
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const env = { ...process.env, ...loadEnv(".env.local") };
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  if (!url || !resolveSupabaseServerCredential(env)) throw new Error("Missing Supabase server credentials");
  const research = createSupabaseServerClient(createClient, url, env, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const enriched = await fetchAll(() =>
    research
      .from("agents")
      .select("id,full_name,email,metadata")
      .filter("metadata->email_enrichment->>found", "eq", "true"),
  );

  const suspicious = enriched.filter((row) => {
    const domain = String(row.email ?? "").split("@")[1] ?? "";
    return FOREIGN_CCTLD.some((tld) => domain.endsWith(tld));
  });

  console.log(`Found ${suspicious.length} foreign-TLD enriched emails to revert (dryRun=${dryRun}).`);
  let reverted = 0;
  const now = new Date().toISOString();
  for (const row of suspicious) {
    console.log(`  revert ${row.full_name} -> ${row.email}`);
    if (dryRun) continue;
    const metadata = {
      ...(row.metadata ?? {}),
      email_enrichment: {
        ...(row.metadata?.email_enrichment ?? {}),
        found: false,
        reverted: true,
        revert_reason: "foreign_cctld_likely_wrong_person",
        reverted_at: now,
      },
    };
    const { error } = await research
      .from("agents")
      .update({ email: null, metadata, updated_at: now })
      .eq("id", row.id);
    if (error) console.error(`    error: ${error.message}`);
    else reverted += 1;
  }
  console.log(`Reverted ${reverted} records.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
