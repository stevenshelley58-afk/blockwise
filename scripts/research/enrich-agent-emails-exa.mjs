#!/usr/bin/env node
// Enrich research.agents (missing email) with contact emails discovered via Exa search.
// Usage:
//   EXA_API_KEY=... node scripts/research/enrich-agent-emails-exa.mjs [options]
// Options:
//   --limit N          Process at most N agents (default 25)
//   --concurrency N    Concurrent Exa requests (default 3)
//   --num-results N    Exa results per query, 1..20 (default 6)
//   --dry-run          Do not write back to Supabase; only emit artifact + summary
//   --require-agency   Only process agents that have an agency name (higher findability)
//   --min-score N      Minimum confidence score (0..100) to accept an email (default 60)
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "../lib/supabase-server-credential.mjs";
import {
  normalizeEmail,
  isWellFormedEmail,
  isForeignCctld,
  hasAuAttribution,
  hostOf,
} from "../lib/email-validation.mjs";

const EXA_URL = "https://api.exa.ai/search";

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

function parseArgs(argv) {
  const args = { limit: 25, concurrency: 3, numResults: 6, dryRun: false, requireAgency: false, minScore: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--limit": args.limit = Number.parseInt(next(), 10); break;
      case "--concurrency": args.concurrency = Number.parseInt(next(), 10); break;
      case "--num-results": args.numResults = Number.parseInt(next(), 10); break;
      case "--min-score": args.minScore = Number.parseInt(next(), 10); break;
      case "--dry-run": args.dryRun = true; break;
      case "--require-agency": args.requireAgency = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(args.numResults) || args.numResults < 1 || args.numResults > 20) {
    throw new Error("--num-results must be 1..20");
  }
  return args;
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

// --- Email extraction & validation -----------------------------------------

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const GENERIC_LOCALS = new Set([
  "info", "admin", "sales", "office", "enquiries", "enquiry", "enquiries",
  "reception", "contact", "hello", "mail", "team", "general", "accounts",
  "billing", "support", "noreply", "no-reply", "donotreply", "do-not-reply",
  "mailer-daemon", "postmaster", "webmaster", "marketing", "leasing",
  "propertymanagement", "pm", "rentals", "admin1", "office1",
]);

const JUNK_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "test.com", "domain.com",
  "email.com", "sentry.io", "sentry.wixpress.com", "wixpress.com",
  "yourdomain.com", "yoursite.com", "localhost", "gmail.com.au",
]);

function nameTokens(fullName) {
  return clean(fullName)
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length >= 3);
}

function extractEmails(text) {
  if (!text) return [];
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((email) => email.toLowerCase()))];
}

function isJunkEmail(email) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (JUNK_DOMAINS.has(domain)) return true;
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(domain)) return true;
  if (local.startsWith("mailer-daemon") || local.startsWith("postmaster")) return true;
  // image/file artifacts that regex caught, e.g. name@2x
  if (/^\d/.test(domain) === false && domain.split(".").some((part) => part.length < 2)) return true;
  return false;
}

const DATA_BROKER_DOMAINS = new Set([
  "datanyze.com", "zoominfo.com", "lusha.com", "apollo.io", "rocketreach.co",
  "signalhire.com", "contactout.com", "hunter.io", "snov.io", "uplead.com",
  "leadgenius.com", "demandbase.com", "clearbit.com", "seamless.ai",
  "cognism.com", "kaspr.io", "skrapp.io", "getprospect.com", "wappalyzer.com",
  "6sense.com", "dnb.com", "adapt.io", "emailformat.com", "email-format.com",
]);

// Foreign country-code TLDs and AU-brand allowlist live in ../lib/email-validation.mjs.

function deriveGivenFamily(agent) {
  const tokens = clean(agent.full_name).split(/\s+/).filter(Boolean);
  const given = clean(agent.given_name) || tokens[0] || "";
  const family = clean(agent.family_name) || (tokens.length > 1 ? tokens[tokens.length - 1] : "");
  return { given: given.toLowerCase(), family: family.toLowerCase() };
}

function scoreEmail(email, agent, pageText, directorySize, sourceUrl) {
  const [local, domain] = email.split("@");
  const { given, family } = deriveGivenFamily(agent);
  const agencyName = clean(agent.agency_name).toLowerCase();
  const lowerPage = (pageText || "").toLowerCase();
  const localNorm = local.toLowerCase().replace(/[^a-z]/g, "");

  let score = 0;
  const reasons = [];

  const containsGiven = given.length >= 3 && localNorm.includes(given.replace(/[^a-z]/g, ""));
  const containsFamily = family.length >= 3 && localNorm.includes(family.replace(/[^a-z]/g, ""));

  // Personal-name signal in the mailbox itself.
  if (containsGiven && containsFamily) {
    score += 55;
    reasons.push("email_contains_given_and_family");
  } else if (containsGiven) {
    score += 35;
    reasons.push("email_contains_given_name");
  } else if (containsFamily) {
    score += 8;
    reasons.push("email_contains_family_only");
  }

  // Generic role mailbox.
  const localBase = local.replace(/[._+-]/g, "");
  const isGeneric = GENERIC_LOCALS.has(localBase) || GENERIC_LOCALS.has(local.split(/[._+-]/)[0]);
  if (isGeneric) {
    score -= 45;
    reasons.push("generic_role_mailbox");
  }

  // Page attribution strength (profile vs directory).
  const fullNameNorm = clean(agent.full_name).toLowerCase();
  const mentionsFullName = fullNameNorm.length >= 5 && lowerPage.includes(fullNameNorm);
  const isDirectory = directorySize > 3;
  const mentionsFamilySuburb =
    family.length >= 3 && lowerPage.includes(family) &&
    clean(agent.primary_suburb) && lowerPage.includes(clean(agent.primary_suburb).toLowerCase());
  if (mentionsFullName && !isDirectory) {
    score += 30;
    reasons.push("profile_page_mentions_full_name");
  } else if (mentionsFullName && isDirectory) {
    score += 12;
    reasons.push("directory_page_mentions_full_name");
  } else if (mentionsFamilySuburb) {
    score += 5;
    reasons.push("page_mentions_family_and_suburb");
  } else {
    score -= 25;
    reasons.push("page_no_name_confirmation");
  }

  // Directory pages listing many mailboxes need a given-name match to attribute correctly.
  if (isDirectory && !containsGiven) {
    score -= 30;
    reasons.push("directory_without_given_name");
  }

  // Agency / domain signals.
  if (agencyName && agencyName.length >= 3) {
    const agencyTokens = agencyName
      .replace(/\b(pty|ltd|limited|pte|inc|corp|llc|holdings|group|investments)\b/g, "")
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    if (agencyTokens.some((tok) => lowerPage.includes(tok))) {
      score += 8;
      reasons.push("page_mentions_agency");
    }
    const agencyCore = agencyName
      .replace(/\b(pty|ltd|limited|pte|inc|corp|llc|real|estate|property|holdings|group)\b/g, "")
      .replace(/[^a-z]/g, "");
    const domainCore = domain.split(".")[0].replace(/[^a-z]/g, "");
    if (agencyCore.length >= 4 && domainCore.length >= 4 && (domainCore.includes(agencyCore) || agencyCore.includes(domainCore))) {
      score += 12;
      reasons.push("domain_matches_agency");
    }
  }

  // Free webmail slight penalty.
  if (["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "bigpond.com", "iinet.net.au"].includes(domain)) {
    score -= 6;
    reasons.push("free_webmail");
  }

  // Data-broker sites list guessed email patterns, not verified mailboxes -> cap.
  const sourceDomain = hostOf(sourceUrl);
  if (DATA_BROKER_DOMAINS.has(sourceDomain)) {
    score = Math.min(score, 35);
    reasons.push("data_broker_source_capped");
  }

  // Foreign country-code TLD for an Australian agent -> likely a different person.
  const agentState = clean(agent.state).toUpperCase();
  const isAuAgent = !agentState || ["WA", "NSW", "VIC", "QLD", "SA", "TAS", "ACT", "NT"].includes(agentState);
  if (isAuAgent && isForeignCctld(email)) {
    score -= 45;
    reasons.push("foreign_cctld_likely_wrong_person");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons, isGeneric, containsGiven, containsFamily, mentionsFullName, directorySize };
}

function pickBestEmail(candidates, agent) {
  let best = null;
  for (const cand of candidates) {
    if (isJunkEmail(cand.email)) continue;
    if (!best || cand.score > best.score) best = cand;
  }
  return best;
}

// --- Exa --------------------------------------------------------------------

async function exaSearch(apiKey, query, numResults) {
  const body = {
    query,
    type: "auto",
    numResults,
    contents: { highlights: true, text: { maxCharacters: 6000 } },
  };
  const response = await fetch(EXA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
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

function cleanAgencyName(name) {
  return clean(name)
    .replace(/\b(pty|ltd|limited|pte|inc|corp|llc)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuery(agent) {
  const parts = [`"${clean(agent.full_name)}"`];
  const agency = cleanAgencyName(agent.agency_name);
  if (agency) parts.push(agency);
  parts.push("real estate agent");
  if (agent.primary_suburb) parts.push(clean(agent.primary_suburb));
  return parts.join(" ");
}

async function enrichAgent(apiKey, agent, numResults) {
  const query = buildQuery(agent);
  let response;
  try {
    response = await exaSearch(apiKey, query, numResults);
  } catch (error) {
    return { agent_id: agent.id, full_name: agent.full_name, ok: false, error: error instanceof Error ? error.message : String(error), query };
  }

  const results = response.results ?? [];
  const candidates = [];
  for (const result of results) {
    const pageText = [result.title, result.text, ...(result.highlights ?? [])].filter(Boolean).join("\n");
    const emails = [...new Set(extractEmails(pageText).map(normalizeEmail).filter(Boolean).filter(isWellFormedEmail))];
    const directorySize = emails.filter((email) => !isJunkEmail(email)).length;
    const sourceUrl = result.url || result.id;
    for (const email of emails) {
      const scored = scoreEmail(email, agent, pageText, directorySize, sourceUrl);
      candidates.push({
        email,
        source_url: sourceUrl,
        source_title: clean(result.title || ""),
        ...scored,
      });
    }
  }

  const best = pickBestEmail(candidates, agent);
  return {
    agent_id: agent.id,
    full_name: agent.full_name,
    agency_name: agent.agency_name ?? null,
    primary_suburb: agent.primary_suburb ?? null,
    ok: true,
    query,
    result_count: results.length,
    candidate_count: candidates.length,
    chosen: best
      ? {
          email: best.email,
          score: best.score,
          reasons: best.reasons,
          is_generic: best.isGeneric,
          contains_given: best.containsGiven,
          source_url: best.source_url,
          source_title: best.source_title,
        }
      : null,
    candidates: candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((c) => ({ email: c.email, score: c.score, reasons: c.reasons, source_url: c.source_url })),
  };
}

// --- Main -------------------------------------------------------------------

async function fetchAllMissingAgents(research) {
  const pageSize = 1000;
  let rows = [];
  for (let from = 0; from < 200000; from += pageSize) {
    const { data, error } = await research
      .from("agents")
      .select("id,full_name,given_name,family_name,state,primary_suburb,primary_postcode,metadata,agency_id,agencies(name,trading_name)")
      .or("email.is.null,email.eq.")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows = rows.concat(data ?? []);
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv(".env.local") };
  const url = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  if (!url || !resolveSupabaseServerCredential(env)) throw new Error("Missing Supabase server credentials");
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) throw new Error("Set EXA_API_KEY for Exa search");

  const research = createSupabaseServerClient(createClient, url, env, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pull ALL agents missing email (paginated). Resumable: skip agents already
  // searched in a previous run (metadata.email_enrichment.searched_at).
  const missingRows = await fetchAllMissingAgents(research);
  let targets = missingRows
    .filter((row) => !(row.metadata && row.metadata.email_enrichment && row.metadata.email_enrichment.searched_at))
    .map((row) => ({
      id: row.id,
      full_name: row.full_name,
      given_name: row.given_name,
      family_name: row.family_name,
      state: row.state,
      primary_suburb: row.primary_suburb,
      primary_postcode: row.primary_postcode,
      metadata: row.metadata ?? {},
      agency_name: row.agencies?.name ?? row.agencies?.trading_name ?? null,
    }));

  // Dedupe by id (offset pagination over a non-unique order can repeat rows).
  targets = [...new Map(targets.map((row) => [row.id, row])).values()];
  const unsearched = targets.length;
  if (args.requireAgency) targets = targets.filter((row) => row.agency_name);
  targets = targets.slice(0, args.limit);

  console.log(`Missing-email unsearched agents: ${unsearched}; processing ${targets.length} (dryRun=${args.dryRun}, minScore=${args.minScore})`);

  const outcomes = await mapLimit(targets, args.concurrency, (agent) => enrichAgent(apiKey, agent, args.numResults));

  const accepted = [];
  const rejected = [];
  const failed = [];
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failed.push(outcome);
      continue;
    }
    if (
      outcome.chosen &&
      outcome.chosen.score >= args.minScore &&
      !outcome.chosen.is_generic &&
      outcome.chosen.contains_given &&
      hasAuAttribution(outcome.chosen.email, outcome.chosen.source_url, outcome.chosen.reasons)
    ) {
      accepted.push(outcome);
    } else {
      rejected.push(outcome);
    }
  }

  // Write back: accepted get email + evidence; rejected get a searched marker so we
  // never re-spend an Exa call on them. Failed (Exa errors) are left for retry.
  let written = 0;
  let markedSearched = 0;
  if (!args.dryRun) {
    const now = new Date().toISOString();
    for (const outcome of accepted) {
      const agent = targets.find((row) => row.id === outcome.agent_id);
      const metadata = {
        ...(agent?.metadata ?? {}),
        email_enrichment: {
          method: "exa_search",
          found: true,
          source_url: outcome.chosen.source_url,
          source_title: outcome.chosen.source_title,
          score: outcome.chosen.score,
          reasons: outcome.chosen.reasons,
          query: outcome.query,
          searched_at: now,
          enriched_at: now,
        },
      };
      const { error: updError } = await research
        .from("agents")
        .update({ email: outcome.chosen.email, metadata, updated_at: now })
        .eq("id", outcome.agent_id)
        .or("email.is.null,email.eq.");
      if (updError) {
        failed.push({ agent_id: outcome.agent_id, full_name: outcome.full_name, ok: false, error: `update: ${updError.message}` });
      } else {
        written += 1;
      }
    }
    for (const outcome of rejected) {
      const agent = targets.find((row) => row.id === outcome.agent_id);
      const metadata = {
        ...(agent?.metadata ?? {}),
        email_enrichment: {
          method: "exa_search",
          found: false,
          best_candidate: outcome.chosen
            ? { email: outcome.chosen.email, score: outcome.chosen.score, source_url: outcome.chosen.source_url }
            : null,
          query: outcome.query,
          searched_at: now,
        },
      };
      const { error: markError } = await research
        .from("agents")
        .update({ metadata, updated_at: now })
        .eq("id", outcome.agent_id);
      if (!markError) markedSearched += 1;
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    dry_run: args.dryRun,
    min_score: args.minScore,
    processed: outcomes.length,
    accepted: accepted.length,
    rejected_low_score: rejected.length,
    failed: failed.length,
    written_to_supabase: written,
    marked_searched_no_email: markedSearched,
    accept_rate: outcomes.length ? `${((accepted.length / outcomes.length) * 100).toFixed(1)}%` : "0%",
  };

  await mkdir("tmp", { recursive: true });
  const artifactPath = join("tmp", `agent-email-enrichment-${Date.now()}.json`);
  await writeFile(artifactPath, JSON.stringify({ summary, accepted, rejected, failed }, null, 2), "utf8");

  console.log(JSON.stringify({ ...summary, artifactPath }, null, 2));
  console.log("\nACCEPTED:");
  for (const outcome of accepted) {
    console.log(`  ${outcome.full_name} (${outcome.agency_name ?? "no agency"}) -> ${outcome.chosen.email} [score ${outcome.chosen.score}] ${outcome.chosen.source_url}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
