#!/usr/bin/env node
// Retroactively re-validate enriched emails against the stricter AU + well-formed
// rules, without re-calling Exa. Reverts non-AU / malformed matches, and corrects
// "email"-prefixed local-parts in place.
//   node scripts/research/cleanup-enrichment-v2.mjs [--dry-run]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";
import {
  normalizeEmail,
  isWellFormedEmail,
  hasAuAttribution,
} from "../lib/email-validation.mjs";

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

  const now = new Date().toISOString();
  const kept = [];
  const corrected = [];
  const revertedMalformed = [];
  const revertedNonAu = [];

  for (const row of enriched) {
    const enr = row.metadata?.email_enrichment ?? {};
    const reasons = Array.isArray(enr.reasons) ? enr.reasons : [];
    const sourceUrl = enr.source_url ?? "";
    const correctedEmail = normalizeEmail(row.email);

    if (!correctedEmail || !isWellFormedEmail(correctedEmail)) {
      revertedMalformed.push({ id: row.id, full_name: row.full_name, email: row.email, source_url: sourceUrl });
      if (!dryRun) {
        const metadata = {
          ...(row.metadata ?? {}),
          email_enrichment: { method: "exa_search", found: false, reverted: true, revert_reason: "malformed_email", original_email: row.email, reverted_at: now },
        };
        await research.from("agents").update({ email: null, metadata, updated_at: now }).eq("id", row.id);
      }
      continue;
    }

    if (!hasAuAttribution(correctedEmail, sourceUrl, reasons)) {
      revertedNonAu.push({ id: row.id, full_name: row.full_name, email: correctedEmail, source_url: sourceUrl });
      if (!dryRun) {
        const metadata = {
          ...(row.metadata ?? {}),
          email_enrichment: { ...enr, found: false, reverted: true, revert_reason: "no_au_attribution", original_email: row.email, reverted_at: now },
        };
        await research.from("agents").update({ email: null, metadata, updated_at: now }).eq("id", row.id);
      }
      continue;
    }

    if (correctedEmail !== String(row.email).toLowerCase()) {
      corrected.push({ id: row.id, full_name: row.full_name, from: row.email, to: correctedEmail });
      if (!dryRun) {
        const metadata = {
          ...(row.metadata ?? {}),
          email_enrichment: { ...enr, corrected_from: row.email },
        };
        await research.from("agents").update({ email: correctedEmail, metadata, updated_at: now }).eq("id", row.id);
      }
      continue;
    }

    kept.push({ id: row.id, full_name: row.full_name, email: row.email });
  }

  console.log(
    JSON.stringify(
      {
        dry_run: dryRun,
        total_enriched: enriched.length,
        kept: kept.length,
        corrected_in_place: corrected.length,
        reverted_malformed: revertedMalformed.length,
        reverted_non_au: revertedNonAu.length,
      },
      null,
      2,
    ),
  );

  if (corrected.length) {
    console.log("\nCORRECTED:");
    for (const row of corrected) console.log(`  ${row.full_name}: ${row.from} -> ${row.to}`);
  }
  if (revertedMalformed.length) {
    console.log("\nREVERTED (malformed):");
    for (const row of revertedMalformed) console.log(`  ${row.full_name}: ${row.email} (${row.source_url})`);
  }
  if (revertedNonAu.length) {
    console.log("\nREVERTED (no AU attribution):");
    for (const row of revertedNonAu) console.log(`  ${row.full_name}: ${row.email} (${row.source_url})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
