#!/usr/bin/env node
// Verify email enrichment writes in research.agents and flag suspicious matches.
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

  const searchedNoEmail = await fetchAll(() =>
    research
      .from("agents")
      .select("id")
      .filter("metadata->email_enrichment->>found", "eq", "false"),
  );

  const suspicious = enriched.filter((row) => {
    const domain = String(row.email ?? "").split("@")[1] ?? "";
    return FOREIGN_CCTLD.some((tld) => domain.endsWith(tld));
  });

  console.log(
    JSON.stringify(
      {
        enriched_with_email: enriched.length,
        searched_no_email: searchedNoEmail.length,
        suspicious_foreign_tld: suspicious.length,
      },
      null,
      2,
    ),
  );

  console.log("\nENRICHED SAMPLE (up to 15):");
  for (const row of enriched.slice(0, 15)) {
    const enr = row.metadata?.email_enrichment ?? {};
    console.log(`  ${row.full_name} -> ${row.email} [score ${enr.score}] ${enr.source_url}`);
  }

  if (suspicious.length) {
    console.log("\nSUSPICIOUS (foreign TLD) - candidates to revert:");
    for (const row of suspicious) {
      const enr = row.metadata?.email_enrichment ?? {};
      console.log(`  id=${row.id} ${row.full_name} -> ${row.email} ${enr.source_url}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
