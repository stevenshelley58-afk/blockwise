import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const supervisorPath = "hermes/tools/research-runtime/bin/supabase-supervisor.mjs";
const supervisor = readFileSync(join(root, supervisorPath), "utf8");
const mainWrapper = readFileSync(join(root, "infra/hermes/main-wrapper.sh"), "utf8");
const collector = functionBody(supervisor, "handleAdCollector");
const mediaCollector = functionBody(supervisor, "handleMediaCollector");
const captureMediaAsset = functionBody(supervisor, "captureMediaAsset");
const findMediaBlob = functionBody(supervisor, "findMediaBlob");
const insertMediaBlob = functionBody(supervisor, "insertMediaBlob");
const agentCensus = functionBody(supervisor, "handleAgentCensus");
const verifiedSubjectUpsert = functionBody(supervisor, "upsertVerifiedAgency");
const pageResolver = functionBody(supervisor, "handlePageResolver");
const adPageRefresh = functionBody(supervisor, "enqueueDueAdPageRefreshJobs");
const collectorEnqueue = functionBody(supervisor, "enqueueCollectorForPage");
const resolverExactName = functionBody(supervisor, "resolveMetaAdLibraryVerifiedNameCandidate");
const resolverSlugQueries = functionBody(supervisor, "metaAdLibraryKnownFacebookQueries");
const resolverScorer = functionBody(supervisor, "scoreMetaSearchPageCandidate");
const resolverFacebookSubject = functionBody(supervisor, "resolverSubjectForFacebookPage");
const serviceAreaWrite = functionBody(supervisor, "ensureServiceArea");
const locationAdSearchQueue = functionBody(supervisor, "enqueueDueLocationAdSearchJobs");
const locationAdSearch = functionBody(supervisor, "handleLocationAdSearch");
const locationSearchUrl = functionBody(supervisor, "metaAdLibraryLocationSearchUrl");
const locationAdMatch = functionBody(supervisor, "locationAdMatchForInput");
const rosterSuburbNormaliser = functionBody(supervisor, "normaliseRosterSuburb");
const metaHtmlParser = functionBody(supervisor, "normaliseMetaAdLibraryHtml");
const hostedMetaParser = [
  functionBody(supervisor, "normaliseHostedMetaItems"),
  functionBody(supervisor, "extractCandidateAds"),
].join("\n");
const captureInput = functionBody(supervisor, "captureInput");
const metaAdLibraryPageUrl = functionBody(supervisor, "metaAdLibraryPageUrl");
const areaAttribution = functionBody(supervisor, "upsertAreaMatchesForObservedAd");
const explicitAreaAttribution = functionBody(supervisor, "upsertExplicitAreaMatchForObservedAd");
const browserDumpDom = functionBody(supervisor, "browserDumpDom");
const resolveRemoteBrowserWebSocket = functionBody(supervisor, "resolveRemoteBrowserWebSocket");
const remoteBrowserVersionUrl = functionBody(supervisor, "remoteBrowserVersionUrl");
const rewriteRemoteBrowserWebSocketHost = functionBody(supervisor, "rewriteRemoteBrowserWebSocketHost");

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

test("Hermes cools down remote browser capture after failures", () => {
  assert.match(
    supervisor,
    /\bremoteBrowserDisabledUntil\b/,
    "remote browser failures should set a runtime cooldown instead of retrying the sidecar every capture",
  );
  assert.match(
    browserDumpDom,
    /\bremoteBrowserDisabledUntil\s*=\s*Date\.now\(\)\s*\+\s*remoteBrowserFailureCooldownMs\b/u,
    "remote browser failures should cool down the sidecar path before local fallback",
  );
  assert.match(
    browserDumpDom,
    /\bcooldownMs\b/u,
    "the fallback log should include cooldown state so operators can see why the sidecar is being skipped",
  );
});

test("Hermes census writes let database generated normalized names compute", () => {
  const writePayloads = verifiedSubjectUpsert
    .replace(/agents\?select=[^\n]+/giu, "")
    .replace(/agencies\?on_conflict=normalized_name,state/giu, "");

  assert.doesNotMatch(
    writePayloads,
    /\bnormalized_name\s*:/u,
    "census inserts must not write generated normalized_name columns",
  );
  assert.match(
    verifiedSubjectUpsert,
    /agencies\?on_conflict=normalized_name,state/u,
    "agency dedupe should still use the database-computed normalized name conflict key",
  );
  assert.match(
    verifiedSubjectUpsert,
    /agents\?select=id&normalized_name=eq\./u,
    "agent dedupe should still query the database-computed normalized name",
  );
});

test("Hermes census supervisor keeps source-backed targets grinding", () => {
  assert.match(
    supervisor,
    /const DEFAULT_POSTCODES = \["ALL"\]/u,
    "census defaults should not be locked to the old Perth postcode list",
  );
  assert.match(
    supervisor,
    /\bensureSourceBackedRefreshPolicies\b[\s\S]*refresh_policies\?on_conflict=postcode,state/u,
    "supervisor should seed source-backed postcode policies through the existing refresh table",
  );
  assert.match(
    supervisor,
    /\brecycleBlockedCensusJob\b[\s\S]*source_backed_census_recycle/u,
    "source-backed schema/runtime failures should be recyclable instead of permanently blocking the dedupe key",
  );
  assert.match(
    supervisor,
    /\bdeferCensusPolicy\b[\s\S]*Hermes deferred census target/u,
    "exhausted census targets should be deferred so later targets can run",
  );
  assert.match(
    supervisor,
    /\bcensusQueuePriority\b[\s\S]*job_type:\s*["']blockwise-agent-census["'][\s\S]*priority:\s*censusQueuePriority/u,
    "census work should be tunable so verified page resolution and ad collection are not starved",
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

test("Hermes page resolver can retry an already discovered Facebook URL", () => {
  assert.match(
    pageResolver,
    /\bsuppliedFacebookUrl\b[\s\S]*\bpayload\.facebookUrl\b[\s\S]*\bfacebookCandidates\.add\s*\(\s*suppliedFacebookUrl\s*\)/u,
    "manual page resolver retries should seed the unresolved Facebook URL directly into candidate resolution",
  );
});

test("Hermes page resolver collects agency Facebook pages linked from verified agent evidence", () => {
  assert.match(
    resolverFacebookSubject,
    /\bagent:\s*null\b[\s\S]*\bagencyPageFallback:\s*true\b/u,
    "agent-linked agency Facebook pages should be re-owned to the verified agency before collection",
  );
  assert.match(
    pageResolver,
    /\bresolverSubjectForFacebookPage\s*\(\s*pageUrl,\s*subject\s*\)[\s\S]*\bpageSubject\.agent\?\.id\s*\|\|\s*null/u,
    "page resolver must use the candidate page subject rather than blindly assigning agency pages to the agent",
  );
  assert.match(
    pageResolver,
    /verified_agent_agency_page_fallback/u,
    "fallback agency-page resolutions should be traceable in advertiser page metadata",
  );
});

test("Hermes location ad search is explicit, gated, and separate from page collection", () => {
  assert.match(
    supervisor,
    /const LOCATION_AD_SEARCH_JOB_TYPE = ["']blockwise-location-ad-search["']/u,
    "location ad search must be an explicit job type",
  );
  assert.match(
    locationAdSearchQueue,
    /\brefresh_policies\b[\s\S]*\bpostcode\b[\s\S]*\bsuburb\b/u,
    "location searches should be queued from the existing postcode refresh policies",
  );
  assert.match(
    locationAdSearch,
    /\blocation_search_allowed\b[\s\S]*\brealEstateGate\?\.\bverified\b|\brealEstateGate\?\.\bverified\b[\s\S]*\blocation_search_allowed\b/u,
    "location search collection must require an explicit verified location-search gate",
  );
  assert.match(
    `${locationSearchUrl}\n${locationAdSearch}`,
    /\bsearch_type\b[\s\S]*\bkeyword_unordered\b[\s\S]*\bq\b/u,
    "location search must use Meta Ad Library keyword search instead of pretending to be a page collector",
  );
  assert.match(
    locationAdSearch,
    /\blocationAdMatchForInput\b[\s\S]*\bhasRealEstateAdSignalForLocation\b/u,
    "location search results must be filtered by exact visible location and real-estate signals before ingest",
  );
  assert.match(
    locationAdSearch,
    /\bupsertExplicitAreaMatchForObservedAd\b|\bexplicitAreaMatch\b/u,
    "location search ingestion must attach explicit public area attribution without schema changes",
  );
});

test("Hermes postcode source parsing preserves Spearwood for postcode 6163", () => {
  assert.match(
    supervisor,
    /"6163":\s*\[[\s\S]*suburb:\s*["']Spearwood["']/u,
    "6163 should explicitly seed Spearwood before the per-postcode source cap is applied",
  );
  assert.match(
    rosterSuburbNormaliser,
    /\^\[A-Z\]\{2,3\}\\s\+\\d\{4\}\\s\+\(\?<suburb>\.\+\)\$/u,
    "postcode data rows like 'TAS 7264 SPEARWOOD' should be normalised to the suburb name instead of discarded",
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

test("Hermes auto-refresh keeps collecting after blocked ad collector failures", () => {
  assert.match(
    adPageRefresh,
    /job_type=eq\.blockwise-ad-collector&status=in\.\(pending,claimed\)/u,
    "only pending/claimed ad collectors should consume active refresh capacity",
  );
  assert.match(
    adPageRefresh,
    /\bblockingCollectors\b[\s\S]*\bpriority\b[\s\S]*adRefreshPriorityForPage\(\{\s*status:\s*["']resolved_collectable["']\s*\}\)/u,
    "low-priority no-ads refresh backlog must not block high-priority resolved page scraping",
  );
  assert.match(
    adPageRefresh,
    /\bactivePageIds\b[\s\S]*activeCollectors\.map/u,
    "all pending/claimed collectors should still dedupe by page even when only high-priority jobs consume capacity",
  );
  assert.doesNotMatch(
    adPageRefresh,
    /job_type=eq\.blockwise-ad-collector&status=in\.\(pending,claimed,failed,blocked\)/u,
    "blocked collector rows must not permanently suppress future page refreshes",
  );
  assert.match(
    adPageRefresh,
    /\badPageRefreshScanLimit\b/u,
    "refresh should scan beyond one small page window so stale blocked pages do not hide later candidates",
  );
  assert.match(
    adPageRefresh,
    /\bconsecutive_failed_checks\b[\s\S]*\badPageRefreshMaxConsecutiveFailures\b/u,
    "pages with repeated capture failures should stop filling the refresh queue",
  );
  assert.match(
    adPageRefresh,
    /\badRefreshPriorityForPage\b[\s\S]*\bpriority:\s*adRefreshPriorityForPage\(page\)/u,
    "resolved pages should keep collection priority over previously empty pages",
  );
  assert.match(
    adPageRefresh,
    /\benqueueFollowUp\s*\(/u,
    "auto-refresh should recycle failed/blocked dedupe rows instead of throwing on conflicts",
  );
});

test("Hermes container wrapper restarts the research supervisor if it exits", () => {
  assert.match(
    mainWrapper,
    /while\s+:/u,
    "wrapper should keep the supervisor under a restart loop",
  );
  assert.match(
    mainWrapper,
    /s6-setuidgid hermes node \/app\/research-runtime\/bin\/supabase-supervisor\.mjs/u,
    "wrapper must still run the supervisor as the hermes user",
  );
  assert.match(
    mainWrapper,
    /supervisor exited with status/u,
    "wrapper should log supervisor exits before restarting",
  );
});

test("Hermes prioritizes saved-ad classification before resolver backlog", () => {
  const followUpSource = `${collector}\n${mediaCollector}`;
  assert.match(
    followUpSource,
    /\bjob_type:\s*["']blockwise-ad-classifier["'][\s\S]*\bpriority:\s*[0-5]\b/,
    "saved ad classification should run before the remaining page resolver backlog",
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

test("Hermes active ad collector propagates all known service-area postcodes", () => {
  assert.doesNotMatch(
    areaAttribution,
    /agent_service_areas\?select=postcode,suburb,state,confidence[^`]*limit=20/u,
    "ad area attribution must not cap service areas at the old 20 postcode limit",
  );
  assert.match(
    areaAttribution,
    /agent_service_areas\?select=postcode,suburb,state,confidence[^`]*limit=1000/u,
    "ad area attribution should read enough service-area rows for multi-postcode agencies",
  );
  assert.match(
    areaAttribution,
    /agencyRows\.map\(\(row\) => \(\{ \.\.\.row, matchType: ["']agency_service_area["'] \}\)\)/u,
    "agency-owned pages should write agency_service_area matches",
  );
  assert.match(
    areaAttribution,
    /agentRows\.map\(\(row\) => \(\{ \.\.\.row, matchType: ["']agent_service_area["'] \}\)\)/u,
    "agent-owned pages should write agent_service_area matches",
  );
});

test("Hermes area attribution fails loudly if REST cannot see the area tables", () => {
  assert.doesNotMatch(
    serviceAreaWrite,
    /missingSchemaRelation\s*\(\s*error,\s*["']agent_service_areas["']\s*\)\)\s*return\s+null/u,
    "census service-area writes must not silently vanish when agent_service_areas is missing from REST",
  );
  assert.doesNotMatch(
    explicitAreaAttribution,
    /missingSchemaRelation\s*\(\s*error,\s*["']ad_area_matches["']\s*\)\)\s*return\s+0/u,
    "explicit location matches must not silently vanish when ad_area_matches is missing from REST",
  );
  assert.doesNotMatch(
    areaAttribution,
    /missingSchemaRelation\s*\(\s*error,\s*["']agent_service_areas["']\s*\)\)\s*return\s+0/u,
    "page service-area matches must not silently vanish when agent_service_areas is missing from REST",
  );
  assert.doesNotMatch(
    areaAttribution,
    /missingSchemaRelation\s*\(\s*error,\s*["']ad_area_matches["']\s*\)\)\s*return\s+count/u,
    "partial area writes must not be reported as successful when ad_area_matches disappears",
  );
  assert.match(
    `${serviceAreaWrite}\n${explicitAreaAttribution}\n${areaAttribution}`,
    /area attribution cannot be written/u,
    "area schema failures should leave an actionable failed job reason",
  );
  assert.match(
    serviceAreaWrite,
    /verified service areas cannot be written/u,
    "census schema failures should leave an actionable failed job reason",
  );
});

test("Hermes browser capture uses DevTools capture instead of dump-dom stalls", () => {
  assert.match(
    browserDumpDom,
    /\bremote-debugging-port=0\b[\s\S]*\bcaptureDomOverCdp\b/u,
    "Meta captures should read DOM through CDP instead of waiting for chromium --dump-dom to finish",
  );
});

test("Hermes browser capture uses configured remote CDP before local Chromium", () => {
  assert.match(
    browserDumpDom,
    /\bremoteBrowserCdpUrl\b[\s\S]*\bresolveRemoteBrowserWebSocket\b[\s\S]*\bcaptureDomOverCdp\b/u,
    "browser-rendered captures should use the configured remote CDP endpoint before local Chromium",
  );
  assert.match(
    browserDumpDom,
    /\bspawn\s*\(\s*metaBrowserExecutable\b[\s\S]*\bcaptureDomOverCdp\b/u,
    "local Chromium fallback should keep the shared CDP DOM capture path",
  );
  assert.match(
    resolveRemoteBrowserWebSocket,
    /\bremoteBrowserVersionUrl\b[\s\S]*\bwebSocketDebuggerUrl\b/u,
    "HTTP CDP endpoints should resolve the browser WebSocket through /json/version",
  );
  assert.match(
    remoteBrowserVersionUrl,
    /json\/version/u,
    "HTTP CDP endpoint resolution should query /json/version",
  );
  assert.match(
    rewriteRemoteBrowserWebSocketHost,
    /\bhostname\s*=\s*configured\.hostname\b[\s\S]*\bport\s*=\s*configured\.port\b/u,
    "reported localhost WebSocket URLs should be rewritten to the configured remote host",
  );
});

test("Hermes ad collector records page-level capture failures for refresh backoff", () => {
  assert.match(
    collector,
    /\bmarkAdvertiserPageCheckFailed\s*\(\s*payload\.advertiserPageId\s*\)/u,
    "failed captures should increment advertiser_pages.consecutive_failed_checks",
  );
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

test("Hermes media collector globally dedupes stored media by content hash", () => {
  const mediaSource = `${mediaCollector}\n${captureMediaAsset}\n${findMediaBlob}\n${insertMediaBlob}`;
  assert.match(
    mediaSource,
    /\bmedia_blobs\b/,
    "media capture must use the global research.media_blobs table for hash-level dedupe",
  );
  assert.match(
    mediaSource,
    /\bcontent_hash\b/,
    "media asset rows must keep the global content hash",
  );
  assert.match(
    mediaSource,
    /\bdeduped\b/,
    "media collector result should expose how many assets reused existing blobs",
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
