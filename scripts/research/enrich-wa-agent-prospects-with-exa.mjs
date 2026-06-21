#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const SOURCE = "exa_prospect_enrichment";
const EXA_URL = "https://api.exa.ai/search";
const DEFAULT_NUM_RESULTS = 8;
const DEFAULT_CONCURRENCY = 3;
const HIGH_CONFIDENCE = 70;
const CSV_FIELDS = [
  "agent_id",
  "full_name",
  "agency_name",
  "role",
  "primary_suburb",
  "primary_postcode",
  "email",
  "phone",
  "website_url",
  "profile_url",
  "facebook_url",
  "instagram_url",
  "linkedin_url",
  "youtube_url",
  "tiktok_url",
  "x_url",
  "evidence_urls",
  "confidence",
  "segment_tags",
  "personalization_hook",
  "sendability_status",
  "compliance_notes",
];

export function clean(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").replace(/\uFEFF/g, "").trim();
}

export function hash(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

export function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function loadEnv(path) {
  const env = {};
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = clean(line.slice(eq + 1));
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[clean(line.slice(0, eq))] = clean(value);
  }
  return env;
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: 0,
    agentId: null,
    missingOnly: false,
    concurrency: DEFAULT_CONCURRENCY,
    numResults: DEFAULT_NUM_RESULTS,
    output: null,
    jsonOutput: null,
  };

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
      case "--agent-id":
        args.agentId = next();
        break;
      case "--missing-only":
        args.missingOnly = true;
        break;
      case "--concurrency":
        args.concurrency = Number.parseInt(next(), 10);
        break;
      case "--num-results":
        args.numResults = Number.parseInt(next(), 10);
        break;
      case "--output":
        args.output = next();
        break;
      case "--json-output":
        args.jsonOutput = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 0) throw new Error("--limit must be a non-negative integer");
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 12) {
    throw new Error("--concurrency must be 1..12");
  }
  if (!Number.isInteger(args.numResults) || args.numResults < 1 || args.numResults > 100) {
    throw new Error("--num-results must be 1..100");
  }
  return args;
}

export function isBlockedEvidence(text) {
  return /\b(403\s*-\s*permission denied|permission denied|access denied|forbidden|blocked by|captcha|robot check)\b/i.test(
    text,
  );
}

export function isWrongRegionEvidence(text) {
  return /\b(washington|seattle|spokane|puget sound|olympia|thurston|pierce|kitsap|grays harbor|northwest multiple listing|auburn wa|bellevue wa|tacoma wa)\b/i.test(
    text,
  );
}

export function isGenericDirectoryTitle(title) {
  return /^(find & compare|real estate agents in|real estate agencies in|\d+\s+real estate agents active|\d+\s+real estate agencies active|find real estate agents|agents near me|best real estate agents)/i.test(
    clean(title),
  );
}

export function isAgentProspectCandidate(row, options = {}) {
  if (clean(row?.state || "WA").toUpperCase() !== "WA") return false;
  if (clean(row?.status).toLowerCase() === "inactive") return false;
  if (!options.missingOnly) return true;

  const enrichment = row?.metadata?.cold_email_enrichment?.v1 ?? {};
  const socialLinks = enrichment.social_links ?? {};
  return (
    !clean(row?.email) ||
    !clean(row?.phone) ||
    !clean(row?.website_url) ||
    !clean(enrichment.profile_url) ||
    !Object.values(socialLinks).some((value) => (Array.isArray(value) ? value.length > 0 : clean(value)))
  );
}

export function buildAgentQueries(agent) {
  const fullName = clean(agent.full_name || agent.fullName);
  const agencyName = clean(agent.agency_name || agent.agencyName || agent.agency?.name);
  const suburb = clean(agent.primary_suburb || agent.primarySuburb || agent.office_suburb);
  const postcode = clean(agent.primary_postcode || agent.primaryPostcode);
  const area = [suburb, postcode].filter(Boolean).join(" ");
  const quotedName = fullName ? `"${fullName}"` : "";
  const quotedAgency = agencyName ? `"${agencyName}"` : "";
  const agencyDomain = normalizeDomain(agent.agency_website_url || agent.agencyWebsiteUrl || agent.agency?.website_url);
  const queries = [];

  queries.push({
    kind: "profile",
    query: [quotedName, quotedAgency, area, "WA real estate agent contact email phone"].filter(Boolean).join(" "),
  });
  queries.push({
    kind: "reiwa_profile",
    query: [`site:reiwa.com.au/real-estate-agent/`, quotedName, quotedAgency, "WA"].filter(Boolean).join(" "),
    includeDomains: ["reiwa.com.au"],
  });
  queries.push({
    kind: "contact",
    query: [quotedName, quotedAgency, area, "real estate agent contact"].filter(Boolean).join(" "),
  });

  if (agencyDomain && !isSocialDomain(agencyDomain) && !isMajorPortalDomain(agencyDomain)) {
    queries.push({
      kind: "agency_site",
      query: [quotedName, quotedAgency, "agent profile team contact"].filter(Boolean).join(" "),
      includeDomains: [agencyDomain],
    });
  }

  queries.push({
    kind: "social_facebook",
    query: [quotedName, quotedAgency, "real estate agent site:facebook.com"].filter(Boolean).join(" "),
    includeDomains: ["facebook.com"],
  });
  queries.push({
    kind: "social_instagram",
    query: [quotedName, quotedAgency, "real estate agent site:instagram.com"].filter(Boolean).join(" "),
    includeDomains: ["instagram.com"],
  });
  queries.push({
    kind: "social_linkedin",
    query: [quotedName, quotedAgency, "real estate agent site:linkedin.com/in OR site:linkedin.com/company"].filter(Boolean).join(" "),
    includeDomains: ["linkedin.com"],
  });
  queries.push({
    kind: "social_video",
    query: [quotedName, quotedAgency, "real estate agent site:youtube.com OR site:tiktok.com OR site:x.com"].filter(Boolean).join(" "),
    includeDomains: ["youtube.com", "tiktok.com", "x.com", "twitter.com"],
  });

  return queries.filter((entry) => entry.query.replace(/["\s]/g, "").length > 0);
}

function isSocialDomain(domain) {
  return /(^|\.)((facebook|instagram|linkedin|youtube|youtu|tiktok|twitter|x)\.com)$/i.test(domain);
}

function isMajorPortalDomain(domain) {
  return ["reiwa.com.au", "realestate.com.au", "domain.com.au", "ratemyagent.com.au"].includes(domain);
}

export function classifySocialUrl(url) {
  const domain = normalizeDomain(url);
  if (!domain) return null;
  if (domain.endsWith("facebook.com")) return "facebook";
  if (domain.endsWith("instagram.com")) return "instagram";
  if (domain.endsWith("linkedin.com")) return "linkedin";
  if (domain.endsWith("youtube.com") || domain.endsWith("youtu.be")) return "youtube";
  if (domain.endsWith("tiktok.com")) return "tiktok";
  if (domain.endsWith("x.com") || domain.endsWith("twitter.com")) return "x";
  return null;
}

export function normalizeSocialUrl(url) {
  const platform = classifySocialUrl(url);
  if (!platform) return null;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.protocol = "https:";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.hostname === "twitter.com") parsed.hostname = "x.com";
    parsed.pathname = parsed.pathname
      .replace(/\/+/g, "/")
      .replace(/\/$/, "");
    if (!parsed.pathname || parsed.pathname === "/") return null;
    if (/\/(?:share|sharer|login|search|hashtag|explore|reel|p|watch)\b/i.test(parsed.pathname)) return null;
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function classifySourceKind(url) {
  const domain = normalizeDomain(url);
  const path = urlPath(url);
  if (classifySocialUrl(url)) return "social";
  if (domain === "reiwa.com.au" && path.includes("/real-estate-agent/")) return "reiwa_profile";
  if (domain === "reiwa.com.au") return "reiwa";
  if (["realestate.com.au", "domain.com.au", "ratemyagent.com.au"].includes(domain ?? "")) return "portal_profile";
  if (/\b(agent|agents|team|people|staff|about|contact|profile)\b/i.test(path)) return "agency_team_page";
  return "website";
}

function urlPath(value) {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function sanitizeSnippet(value) {
  const raw = clean(value);
  if (!raw) return "";
  const controlCount = (raw.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) ?? []).length;
  const replacementCount = (raw.match(/\uFFFD/g) ?? []).length;
  const asciiTextCount = (raw.match(/[A-Za-z0-9\s.,:;'"!?()[\]{}@/#&+%$=-]/g) ?? []).length;
  const asciiRatio = raw.length > 0 ? asciiTextCount / raw.length : 0;
  if (controlCount > 0 || replacementCount > 2 || (raw.length > 80 && asciiRatio < 0.55)) return "";
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

export function scoreNameMatch(agentName, text) {
  const normalizedAgent = normalizeName(agentName);
  const normalizedText = normalizeName(text);
  if (!normalizedAgent || !normalizedText) return 0;
  if (normalizedText.includes(normalizedAgent)) return 55;
  const parts = normalizedAgent.split(" ").filter((part) => part.length > 1);
  if (parts.length < 2) return normalizedText.includes(parts[0] ?? "") ? 25 : 0;
  const first = parts[0];
  const last = parts.at(-1);
  if (normalizedText.includes(`${first} ${last}`)) return 48;
  if (normalizedText.includes(first) && normalizedText.includes(last)) return 42;
  return parts.filter((part) => normalizedText.includes(part)).length >= Math.min(2, parts.length) ? 25 : 0;
}

function scoreAgencyMatch(agent, text) {
  const agencyName = clean(agent.agency_name || agent.agencyName || agent.agency?.name);
  if (!agencyName) return 0;
  return normalizeName(text).includes(normalizeName(agencyName)) ? 15 : 0;
}

function scoreAreaMatch(agent, text) {
  const normalizedText = normalizeName(text);
  const suburb = normalizeName(agent.primary_suburb || agent.primarySuburb);
  const postcode = clean(agent.primary_postcode || agent.primaryPostcode);
  let score = 0;
  if (suburb && normalizedText.includes(suburb)) score += 8;
  if (postcode && text.includes(postcode)) score += 6;
  if (/\bwestern australia\b|\bperth\b|\bwa\b/i.test(text)) score += 4;
  return Math.min(score, 12);
}

function scoreSourceKind(kind) {
  switch (kind) {
    case "reiwa_profile":
      return 18;
    case "agency_team_page":
      return 14;
    case "portal_profile":
      return 10;
    case "website":
      return 8;
    case "social":
      return 6;
    default:
      return 0;
  }
}

function isProfessionalSocialMatch(agent, text, nameScore, agencyScore) {
  if (nameScore < 42) return false;
  if (agencyScore > 0) return true;
  return /\b(real estate|property consultant|sales representative|selling principal|licensee|realtor|reiwa|ray white|harcourts|acton|the agency|belle property|lj hooker|peard|professionals)\b/i.test(
    text,
  );
}

export function candidateFromResult(agent, querySpec, response, result, rank) {
  const url = result?.url || result?.id;
  if (!url) return null;
  const title = sanitizeSnippet(result.title);
  const highlights = Array.isArray(result.highlights) ? result.highlights.map(sanitizeSnippet).filter(Boolean) : [];
  const summary = sanitizeSnippet(result.summary);
  const text = sanitizeSnippet(result.text);
  const evidenceText = [title, ...highlights, summary, text].filter(Boolean).join("\n").slice(0, 5000);
  const combined = [url, title, evidenceText].filter(Boolean).join("\n");
  if (isBlockedEvidence(combined) || isWrongRegionEvidence(combined) || isGenericDirectoryTitle(title)) return null;

  const sourceKind = classifySourceKind(url);
  const socialPlatform = classifySocialUrl(url);
  const nameScore = scoreNameMatch(agent.full_name || agent.fullName, combined);
  const agencyScore = scoreAgencyMatch(agent, combined);
  const areaScore = scoreAreaMatch(agent, combined);
  if (nameScore < 25) return null;
  if (socialPlatform && !isProfessionalSocialMatch(agent, combined, nameScore, agencyScore)) return null;

  const confidence = Math.min(100, nameScore + agencyScore + areaScore + scoreSourceKind(sourceKind) + Math.max(0, 8 - rank));
  if (confidence < 45) return null;

  return {
    agent_id: agent.id,
    source_url: url,
    source_external_id: `exa-prospect:${hash(`${agent.id}:${url}`).slice(0, 40)}`,
    content_hash: hash(JSON.stringify({ agent_id: agent.id, query: querySpec.query, url, title, evidenceText })),
    fetched_at: new Date().toISOString(),
    byte_size: Buffer.byteLength(JSON.stringify(result), "utf8"),
    title: title || null,
    domain: normalizeDomain(url),
    sourceKind,
    socialPlatform,
    evidenceText,
    highlights: highlights.slice(0, 5),
    querySpec,
    rank,
    confidence,
    nameScore,
    agencyScore,
    areaScore,
    responseMeta: {
      request_id: response?.requestId ?? null,
      search_type: response?.searchType ?? response?.resolvedSearchType ?? null,
      cost_dollars: response?.costDollars ?? null,
    },
    sourceDocumentId: null,
  };
}

export function dedupeCandidates(candidates) {
  const byUrl = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const key = candidate.source_url.toLowerCase();
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, {
        ...candidate,
        matchedQueries: [candidate.querySpec.query],
        sourceClasses: [candidate.querySpec.kind],
      });
      continue;
    }
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    existing.nameScore = Math.max(existing.nameScore, candidate.nameScore);
    existing.agencyScore = Math.max(existing.agencyScore, candidate.agencyScore);
    existing.areaScore = Math.max(existing.areaScore, candidate.areaScore);
    existing.matchedQueries = unique([...existing.matchedQueries, candidate.querySpec.query]);
    existing.sourceClasses = unique([...existing.sourceClasses, candidate.querySpec.kind]);
    if (candidate.evidenceText.length > existing.evidenceText.length) {
      existing.evidenceText = candidate.evidenceText;
      existing.highlights = candidate.highlights;
    }
  }
  return [...byUrl.values()].sort((a, b) => b.confidence - a.confidence);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function extractEmails(text) {
  const matches = clean(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return unique(
    matches
      .map((email) => email.toLowerCase().replace(/[),.;:]+$/g, ""))
      .filter((email) => !isRejectedEmail(email)),
  );
}

function isRejectedEmail(email) {
  return (
    !email.includes("@") ||
    /\b(example|email\.com|domain\.com|test\.com)\b/i.test(email) ||
    /^(noreply|no-reply|donotreply|privacy|support|customercare|webmaster)@/i.test(email) ||
    /@(facebook|instagram|linkedin|youtube|tiktok|twitter|x|realestate|domain)\.com/i.test(email)
  );
}

function isGenericEmail(email) {
  return /^(info|admin|sales|hello|reception|enquiries|enquiry|office|contact|property|pm|rentals)@/i.test(email);
}

export function extractPhones(text) {
  const raw = clean(text);
  const matches = raw.match(/(?:\+?61[\s.-]?)?(?:\(?0?[248]\)?[\s.-]?\d{4}[\s.-]?\d{4}|4\d{2}[\s.-]?\d{3}[\s.-]?\d{3}|1300[\s.-]?\d{3}[\s.-]?\d{3})/g) ?? [];
  return unique(
    matches
      .map((phone) => phone.replace(/[^\d+]/g, ""))
      .map(normalizeAustralianPhone)
      .filter(Boolean),
  );
}

function normalizeAustralianPhone(phone) {
  let value = clean(phone);
  if (value.startsWith("+61")) value = `0${value.slice(3)}`;
  if (value.startsWith("61") && value.length >= 11) value = `0${value.slice(2)}`;
  if (/^4\d{8}$/.test(value)) value = `0${value}`;
  if (/^(?:04\d{8}|0[28]\d{8}|1300\d{6})$/.test(value)) return value;
  return null;
}

function contactScore(candidate, value, kind) {
  let score = candidate.confidence;
  if (candidate.sourceKind === "reiwa_profile") score += 12;
  if (candidate.sourceKind === "agency_team_page") score += 8;
  if (candidate.sourceKind === "portal_profile") score += 5;
  if (kind === "email" && isGenericEmail(value)) score -= 22;
  if (kind === "phone" && /^1300/.test(value)) score -= 20;
  return Math.max(0, Math.min(100, score));
}

function bestContact(candidates, extractor, kind) {
  const found = [];
  for (const candidate of candidates) {
    for (const value of extractor(candidate.evidenceText)) {
      found.push({ value, score: contactScore(candidate, value, kind), candidate });
    }
  }
  found.sort((a, b) => b.score - a.score);
  return found[0] ?? null;
}

function bestProfileUrl(candidates) {
  return candidates
    .filter((candidate) => !candidate.socialPlatform)
    .sort((a, b) => {
      const sourcePriority = sourcePriorityScore(b.sourceKind) - sourcePriorityScore(a.sourceKind);
      return sourcePriority || b.confidence - a.confidence;
    })[0] ?? null;
}

function sourcePriorityScore(kind) {
  switch (kind) {
    case "reiwa_profile":
      return 5;
    case "agency_team_page":
      return 4;
    case "portal_profile":
      return 3;
    case "website":
      return 2;
    default:
      return 0;
  }
}

function buildSocialLinks(candidates) {
  const links = { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, other: [] };
  for (const candidate of candidates.filter((entry) => entry.socialPlatform).sort((a, b) => b.confidence - a.confidence)) {
    const normalized = normalizeSocialUrl(candidate.source_url);
    if (!normalized) continue;
    if (links[candidate.socialPlatform] === null) {
      links[candidate.socialPlatform] = normalized;
    } else if (!links.other.includes(normalized)) {
      links.other.push(normalized);
    }
  }
  return links;
}

function extractPositioning(candidates) {
  for (const candidate of candidates) {
    const lines = candidate.evidenceText
      .split(/\n+/)
      .map((line) => clean(line))
      .filter((line) => line.length >= 35 && line.length <= 220);
    const usable = lines.find((line) => /\b(real estate|property|sales|sell|selling|local|market|specialist|expert)\b/i.test(line));
    if (usable) return usable;
  }
  return null;
}

function extractAwardsOrStats(candidates) {
  const values = [];
  for (const candidate of candidates) {
    const matches = candidate.evidenceText.match(/\b(?:\d+\s+(?:agents|sales representatives|property managers|listings|properties sold|recommendations)|award(?:s|ed)?|top\s+\d+|million dollar club)\b[^.\n]{0,120}/gi) ?? [];
    values.push(...matches.map((value) => clean(value)).filter(Boolean));
  }
  return unique(values).slice(0, 5);
}

function serviceAreasFromAgent(agent) {
  const rows = Array.isArray(agent.serviceAreas) ? agent.serviceAreas : [];
  const values = rows
    .map((row) => ({
      suburb: clean(row.suburb),
      postcode: clean(row.postcode),
      state: clean(row.state || "WA").toUpperCase(),
      match_type: clean(row.match_type || row.matchType),
      confidence: Number(row.confidence ?? 0),
    }))
    .filter((row) => row.suburb || row.postcode);
  if (values.length > 0) return values.slice(0, 20);
  const suburb = clean(agent.primary_suburb || agent.primarySuburb);
  const postcode = clean(agent.primary_postcode || agent.primaryPostcode);
  return suburb || postcode ? [{ suburb, postcode, state: "WA", match_type: "agent_primary_area", confidence: 60 }] : [];
}

function buildSegmentTags(agent, enrichment) {
  const tags = [];
  if (!clean(enrichment.email)) tags.push("missing_email");
  else tags.push("has_agent_email");
  if (clean(enrichment.phone)) tags.push(enrichment.phone.startsWith("04") ? "has_mobile" : "has_phone");
  const role = normalizeName(agent.agency_role || agent.role || enrichment.role);
  if (/\b(principal|director|licensee)\b/.test(role)) tags.push("principal_or_director");
  else if (/\b(sales|representative|consultant)\b/.test(role)) tags.push("sales_agent");
  const postcode = clean(agent.primary_postcode || agent.primaryPostcode);
  if (/^6(?:0|1)\d{2}$/.test(postcode)) tags.push("metro_perth");
  else if (postcode) tags.push("regional_wa");
  if (Object.values(enrichment.social_links).some((value) => (Array.isArray(value) ? value.length > 0 : clean(value)))) {
    tags.push("has_social");
  }
  if (!clean(enrichment.website_url) && !clean(enrichment.profile_url)) tags.push("weak_digital_presence");
  if (enrichment.sendability_status === "needs_review") tags.push("needs_review");
  return unique(tags);
}

function buildPersonalizationHook(agent, enrichment) {
  const agency = clean(enrichment.agency_name);
  const suburb = clean(enrichment.office_suburb || agent.primary_suburb || agent.primarySuburb);
  const profileUrl = clean(enrichment.profile_url);
  if (profileUrl.includes("reiwa.com.au") && agency && suburb) {
    return `Saw your REIWA profile lists you with ${agency} around ${suburb}.`;
  }
  if (profileUrl.includes("reiwa.com.au") && agency) {
    return `Saw your REIWA profile lists you with ${agency}.`;
  }
  if (agency && suburb) return `Saw your public agent profile connects you with ${agency} around ${suburb}.`;
  if (suburb) return `Saw your public agent profile highlights work around ${suburb}.`;
  if (agency) return `Saw your public agent profile with ${agency}.`;
  return null;
}

function sendabilityStatus(enrichment) {
  if (clean(enrichment.email) && enrichment.confidence >= HIGH_CONFIDENCE) return "ready";
  if (clean(enrichment.phone) || clean(enrichment.profile_url) || Object.values(enrichment.social_links).some((value) => (Array.isArray(value) ? value.length > 0 : clean(value)))) {
    return "needs_review";
  }
  return "missing_email";
}

export function buildAgentEnrichment(agent, candidates, now = new Date().toISOString()) {
  const sourceDocumentIds = unique(candidates.map((candidate) => candidate.sourceDocumentId));
  const evidenceUrls = unique(candidates.map((candidate) => candidate.source_url)).slice(0, 12);
  const email = bestContact(candidates, extractEmails, "email");
  const phone = bestContact(candidates, extractPhones, "phone");
  const profile = bestProfileUrl(candidates);
  const socialLinks = buildSocialLinks(candidates);
  const confidence = Math.max(0, ...candidates.map((candidate) => candidate.confidence), email?.score ?? 0, phone?.score ?? 0);
  const enrichment = {
    email: email?.value ?? null,
    phone: phone?.value ?? null,
    website_url: profile?.source_url ?? null,
    profile_url: profile?.source_url ?? null,
    agency_name: clean(agent.agency_name || agent.agencyName || agent.agency?.name) || null,
    role: clean(agent.agency_role || agent.role) || null,
    office_suburb: clean(agent.primary_suburb || agent.primarySuburb || agent.agency?.primary_suburb) || null,
    service_areas: serviceAreasFromAgent(agent),
    social_links: socialLinks,
    positioning: extractPositioning(candidates),
    awards_or_stats: extractAwardsOrStats(candidates),
    personalization_hook: null,
    segment_tags: [],
    sendability_status: "needs_review",
    confidence,
    evidence_urls: evidenceUrls,
    source_document_ids: sourceDocumentIds,
    enriched_at: now,
  };
  enrichment.sendability_status = sendabilityStatus(enrichment);
  enrichment.personalization_hook = buildPersonalizationHook(agent, enrichment);
  enrichment.segment_tags = buildSegmentTags(agent, enrichment);
  return enrichment;
}

export function buildSkippedEnrichment(agent, reason, now = new Date().toISOString()) {
  const enrichment = {
    email: null,
    phone: null,
    website_url: null,
    profile_url: null,
    agency_name: clean(agent.agency_name || agent.agencyName || agent.agency?.name) || null,
    role: clean(agent.agency_role || agent.role) || null,
    office_suburb: clean(agent.primary_suburb || agent.primarySuburb || agent.agency?.primary_suburb) || null,
    service_areas: serviceAreasFromAgent(agent),
    social_links: { facebook: null, instagram: null, linkedin: null, youtube: null, tiktok: null, x: null, other: [] },
    positioning: null,
    awards_or_stats: [],
    personalization_hook: null,
    segment_tags: ["missing_email", "needs_review"],
    sendability_status: "missing_email",
    confidence: 0,
    evidence_urls: [],
    source_document_ids: [],
    skipped_reason: reason,
    enriched_at: now,
  };
  return enrichment;
}

export function buildAgentUpdatePatch(agent, enrichment) {
  const currentMetadata = agent.metadata && typeof agent.metadata === "object" ? agent.metadata : {};
  const patch = {
    metadata: {
      ...currentMetadata,
      cold_email_enrichment: {
        ...(currentMetadata.cold_email_enrichment || {}),
        v1: enrichment,
      },
    },
    last_seen_at: new Date().toISOString(),
  };

  if (!clean(agent.email) && clean(enrichment.email) && enrichment.confidence >= HIGH_CONFIDENCE) {
    patch.email = enrichment.email;
  }
  if (!clean(agent.phone) && clean(enrichment.phone) && enrichment.confidence >= HIGH_CONFIDENCE) {
    patch.phone = enrichment.phone;
  }
  if (!clean(agent.website_url) && clean(enrichment.website_url) && enrichment.confidence >= HIGH_CONFIDENCE) {
    patch.website_url = enrichment.website_url;
  }
  return patch;
}

export function buildExportRow(agent, enrichment) {
  const social = enrichment.social_links || {};
  return {
    agent_id: agent.id,
    full_name: clean(agent.full_name || agent.fullName),
    agency_name: clean(enrichment.agency_name),
    role: clean(enrichment.role),
    primary_suburb: clean(agent.primary_suburb || agent.primarySuburb),
    primary_postcode: clean(agent.primary_postcode || agent.primaryPostcode),
    email: clean(agent.email) || clean(enrichment.email),
    phone: clean(agent.phone) || clean(enrichment.phone),
    website_url: clean(agent.website_url) || clean(enrichment.website_url),
    profile_url: clean(enrichment.profile_url),
    facebook_url: clean(social.facebook),
    instagram_url: clean(social.instagram),
    linkedin_url: clean(social.linkedin),
    youtube_url: clean(social.youtube),
    tiktok_url: clean(social.tiktok),
    x_url: clean(social.x),
    evidence_urls: (enrichment.evidence_urls || []).join(" | "),
    confidence: String(Math.round(enrichment.confidence ?? 0)),
    segment_tags: (enrichment.segment_tags || []).join(";"),
    personalization_hook: clean(enrichment.personalization_hook),
    sendability_status: clean(enrichment.sendability_status),
    compliance_notes: "Review consent basis, identify Blockwise as sender, and include unsubscribe handling before outreach.",
  };
}

export function csvFromRows(rows) {
  const lines = [CSV_FIELDS.join(",")];
  for (const row of rows) {
    lines.push(CSV_FIELDS.map((field) => csvEscape(row[field])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value) {
  const text = clean(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
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

async function loadAgents(research, args) {
  let rows = await fetchAll(() => {
    let query = research
      .from("agents")
      .select("id,full_name,normalized_name,state,agency_role,agency_id,primary_suburb,primary_postcode,email,phone,website_url,status,metadata,agencies(id,name,website_url,primary_suburb,primary_postcode,metadata)")
      .eq("state", "WA")
      .neq("status", "inactive")
      .order("status", { ascending: true })
      .order("full_name", { ascending: true });
    if (args.agentId) query = query.eq("id", args.agentId);
    return query;
  });
  rows = rows.filter((row) => isAgentProspectCandidate(row, { missingOnly: args.missingOnly }));
  if (args.limit > 0) rows = rows.slice(0, args.limit);

  const serviceAreas = await loadServiceAreas(research, rows.map((row) => row.id));
  return rows.map((row) => normalizeAgentRow(row, serviceAreas.get(row.id) ?? []));
}

async function loadServiceAreas(research, agentIds) {
  const byAgent = new Map();
  for (let index = 0; index < agentIds.length; index += 200) {
    const batch = agentIds.slice(index, index + 200);
    if (batch.length === 0) continue;
    const rows = await fetchAll(() =>
      research
        .from("agent_service_areas")
        .select("agent_id,postcode,suburb,state,match_type,confidence")
        .in("agent_id", batch)
        .order("confidence", { ascending: false }),
    );
    for (const row of rows) {
      if (!row.agent_id) continue;
      const list = byAgent.get(row.agent_id) ?? [];
      list.push(row);
      byAgent.set(row.agent_id, list);
    }
  }
  return byAgent;
}

function normalizeAgentRow(row, serviceAreas) {
  const agency = Array.isArray(row.agencies) ? row.agencies[0] : row.agencies;
  return {
    ...row,
    agency,
    agency_name: agency?.name ?? null,
    agency_website_url: agency?.website_url ?? null,
    serviceAreas,
  };
}

async function exaSearch(apiKey, querySpec, numResults) {
  const body = {
    query: querySpec.query,
    type: "auto",
    numResults,
    includeDomains: querySpec.includeDomains,
    contents: {
      highlights: true,
      text: { maxCharacters: 1800 },
    },
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

async function searchAgent(apiKey, agent, args) {
  const querySpecs = buildAgentQueries(agent);
  const responses = await mapLimit(querySpecs, 1, async (querySpec) => {
    try {
      const response = await exaSearch(apiKey, querySpec, args.numResults);
      const candidates = (response.results ?? [])
        .map((result, index) => candidateFromResult(agent, querySpec, response, result, index + 1))
        .filter(Boolean);
      return { ok: true, querySpec, candidates, rejected: (response.results ?? []).length - candidates.length };
    } catch (error) {
      return { ok: false, querySpec, candidates: [], rejected: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return {
    candidates: dedupeCandidates(responses.flatMap((entry) => entry.candidates)),
    failedQueries: responses.filter((entry) => !entry.ok).map((entry) => ({ query: entry.querySpec.query, error: entry.error })),
    rejected: responses.reduce((sum, entry) => sum + entry.rejected, 0),
  };
}

async function persistSourceDocuments(research, candidates, dryRun) {
  const idsByExternalId = new Map();
  if (dryRun || candidates.length === 0) return idsByExternalId;
  const externalIds = candidates.map((candidate) => candidate.source_external_id);
  for (let index = 0; index < externalIds.length; index += 200) {
    const batch = externalIds.slice(index, index + 200);
    const existing = await fetchAll(() =>
      research.from("source_documents").select("id,source_external_id").eq("source", SOURCE).in("source_external_id", batch),
    );
    for (const row of existing) idsByExternalId.set(row.source_external_id, row.id);
  }

  const toInsert = candidates.filter((candidate) => !idsByExternalId.has(candidate.source_external_id));
  for (let index = 0; index < toInsert.length; index += 200) {
    const batch = toInsert.slice(index, index + 200);
    const rows = batch.map((candidate) => ({
      source: SOURCE,
      source_url: candidate.source_url,
      source_external_id: candidate.source_external_id,
      fetched_at: candidate.fetched_at,
      content_hash: candidate.content_hash,
      mime_type: "application/json",
      byte_size: candidate.byte_size,
      metadata: {
        source_system: "exa",
        agent_id: candidate.agent_id,
        query: candidate.querySpec.query,
        query_kind: candidate.querySpec.kind,
        matched_queries: candidate.matchedQueries ?? [candidate.querySpec.query],
        source_classes: candidate.sourceClasses ?? [candidate.querySpec.kind],
        title: candidate.title,
        domain: candidate.domain,
        source_kind: candidate.sourceKind,
        social_platform: candidate.socialPlatform,
        rank: candidate.rank,
        confidence: candidate.confidence,
        name_score: candidate.nameScore,
        agency_score: candidate.agencyScore,
        area_score: candidate.areaScore,
        highlights: candidate.highlights,
        evidence_text: candidate.evidenceText,
        response: candidate.responseMeta,
        discovered_by: "scripts/research/enrich-wa-agent-prospects-with-exa.mjs",
      },
    }));
    const { data, error } = await research.from("source_documents").insert(rows).select("id,source_external_id");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) idsByExternalId.set(row.source_external_id, row.id);
  }
  return idsByExternalId;
}

async function processAgent(research, apiKey, agent, args) {
  const search = await searchAgent(apiKey, agent, args);
  const idsByExternalId = await persistSourceDocuments(research, search.candidates, args.dryRun);
  const candidates = search.candidates.map((candidate) => ({
    ...candidate,
    sourceDocumentId: idsByExternalId.get(candidate.source_external_id) ?? null,
  }));
  const enrichment = candidates.length > 0
    ? buildAgentEnrichment(agent, candidates)
    : buildSkippedEnrichment(agent, search.failedQueries.length > 0 ? "no_accepted_exa_results_with_failures" : "no_accepted_exa_results");
  if (!args.dryRun) {
    const patch = buildAgentUpdatePatch(agent, enrichment);
    const { error } = await research.from("agents").update(patch).eq("id", agent.id);
    if (error) throw new Error(error.message);
  }
  return {
    agent_id: agent.id,
    ok: true,
    candidate_count: candidates.length,
    failed_queries: search.failedQueries,
    rejected_result_count: search.rejected,
    export_row: buildExportRow(agent, enrichment),
  };
}

async function writeOutputs(args, rows) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const csvPath = args.output || join("tmp", "cold-email", `wa-agent-enrichment-${stamp}.csv`);
  const jsonPath = args.jsonOutput || join("tmp", "cold-email", `wa-agent-enrichment-${stamp}.json`);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(csvPath, csvFromRows(rows), "utf8");
  await writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf8");
  return { csvPath, jsonPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env, ...loadEnv(".env.local") };
  const apiKey = clean(env.EXA_API_KEY);
  if (!apiKey) throw new Error("Set EXA_API_KEY for Exa prospect enrichment");
  const supabaseUrl = clean(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL);
  const serviceKey = clean(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase service credentials");

  const research = createClient(supabaseUrl, serviceKey, {
    db: { schema: "research" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const agents = await loadAgents(research, args);
  const results = await mapLimit(agents, args.concurrency, (agent) => processAgent(research, apiKey, agent, args));
  const rows = results.map((result) => result.export_row);
  const outputs = await writeOutputs(args, rows);
  const summary = {
    dryRun: args.dryRun,
    agents_considered: agents.length,
    exported_rows: rows.length,
    ready_rows: rows.filter((row) => row.sendability_status === "ready").length,
    needs_review_rows: rows.filter((row) => row.sendability_status === "needs_review").length,
    missing_email_rows: rows.filter((row) => row.sendability_status === "missing_email").length,
    candidate_count: results.reduce((sum, row) => sum + row.candidate_count, 0),
    rejected_result_count: results.reduce((sum, row) => sum + row.rejected_result_count, 0),
    failed_queries: results.flatMap((row) => row.failed_queries.map((entry) => ({ agent_id: row.agent_id, ...entry }))),
    outputs,
  };
  console.log(JSON.stringify(summary, null, 2));
}

function printHelp() {
  console.log(`Usage: EXA_API_KEY=... node scripts/research/enrich-wa-agent-prospects-with-exa.mjs [options]

Options:
  --dry-run              Search and export without writing Supabase rows
  --limit N              Limit selected agents after filtering
  --agent-id UUID        Enrich one existing research.agents row
  --missing-only         Only select agents missing contact/profile/social enrichment
  --concurrency N        Concurrent agents. Default: ${DEFAULT_CONCURRENCY}
  --num-results N        Exa results per query, 1..100. Default: ${DEFAULT_NUM_RESULTS}
  --output PATH          CSV export path
  --json-output PATH     JSON export path`);
}

const invokedPath = process.argv[1] ? pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
