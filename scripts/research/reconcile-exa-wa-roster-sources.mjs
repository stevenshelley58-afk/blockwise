#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "../lib/supabase-server-credential.mjs";

const SOURCE = "exa_roster_search";
const NOW = () => new Date().toISOString();

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\uFEFF/g, "").trim();
}

function loadEnv(path) {
  const env = {};
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[clean(line.slice(0, eq))] = clean(value);
  }
  return env;
}

function parseArgs(argv) {
  const args = { dryRun: false, limit: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--limit":
        args.limit = Number.parseInt(next(), 10);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  const small = new Set(["and", "of", "the", "in", "with", "for"]);
  return normalizeName(value)
    .split(" ")
    .map((part, index) => (index > 0 && small.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function urlPath(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function slugName(url, marker) {
  const path = urlPath(url);
  const slug = path.split(marker)[1]?.split("/").filter(Boolean)[0];
  if (!slug) return null;
  const withoutIds = slug.replace(/-\d+(?:-\d+)*$/g, "");
  return titleCase(withoutIds.replace(/-/g, " "));
}

function stripSourceSuffix(value) {
  return clean(value)
    .replace(/\s*-\s*REIWA\s*$/i, "")
    .replace(/\s*\|\s*Real Estate Agent.*$/i, "")
    .replace(/\s*\|\s*Real Estate Agency.*$/i, "")
    .replace(/\s*\|\s*View Listings, Sales & More.*$/i, "")
    .replace(/\s*-\s*realestate\.com\.au\s*$/i, "")
    .trim();
}

function genericDirectoryTitle(title) {
  return /^(find & compare|reiwa$|real estate agents in|real estate agencies in|\d+\s+real estate agencies active|\d+\s+real estate agents active|find real estate agents)/i.test(
    clean(title),
  );
}

function personLike(name) {
  const normalized = normalizeName(name);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return !/\b(real|estate|property|properties|agency|agencies|group|sales|management|leasing|listings|active|directory|pty|ltd|company|team)\b/i.test(
    normalized,
  );
}

function agencyLike(name) {
  const normalized = normalizeName(name);
  if (normalized.length < 3 || normalized.length > 120) return false;
  if (personLike(name)) return false;
  return !/\b(real estate agents in|real estate agencies in|active in|find and compare|permission denied|forbidden)\b/i.test(normalized);
}

function candidatePostcode(row) {
  return clean(row.metadata?.postcode || row.metadata?.matched_postcodes?.[0] || "");
}

function candidateSuburb(row) {
  return clean(row.metadata?.suburb || row.metadata?.matched_suburbs?.[0] || "");
}

function sourceKind(row) {
  const path = urlPath(row.source_url);
  if (path.includes("/real-estate-agent/")) return "agent";
  if (path.includes("/real-estate-agency/")) return "agency";
  if (path.includes("/real-estate-agencies/") && !genericDirectoryTitle(row.metadata?.title)) return "agency";
  if (!["reiwa.com.au", "domain.com.au", "realestate.com.au", "ratemyagent.com.au"].includes(row.metadata?.domain)) return "agency";
  return null;
}

function agencyNameFromRow(row) {
  const title = stripSourceSuffix(row.metadata?.title);
  const fromReiwa = slugName(row.source_url, "/real-estate-agency/");
  const name = fromReiwa || title.split("|")[0].trim();
  return agencyLike(name) ? name : null;
}

function agentFromRow(row) {
  const title = stripSourceSuffix(row.metadata?.title);
  const fullName = slugName(row.source_url, "/real-estate-agent/") || title.split("|")[0].split(" - ")[0].trim();
  if (!personLike(fullName)) return null;
  const agencyHint = title.includes(" - ") ? stripSourceSuffix(title.split(" - ").slice(1).join(" - ")) : null;
  return {
    fullName,
    agencyHint: agencyHint && agencyLike(agencyHint) ? agencyHint : null,
  };
}

async function fetchAll(queryFactory, limit = 0) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; ; from += pageSize) {
    const rangeEnd = limit > 0 ? Math.min(from + pageSize - 1, limit - 1) : from + pageSize - 1;
    const { data, error } = await queryFactory().range(from, rangeEnd);
    if (error) throw new Error(error.message);
    rows = rows.concat(data ?? []);
    if (!data || data.length < pageSize || (limit > 0 && rows.length >= limit)) break;
  }
  return limit > 0 ? rows.slice(0, limit) : rows;
}

async function findAgency(research, normalizedName) {
  const { data, error } = await research
    .from("agencies")
    .select("id,name,metadata,website_url,primary_postcode,primary_suburb,status,confidence")
    .eq("state", "WA")
    .eq("normalized_name", normalizedName)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function findAgencyByName(research, name) {
  const { data, error } = await research
    .from("agencies")
    .select("id,name,metadata,website_url,primary_postcode,primary_suburb,status,confidence")
    .eq("state", "WA")
    .ilike("name", name)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function upsertAgency(research, stats, input, dryRun) {
  const normalized = normalizeName(input.name);
  const existing = await findAgency(research, normalized);
  const metadata = {
    ...(existing?.metadata || {}),
    exa_roster_search: {
      source_document_id: input.sourceDocumentId,
      source_url: input.sourceUrl,
      evidence_title: input.evidenceTitle,
      seen_at: NOW(),
    },
  };

  if (existing) {
    stats.agenciesMatched += 1;
    if (!dryRun) {
      const patch = {
        metadata,
        last_seen_at: NOW(),
      };
      if (!existing.website_url && input.websiteUrl) patch.website_url = input.websiteUrl;
      if (!existing.primary_postcode && input.postcode) patch.primary_postcode = input.postcode;
      if (!existing.primary_suburb && input.suburb) patch.primary_suburb = input.suburb;
      const { error } = await research.from("agencies").update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return existing.id;
  }

  stats.agenciesInserted += 1;
  if (dryRun) return `dry-run-agency:${normalized}`;
  const { data, error } = await research
    .from("agencies")
    .insert({
      name: input.name,
      state: "WA",
      primary_postcode: input.postcode || null,
      primary_suburb: input.suburb || null,
      website_url: input.websiteUrl || null,
      is_real_estate: true,
      status: "market_seen_unverified",
      review_status: "ready",
      confidence: input.confidence,
      metadata,
      last_seen_at: NOW(),
    })
    .select("id")
    .single();
  if (error) {
    if (/duplicate key value violates unique constraint/i.test(error.message)) {
      const fallback = (await findAgency(research, normalized)) || (await findAgencyByName(research, input.name));
      if (fallback?.id) {
        stats.agenciesInserted -= 1;
        stats.agenciesMatched += 1;
        return fallback.id;
      }
    }
    throw new Error(error.message);
  }
  return data.id;
}

async function findAgent(research, normalizedName, agencyId) {
  let query = research
    .from("agents")
    .select("id,agency_id,metadata,website_url,primary_postcode,primary_suburb,status,confidence")
    .eq("state", "WA")
    .eq("normalized_name", normalizedName)
    .limit(10);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  return data.find((row) => agencyId && row.agency_id === agencyId) || data.find((row) => !row.agency_id || !agencyId) || data[0];
}

async function upsertAgent(research, stats, input, dryRun) {
  const normalized = normalizeName(input.fullName);
  const existing = await findAgent(research, normalized, input.agencyId);
  const metadata = {
    ...(existing?.metadata || {}),
    exa_roster_search: {
      source_document_id: input.sourceDocumentId,
      source_url: input.sourceUrl,
      evidence_title: input.evidenceTitle,
      seen_at: NOW(),
    },
  };

  if (existing) {
    stats.agentsMatched += 1;
    if (!dryRun) {
      const patch = { metadata, last_seen_at: NOW() };
      if (!existing.agency_id && input.agencyId) patch.agency_id = input.agencyId;
      if (!existing.website_url && input.websiteUrl) patch.website_url = input.websiteUrl;
      if (!existing.primary_postcode && input.postcode) patch.primary_postcode = input.postcode;
      if (!existing.primary_suburb && input.suburb) patch.primary_suburb = input.suburb;
      const { error } = await research.from("agents").update(patch).eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return existing.id;
  }

  stats.agentsInserted += 1;
  if (dryRun) return `dry-run-agent:${normalized}`;
  const { data, error } = await research
    .from("agents")
    .insert({
      full_name: input.fullName,
      agency_id: input.agencyId || null,
      state: "WA",
      primary_postcode: input.postcode || null,
      primary_suburb: input.suburb || null,
      website_url: input.websiteUrl || null,
      status: "market_seen_unverified",
      review_status: "ready",
      confidence: input.confidence,
      metadata,
      last_seen_at: NOW(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function ensureServiceArea(research, stats, input, dryRun) {
  if (!input.postcode) return;
  const suburb = input.suburb || input.postcode;
  if (dryRun && [input.agentId, input.agencyId].some((id) => typeof id === "string" && id.startsWith("dry-run-"))) {
    stats.serviceAreasInserted += 1;
    return;
  }
  let query = research
    .from("agent_service_areas")
    .select("id")
    .eq("postcode", input.postcode)
    .eq("suburb", suburb)
    .eq("state", "WA")
    .eq("match_type", input.matchType)
    .limit(1);
  query = input.agentId ? query.eq("agent_id", input.agentId) : query.is("agent_id", null);
  query = input.agencyId ? query.eq("agency_id", input.agencyId) : query.is("agency_id", null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (data?.length) {
    stats.serviceAreasMatched += 1;
    return;
  }
  stats.serviceAreasInserted += 1;
  if (dryRun) return;
  const { error: insertError } = await research.from("agent_service_areas").insert({
    agent_id: input.agentId || null,
    agency_id: input.agencyId || null,
    postcode: input.postcode,
    suburb,
    state: "WA",
    match_type: input.matchType,
    confidence: input.confidence,
    evidence: input.evidence,
    source_document_id: input.sourceDocumentId,
  });
  if (insertError) throw new Error(insertError.message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv(".env.local") };
  const research = createSupabaseServerClient(
    createClient,
    clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL),
    env,
    {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const rows = await fetchAll(
    () =>
      research
        .from("source_documents")
        .select("id,source_url,metadata")
        .eq("source", SOURCE)
        .order("created_at", { ascending: true }),
    args.limit,
  );

  const stats = {
    sourceDocumentsRead: rows.length,
    skippedGeneric: 0,
    skippedLowConfidenceName: 0,
    agenciesInserted: 0,
    agenciesMatched: 0,
    agentsInserted: 0,
    agentsMatched: 0,
    serviceAreasInserted: 0,
    serviceAreasMatched: 0,
  };

  for (const row of rows) {
    const kind = sourceKind(row);
    const postcode = candidatePostcode(row);
    const suburb = candidateSuburb(row);
    if (!kind) {
      stats.skippedGeneric += 1;
      continue;
    }

    if (kind === "agency") {
      const name = agencyNameFromRow(row);
      if (!name) {
        stats.skippedLowConfidenceName += 1;
        continue;
      }
      const agencyId = await upsertAgency(
        research,
        stats,
        {
          name,
          postcode,
          suburb,
          websiteUrl: row.source_url,
          sourceDocumentId: row.id,
          sourceUrl: row.source_url,
          evidenceTitle: row.metadata?.title || null,
          confidence: 68,
        },
        args.dryRun,
      );
      await ensureServiceArea(
        research,
        stats,
        {
          agencyId,
          postcode,
          suburb,
          matchType: "office_postcode",
          confidence: 68,
          sourceDocumentId: row.id,
          evidence: { source: SOURCE, source_url: row.source_url, title: row.metadata?.title || null },
        },
        args.dryRun,
      );
      continue;
    }

    const agent = agentFromRow(row);
    if (!agent) {
      stats.skippedLowConfidenceName += 1;
      continue;
    }

    let agencyId = null;
    if (agent.agencyHint) {
      agencyId = await upsertAgency(
        research,
        stats,
        {
          name: agent.agencyHint,
          postcode,
          suburb,
          websiteUrl: null,
          sourceDocumentId: row.id,
          sourceUrl: row.source_url,
          evidenceTitle: row.metadata?.title || null,
          confidence: 62,
        },
        args.dryRun,
      );
    }

    const agentId = await upsertAgent(
      research,
      stats,
      {
        fullName: agent.fullName,
        agencyId,
        postcode,
        suburb,
        websiteUrl: row.source_url,
        sourceDocumentId: row.id,
        sourceUrl: row.source_url,
        evidenceTitle: row.metadata?.title || null,
        confidence: agencyId ? 68 : 62,
      },
      args.dryRun,
    );
    await ensureServiceArea(
      research,
      stats,
      {
        agentId,
        agencyId,
        postcode,
        suburb,
        matchType: "agent_profile_listing",
        confidence: agencyId ? 68 : 62,
        sourceDocumentId: row.id,
        evidence: { source: SOURCE, source_url: row.source_url, title: row.metadata?.title || null },
      },
      args.dryRun,
    );
  }

  console.log(JSON.stringify({ dryRun: args.dryRun, ...stats }, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/research/reconcile-exa-wa-roster-sources.mjs [options]

Options:
  --dry-run        Read Exa source docs and report candidate writes only
  --limit N        Limit source documents for a small verification run`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
