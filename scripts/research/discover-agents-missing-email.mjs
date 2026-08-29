#!/usr/bin/env node
// Discovery: count research.agents missing email and print a sample with agency join.
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

async function fetchAll(query) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; from < 100000; from += pageSize) {
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

  const all = await fetchAll(() =>
    research.from("agents").select("id,email,status,state"),
  );

  const missing = all.filter((row) => !clean(row.email));
  const byState = {};
  const byStatus = {};
  for (const row of missing) {
    byState[row.state] = (byState[row.state] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        total_agents: all.length,
        missing_email: missing.length,
        have_email: all.length - missing.length,
        missing_by_state: byState,
        missing_by_status: byStatus,
      },
      null,
      2,
    ),
  );

  // Sample with agency join
  const sample = await research
    .from("agents")
    .select(
      "id,full_name,primary_suburb,primary_postcode,website_url,status,agency_id,agencies(name,trading_name,website_url)",
    )
    .or("email.is.null,email.eq.")
    .limit(20);
  if (sample.error) throw new Error(sample.error.message);
  console.log("\nSAMPLE (first 20 missing email):");
  console.log(JSON.stringify(sample.data, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
