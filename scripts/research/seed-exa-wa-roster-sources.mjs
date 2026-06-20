#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const EXA_URL = "https://api.exa.ai/search";
const DEFAULT_DOMAINS = [
  "reiwa.com.au",
  "realestate.com.au",
  "domain.com.au",
  "ratemyagent.com.au",
];

function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\uFEFF/g, "").trim();
}

function sanitizeSnippet(value) {
  const raw = clean(value);
  if (!raw) return null;

  const controlCount = (raw.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []).length;
  const replacementCount = (raw.match(/\uFFFD/g) ?? []).length;
  const asciiTextCount = (raw.match(/[A-Za-z0-9\s.,:;'"!?()[\]{}@/#&+%$=-]/g) ?? []).length;
  const asciiRatio = raw.length > 0 ? asciiTextCount / raw.length : 0;

  if (controlCount > 0 || replacementCount > 2 || (raw.length > 80 && asciiRatio < 0.65)) {
    return null;
  }

  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeSnippets(values) {
  const raw = Array.isArray(values) ? values : [];
  const cleanValues = raw.map(sanitizeSnippet).filter(Boolean);
  return {
    cleanValues,
    discarded: raw.length - cleanValues.length,
  };
}

function isBlockedEvidence(text) {
  return /\b(403\s*-\s*permission denied|permission denied|access denied|forbidden|blocked by)\b/i.test(text);
}

function isWrongRegionEvidence(text) {
  return /\b(washington|seattle|spokane|puget sound|olympia|thurston|pierce|kitsap|grays harbor|northwest multiple listing|auburn wa)\b/i.test(
    text,
  );
}

function isAllowedCandidate(candidate) {
  const text = [
    candidate.source_url,
    candidate.metadata?.domain,
    candidate.metadata?.title,
    candidate.metadata?.evidence_text,
  ]
    .filter(Boolean)
    .join("\n");
  return !isBlockedEvidence(text) && !isWrongRegionEvidence(text);
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
    env[line.slice(0, eq).trim()] = clean(value);
  }
  return env;
}

function parseArgs(argv) {
  const args = {
    maxPostcodes: 0,
    maxSuburbs: 80,
    numResults: 10,
    concurrency: 3,
    mode: "both",
    dryRun: false,
    fromArtifact: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--max-postcodes":
        args.maxPostcodes = Number.parseInt(next(), 10);
        break;
      case "--max-suburbs":
        args.maxSuburbs = Number.parseInt(next(), 10);
        break;
      case "--num-results":
        args.numResults = Number.parseInt(next(), 10);
        break;
      case "--concurrency":
        args.concurrency = Number.parseInt(next(), 10);
        break;
      case "--mode":
        args.mode = next();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--from-artifact":
        args.fromArtifact = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["broad", "local", "both"].includes(args.mode)) throw new Error("--mode must be broad, local, or both");
  if (!Number.isInteger(args.numResults) || args.numResults < 1 || args.numResults > 100) {
    throw new Error("--num-results must be 1..100");
  }
  return args;
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function inferEntityType(queryKind, url) {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (path.includes("/real-estate-agent/")) return "agent";
  if (path.includes("/real-estate-agency/")) return "agency";
  if (path.includes("/real-estate-agencies/")) return "agency";
  if (path.includes("/real-estate-agents/")) return "agent";
  if (path.includes("/find-agent")) return "agent";
  return queryKind;
}

function slugifySuburb(suburb) {
  return clean(suburb)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function broadQueries() {
  return [
    {
      kind: "agency",
      sourceClass: "industry_directory",
      query: "Western Australia real estate agencies agency directory REIWA",
      includeDomains: ["reiwa.com.au"],
    },
    {
      kind: "agent",
      sourceClass: "industry_directory",
      query: "Western Australia real estate agents agent directory REIWA",
      includeDomains: ["reiwa.com.au"],
    },
    {
      kind: "agent",
      sourceClass: "major_portal",
      query: "Western Australia real estate agents directory",
      includeDomains: ["realestate.com.au", "domain.com.au", "ratemyagent.com.au"],
    },
    {
      kind: "agency",
      sourceClass: "major_portal",
      query: "Western Australia real estate agencies offices directory",
      includeDomains: ["realestate.com.au", "domain.com.au", "ratemyagent.com.au"],
    },
  ];
}

function localQueries(rows, postcodes, maxSuburbs) {
  const seen = new Set();
  const suburbs = [];
  for (const row of rows) {
    const key = `${normalizeName(row.suburb)}|${row.postcode}`;
    if (!row.suburb || seen.has(key)) continue;
    seen.add(key);
    suburbs.push(row);
    if (maxSuburbs > 0 && suburbs.length >= maxSuburbs) break;
  }

  const suburbQueries = suburbs.flatMap((row) => {
    const suburb = clean(row.suburb);
    const postcode = clean(row.postcode);
    const slug = slugifySuburb(suburb);
    return [
      {
        kind: "agent",
        sourceClass: "local_industry_directory",
        postcode,
        suburb,
        query: `site:reiwa.com.au/real-estate-agents/${slug}/ ${suburb} ${postcode} WA real estate agents`,
        includeDomains: ["reiwa.com.au"],
      },
      {
        kind: "agency",
        sourceClass: "local_agency_directory",
        postcode,
        suburb,
        query: `${suburb} ${postcode} WA real estate agencies offices agents`,
        includeDomains: DEFAULT_DOMAINS,
      },
    ];
  });

  const suburbPostcodes = new Set(suburbs.map((row) => clean(row.postcode)).filter(Boolean));
  const postcodeQueries = postcodes
    .filter((postcode) => postcode && !suburbPostcodes.has(clean(postcode)))
    .flatMap((postcode) => [
      {
        kind: "agent",
        sourceClass: "postcode_agent_search",
        postcode: clean(postcode),
        query: `${postcode} WA real estate agents agency directory`,
        includeDomains: DEFAULT_DOMAINS,
      },
      {
        kind: "agency",
        sourceClass: "postcode_agency_search",
        postcode: clean(postcode),
        query: `${postcode} WA real estate agencies offices agent directory`,
        includeDomains: DEFAULT_DOMAINS,
      },
    ]);

  return [...suburbQueries, ...postcodeQueries];
}

async function fetchAll(query) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; from < 20000; from += pageSize) {
    const { data, error } = await query().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows = rows.concat(data ?? []);
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function loadTargets(research, maxPostcodes) {
  const policies = await fetchAll(() =>
    research
      .from("refresh_policies")
      .select("postcode,state,priority,active")
      .eq("state", "WA")
      .eq("active", true)
      .order("priority", { ascending: false })
      .order("postcode", { ascending: true }),
  );
  const postcodes = policies.map((row) => row.postcode).filter(Boolean);
  const scopedPostcodes = maxPostcodes > 0 ? postcodes.slice(0, maxPostcodes) : postcodes;
  const locations = await fetchAll(() =>
    research
      .from("locations")
      .select("postcode,suburb,state,region,is_metro")
      .eq("state", "WA")
      .in("postcode", scopedPostcodes),
  );

  return { postcodes: scopedPostcodes, locations };
}

async function exaSearch(apiKey, querySpec, numResults) {
  const body = {
    query: querySpec.query,
    type: "auto",
    numResults,
    includeDomains: querySpec.includeDomains,
    contents: { highlights: true },
  };

  const response = await fetch(EXA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.error || payload?.message || response.statusText;
    throw new Error(`Exa ${response.status}: ${message}`);
  }

  return payload;
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, run));
  return results;
}

function candidateFromResult(querySpec, response, result, rank) {
  const url = result.url || result.id;
  if (!url) return null;
  const entityType = inferEntityType(querySpec.kind, url);
  const sanitizedTitle = sanitizeSnippet(result.title) ?? clean(result.title || "");
  const sanitizedSummary = sanitizeSnippet(result.summary);
  const sanitizedHighlights = sanitizeSnippets(result.highlights);
  const evidenceText = [
    sanitizedTitle,
    ...sanitizedHighlights.cleanValues,
    sanitizedSummary,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000);
  if (isBlockedEvidence(evidenceText) || isWrongRegionEvidence([url, evidenceText].join("\n"))) return null;

  const entityNameHint = sanitizedTitle
    .replace(/\s*[-|]\s*(REIWA|realestate\.com\.au|Domain|RateMyAgent).*$/i, "")
    .replace(/\s*\|\s*.*$/i, "")
    .slice(0, 220);

  return {
    source: "exa_roster_search",
    source_url: url,
    source_external_id: `exa:${hash(url).slice(0, 40)}`,
    fetched_at: new Date().toISOString(),
    content_hash: hash(JSON.stringify({ querySpec, result })),
    mime_type: "application/json",
    byte_size: Buffer.byteLength(JSON.stringify(result), "utf8"),
    metadata: {
      source_system: "exa",
      request_id: response.requestId ?? null,
      search_type: response.searchType ?? null,
      query: querySpec.query,
      query_entity_type: querySpec.kind,
      entity_type: entityType,
      matched_entity_types: [entityType],
      matched_queries: [querySpec.query],
      source_class: querySpec.sourceClass,
      source_classes: [querySpec.sourceClass],
      rank,
      title: sanitizedTitle || null,
      domain: domainOf(url),
      postcode: querySpec.postcode ?? null,
      matched_postcodes: querySpec.postcode ? [querySpec.postcode] : [],
      suburb: querySpec.suburb ?? null,
      matched_suburbs: querySpec.suburb ? [querySpec.suburb] : [],
      state: "WA",
      entity_name_hint: entityNameHint || null,
      normalized_name_hint: entityNameHint ? normalizeName(entityNameHint) : null,
      highlights: sanitizedHighlights.cleanValues.slice(0, 5),
      highlight_scores: Array.isArray(result.highlightScores) ? result.highlightScores.slice(0, 5) : [],
      evidence_text: evidenceText,
      discarded_highlight_count: sanitizedHighlights.discarded,
      cost_dollars: response.costDollars ?? null,
      discovered_by: "scripts/research/seed-exa-wa-roster-sources.mjs",
    },
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.source_external_id);
    if (!existing) {
      byId.set(candidate.source_external_id, candidate);
      continue;
    }

    existing.metadata.matched_entity_types = unique([
      ...(existing.metadata.matched_entity_types ?? []),
      ...(candidate.metadata.matched_entity_types ?? []),
    ]);
    existing.metadata.entity_type =
      existing.metadata.matched_entity_types.length > 1 ? "mixed" : existing.metadata.matched_entity_types[0];
    existing.metadata.matched_queries = unique([...(existing.metadata.matched_queries ?? []), ...(candidate.metadata.matched_queries ?? [])]);
    existing.metadata.source_classes = unique([...(existing.metadata.source_classes ?? []), ...(candidate.metadata.source_classes ?? [])]);
    existing.metadata.matched_postcodes = unique([...(existing.metadata.matched_postcodes ?? []), ...(candidate.metadata.matched_postcodes ?? [])]);
    existing.metadata.matched_suburbs = unique([...(existing.metadata.matched_suburbs ?? []), ...(candidate.metadata.matched_suburbs ?? [])]);
    if (!existing.metadata.postcode && candidate.metadata.postcode) existing.metadata.postcode = candidate.metadata.postcode;
    if (!existing.metadata.suburb && candidate.metadata.suburb) existing.metadata.suburb = candidate.metadata.suburb;
    if ((candidate.metadata.evidence_text ?? "").length > (existing.metadata.evidence_text ?? "").length) {
      existing.metadata.evidence_text = candidate.metadata.evidence_text;
      existing.metadata.highlights = candidate.metadata.highlights;
      existing.metadata.highlight_scores = candidate.metadata.highlight_scores;
    }
  }
  return [...byId.values()];
}

async function persistSourceDocuments(research, candidates) {
  if (candidates.length === 0) return { inserted: 0, skippedExisting: 0 };
  const ids = candidates.map((row) => row.source_external_id);
  const existing = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batchIds = ids.slice(i, i + 200);
    existing.push(
      ...(await fetchAll(() =>
        research.from("source_documents").select("source_external_id").eq("source", "exa_roster_search").in("source_external_id", batchIds),
      )),
    );
  }
  const existingIds = new Set(existing.map((row) => row.source_external_id));
  const toInsert = candidates.filter((row) => !existingIds.has(row.source_external_id));
  if (toInsert.length === 0) return { inserted: 0, skippedExisting: candidates.length };

  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500);
    const { error } = await research.from("source_documents").insert(batch);
    if (error) throw new Error(error.message);
  }

  return { inserted: toInsert.length, skippedExisting: candidates.length - toInsert.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv(".env.local") };
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SERVICE_ROLE_KEY);
  if (!url || !serviceKey) throw new Error("Missing Supabase service credentials");

  const research = createClient(url, serviceKey, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (args.fromArtifact) {
    const artifact = JSON.parse(readFileSync(args.fromArtifact, "utf8"));
    const rawCandidates = artifact.candidates ?? [];
    const allowedCandidates = rawCandidates.filter(isAllowedCandidate);
    const candidates = dedupeCandidates(allowedCandidates);
    const persistence = args.dryRun ? { inserted: 0, skippedExisting: 0, dryRun: true } : await persistSourceDocuments(research, candidates);
    console.log(
      JSON.stringify(
        {
          ...artifact,
          candidates: undefined,
          fromArtifact: args.fromArtifact,
          artifact_filtered_result_count: rawCandidates.length - allowedCandidates.length,
          result_count: candidates.length,
          result_domains: groupBy(candidates, (row) => row.metadata.domain ?? "unknown"),
          result_entity_types: groupBy(candidates, (row) => row.metadata.entity_type),
          persistence,
        },
        null,
        2,
      ),
    );
    return;
  }

  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("Set EXA_API_KEY for Exa search");

  const targets = await loadTargets(research, args.maxPostcodes);
  const queries = [
    ...(args.mode === "broad" || args.mode === "both" ? broadQueries() : []),
    ...(args.mode === "local" || args.mode === "both" ? localQueries(targets.locations, targets.postcodes, args.maxSuburbs) : []),
  ];

  const responses = await mapLimit(queries, args.concurrency, async (querySpec) => {
    try {
      const response = await exaSearch(apiKey, querySpec, args.numResults);
      const mappedCandidates = (response.results ?? []).map((result, index) => candidateFromResult(querySpec, response, result, index + 1));
      const candidates = mappedCandidates.filter(Boolean);
      return { ok: true, querySpec, response, candidates, rejected: mappedCandidates.length - candidates.length };
    } catch (error) {
      return { ok: false, querySpec, error: error instanceof Error ? error.message : String(error), candidates: [], rejected: 0 };
    }
  });

  const rawCandidates = responses.flatMap((entry) => entry.candidates);
  const candidates = dedupeCandidates(rawCandidates);
  const output = {
    generated_at: new Date().toISOString(),
    mode: args.mode,
    postcodes_considered: targets.postcodes.length,
    locations_considered: targets.locations.length,
    queries: queries.length,
    successful_queries: responses.filter((entry) => entry.ok).length,
    failed_queries: responses.filter((entry) => !entry.ok).map((entry) => ({ query: entry.querySpec.query, error: entry.error })),
    rejected_result_count: responses.reduce((sum, entry) => sum + entry.rejected, 0),
    duplicate_result_count: rawCandidates.length - candidates.length,
    result_count: candidates.length,
    result_domains: groupBy(candidates, (row) => row.metadata.domain ?? "unknown"),
    result_entity_types: groupBy(candidates, (row) => row.metadata.entity_type),
    candidates,
  };

  await mkdir("tmp", { recursive: true });
  const outputPath = join("tmp", `exa-wa-roster-sources-${Date.now()}.json`);
  await writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

  const persistence = args.dryRun ? { inserted: 0, skippedExisting: 0, dryRun: true } : await persistSourceDocuments(research, candidates);
  console.log(JSON.stringify({ ...output, candidates: undefined, outputPath, persistence }, null, 2));
}

function groupBy(rows, keyFn) {
  const grouped = {};
  for (const row of rows) {
    const key = String(keyFn(row) ?? "unknown");
    grouped[key] = (grouped[key] ?? 0) + 1;
  }
  return grouped;
}

function printHelp() {
  console.log(`Usage: EXA_API_KEY=... node scripts/research/seed-exa-wa-roster-sources.mjs [options]

Options:
  --mode broad|local|both       Search source surfaces. Default: both
  --max-postcodes N            Limit active WA postcodes considered. 0 = all
  --max-suburbs N              Limit local suburb queries. 0 = all. Default: 80
  --num-results N              Exa results per query, 1..100. Default: 10
  --concurrency N              Concurrent Exa requests. Default: 3
  --dry-run                    Write only local tmp artifact, not Supabase
  --from-artifact PATH         Persist an existing tmp artifact without calling Exa`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
