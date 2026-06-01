import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const supervisorPath = "hermes/tools/research-runtime/bin/supabase-supervisor.mjs";
const supervisor = readFileSync(join(root, supervisorPath), "utf8");
const collector = functionBody(supervisor, "handleAdCollector");
const mediaCollector = functionBody(supervisor, "handleMediaCollector");
const agentCensus = functionBody(supervisor, "handleAgentCensus");
const verifiedSubjectUpsert = functionBody(supervisor, "upsertVerifiedAgency");
const pageResolver = functionBody(supervisor, "handlePageResolver");
const collectorEnqueue = functionBody(supervisor, "enqueueCollectorForPage");
const resolverExactName = functionBody(supervisor, "resolveMetaAdLibraryVerifiedNameCandidate");
const resolverSlugQueries = functionBody(supervisor, "metaAdLibraryKnownFacebookQueries");
const resolverScorer = functionBody(supervisor, "scoreMetaSearchPageCandidate");
const metaHtmlParser = functionBody(supervisor, "normaliseMetaAdLibraryHtml");
const hostedMetaParser = [
  functionBody(supervisor, "normaliseHostedMetaItems"),
  functionBody(supervisor, "extractCandidateAds"),
].join("\n");
const captureInput = functionBody(supervisor, "captureInput");
const metaAdLibraryPageUrl = functionBody(supervisor, "metaAdLibraryPageUrl");

test("Hermes active ad collector is page-targeted, not location or search-query targeted", () => {
  assert.match(
    collector,
    /\bpayload\.advertiserPageId\b[\s\S]*\bpayload\.metaPageId\b|\bpayload\.metaPageId\b[\s\S]*\bpayload\.advertiserPageId\b/,
    "collector must require the resolved advertiser page and Meta page id handoff",
  );

  const forbiddenTargetTokens = [
    "searchQuery",
    "search_query",
    "search query",
    "location",
    "geo",
    "radius",
    "postcode",
    "suburb",
  ];
  const present = forbiddenTargetTokens.filter((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(collector),
  );

  assert.deepEqual(
    present,
    [],
    `active collector must not use location/search-query collection targets: ${present.join(", ")}`,
  );
});

test("Hermes active ad collector supports browser/http_json capture", () => {
  assert.match(collector, /\bmetaCaptureProvider\b[\s\S]*["']http_json["']/);
  assert.match(collector, /\bmetaCaptureEndpoint\b/);
  assert.match(
    collector,
    /\bfetch\s*\(\s*metaCaptureEndpoint\b|\brest\s*\([^)]*metaCaptureEndpoint\b/s,
    "http_json capture must call the configured capture endpoint",
  );
  assert.match(
    collector,
    /\bbrowser\b|\bcapture[_-]?mode\b|\bprovider\b[\s\S]*http_json/i,
    "collector must preserve browser/http_json capture metadata",
  );
});

test("Hermes Meta parser explicitly handles search_results_connection collated_results arrays", () => {
  assert.match(
    metaHtmlParser,
    /\bsearch_results_connection\b/,
    "browser parser must inspect Meta search_results_connection payloads",
  );
  assert.match(
    `${metaHtmlParser}\n${hostedMetaParser}`,
    /\bcollated_results\b[\s\S]*\b(?:Array\.isArray|objectArray|collectArrays)\b|\b(?:Array\.isArray|objectArray|collectArrays)\b[\s\S]*\bcollated_results\b/,
    "parser must explicitly unwrap Meta collated_results arrays from search_results_connection payloads",
  );
});

test("Hermes page resolver may use exact verified-subject Meta Ad Library search, not location or ad-first discovery", () => {
  const resolverSource = `${pageResolver}\n${resolverExactName}`;
  assert.match(
    resolverSource,
    /\bsubject\.name\b[\s\S]*(?:ads\/library|Meta Ad Library|metaAdLibrary|search_terms|searchTerms)|(?:ads\/library|Meta Ad Library|metaAdLibrary|search_terms|searchTerms)[\s\S]*\bsubject\.name\b/i,
    "resolver must search Meta Ad Library by the verified subject name",
  );
  assert.match(
    pageResolver,
    /\blocation_search_allowed:\s*false\b/,
    "resolver must keep location search explicitly disabled",
  );

  const forbiddenResolverTokens = [
    "geo",
    "radius",
    "locationTarget",
    "location_target",
    "targetLocation",
    "target_location",
    "postcode",
    "suburb",
    "ad_first",
    "ad-first",
    "adFirst",
  ];
  const present = forbiddenResolverTokens.filter((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(pageResolver),
  );

  assert.deepEqual(
    present,
    [],
    `resolver must not use location or ad-first discovery: ${present.join(", ")}`,
  );
});

test("Hermes page resolver searches verified Facebook slugs for agent-run pages", () => {
  assert.match(
    resolverExactName,
    /\bmetaAdLibraryKnownFacebookQueries\s*\(\s*facebookCandidates\s*\)/,
    "resolver must search Meta Ad Library with slugs from verified Facebook evidence",
  );
  assert.match(
    resolverSlugQueries,
    /\bdecodeURIComponent\b[\s\S]*\bfacebookSlugFromUrl\b|\bfacebookSlugFromUrl\b[\s\S]*\bdecodeURIComponent\b/,
    "slug query builder must derive search terms from verified Facebook page URLs",
  );
  assert.match(
    resolverScorer,
    /\bsubject\.kind\s*===\s*["']agent["'][\s\S]*\bknownSlugMatch\b[\s\S]*\bsubjectOverlap\s*>=\s*1\b/,
    "agent direct Facebook slug matches should be collectable when at least one agent-name token overlaps",
  );
});

test("Hermes queues and resolves verified agent pages, not just agency pages", () => {
  const resolverBootstrap = `${agentCensus}\n${verifiedSubjectUpsert}`;
  assert.match(
    resolverBootstrap,
    /dedupe_key:\s*`page-resolver:agent:\$\{agentId\}`[\s\S]*subjectKind:\s*["']agent["']|subjectKind:\s*["']agent["'][\s\S]*dedupe_key:\s*`page-resolver:agent:\$\{agentId\}`/,
    "census must queue page resolver jobs for verified agents",
  );
  assert.doesNotMatch(
    pageResolver,
    /page_resolver_subject_not_supported|v1 resolver handles agency subjects first/,
    "page resolver must not block agent subjects",
  );
  assert.match(
    pageResolver,
    /\bagent_id:\s*subject\.agent\?\.id\b/,
    "resolved advertiser pages must preserve agent ownership",
  );
});

test("Hermes ad collection remains by verified Meta page id only", () => {
  assert.match(
    collector,
    /\brealEstateGate\?\.\bverified\b[\s\S]*true|true[\s\S]*\brealEstateGate\?\.\bverified\b/,
    "collector must require the verified real-estate gate before collection",
  );
  assert.match(
    `${captureInput}\n${metaAdLibraryPageUrl}`,
    /\bmetaPageId\b[\s\S]*\bview_all_page_id\b|\bview_all_page_id\b[\s\S]*\bmetaPageId\b/,
    "Meta Ad Library collection URL must target the resolved Meta page id",
  );

  const forbiddenCollectionTokens = [
    "searchQuery",
    "search_query",
    "search query",
    "search_terms",
    "postcode",
    "suburb",
  ];
  const collectionSource = `${captureInput}\n${metaAdLibraryPageUrl}`;
  const present = forbiddenCollectionTokens.filter((token) =>
    new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(collectionSource),
  );

  assert.deepEqual(
    present,
    [],
    `ad collection target must not use postcode/suburb/search-query inputs: ${present.join(", ")}`,
  );
});

test("Hermes prioritizes ad collection once a verified page is resolved", () => {
  assert.match(
    collectorEnqueue,
    /\bjob_type:\s*["']blockwise-ad-collector["'][\s\S]*\bpriority:\s*[0-5]\b/,
    "verified page collection should run before the remaining resolver backlog",
  );
});

test("Hermes active ad collector ingests the hard-reset ad tables and media assets", () => {
  for (const table of [
    "ad_fetch_runs",
    "observed_ads",
    "ad_snapshots",
    "ad_creatives",
    "media_assets",
  ]) {
    assert.match(
      collector,
      new RegExp(`\\b${table}\\b`, "i"),
      `collector must reference research.${table} during ingest`,
    );
  }
});

test("Hermes active ad collector queues media and classifier follow-up jobs", () => {
  for (const jobType of [
    "blockwise-media-collector",
    "blockwise-ad-classifier",
  ]) {
    assert.match(
      collector,
      new RegExp(`enqueueFollowUp[\\s\\S]*job_type:\\s*["']${escapeRegExp(jobType)}["']`, "i"),
      `collector must enqueue ${jobType} follow-up work after ingest`,
    );
  }
});

test("Hermes media collector can rebuild missing media rows from saved creative URLs", () => {
  assert.match(
    mediaCollector,
    /\bloadCreativeForMediaCapture\b[\s\S]*\bmediaSourcesFromCreative\b|\bmediaSourcesFromCreative\b[\s\S]*\bloadCreativeForMediaCapture\b/,
    "media collector must recover when media_assets rows are missing but ad_creatives still has source media",
  );
  assert.match(
    mediaCollector,
    /\bcaptureMediaAsset\b[\s\S]*\brefreshCreativeStoredMedia\b/,
    "media collector must download assets and refresh storage-backed creative fields",
  );
});

function functionBody(source, name) {
  let start = source.indexOf(`async function ${name}`);
  if (start === -1) start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist in ${supervisorPath}`);

  const paramsEnd = source.indexOf(")", start);
  assert.notEqual(paramsEnd, -1, `${name} must have a parameter list`);

  const bodyStart = source.indexOf("{", paramsEnd);
  assert.notEqual(bodyStart, -1, `${name} must have a function body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }
  assert.fail(`${name} body was not closed`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
