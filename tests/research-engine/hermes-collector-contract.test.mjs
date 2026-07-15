import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const supervisorPath = "hermes/tools/research-runtime/bin/supabase-supervisor.mjs";
const supervisor = readFileSync(join(root, supervisorPath), "utf8");
const runtimeTypes = readFileSync(join(root, "hermes/tools/research-runtime/src/types.ts"), "utf8");
const mainWrapper = readFileSync(join(root, "infra/hermes/main-wrapper.sh"), "utf8");
const researchCompose = readFileSync(join(root, "infra/coolify/docker-compose.research.yml"), "utf8");
const recordEvent = functionBody(supervisor, "recordEvent");
const setRuntimeSetting = functionBody(supervisor, "setRuntimeSetting");
const collector = functionBody(supervisor, "handleAdCollector");
const postIngestJobs = functionBody(supervisor, "enqueuePostIngestJobs");
const ingestMetaAd = functionBody(supervisor, "ingestMetaAd");
const missingAdReconciliation = functionBody(supervisor, "reconcileMissingObservedAds");
const activeStatusForMetaAd = functionBody(supervisor, "activeStatusForMetaAd");
const deliveryStoppedAtForMetaAd = functionBody(supervisor, "deliveryStoppedAtForMetaAd");
const trustedZeroAdCapture = functionBody(supervisor, "isTrustedConfirmedZeroAdCapture");
const mediaCollector = functionBody(supervisor, "handleMediaCollector");
const upsertMediaAssets = functionBody(supervisor, "upsertMediaAssets");
const adClassifier = functionBody(supervisor, "handleAdClassifier");
const captureMediaAsset = functionBody(supervisor, "captureMediaAsset");
const findCapturedMediaAssetByStorage = functionBody(supervisor, "findCapturedMediaAssetByStorage");
const freshMediaUrlForAsset = functionBody(supervisor, "freshMediaUrlForAsset");
const findMediaBlob = functionBody(supervisor, "findMediaBlob");
const insertMediaBlob = functionBody(supervisor, "insertMediaBlob");
const agentCensus = functionBody(supervisor, "handleAgentCensus");
const deferCensusPolicy = functionBody(supervisor, "deferCensusPolicy");
const sourceBackedStateGate = functionBody(supervisor, "hasCensusSourceForState");
const verifiedSubjectUpsert = functionBody(supervisor, "upsertVerifiedAgency");
const reusableAgentForVerifiedAgency = functionBody(supervisor, "findReusableAgentForVerifiedAgency");
const legalEntityAliasAgency = functionBody(supervisor, "isLegalEntityAliasAgency");
const pageResolver = functionBody(supervisor, "handlePageResolver");
const adPageRefresh = functionBody(supervisor, "enqueueDueAdPageRefreshJobs");
const collectorEnqueue = functionBody(supervisor, "enqueueCollectorForPage");
const resolverExactName = functionBody(supervisor, "resolveMetaAdLibraryVerifiedNameCandidate");
const resolverSlugQueries = functionBody(supervisor, "metaAdLibraryKnownFacebookQueries");
const resolverScorer = functionBody(supervisor, "scoreMetaSearchPageCandidate");
const resolverFacebookSubject = functionBody(supervisor, "resolverSubjectForFacebookPage");
const serviceAreaWrite = functionBody(supervisor, "ensureServiceArea");
const locationAdSearchQueue = functionBody(supervisor, "enqueueDueLocationAdSearchJobs");
const locationSearchRecycle = functionBody(supervisor, "recycleBlockedLocationSearchJobs");
const locationSearchRecycleGate = functionBody(supervisor, "canRecycleBlockedLocationSearch");
const locationAdSearchPriority = functionBody(supervisor, "locationAdSearchPriorityForPolicy");
const locationAdSearch = functionBody(supervisor, "handleLocationAdSearch");
const locationSearchUrl = functionBody(supervisor, "metaAdLibraryLocationSearchUrl");
const locationAdMatch = functionBody(supervisor, "locationAdMatchForInput");
const locationRealEstateGate = functionBody(supervisor, "hasRealEstateAdSignalForLocation");
const locationRealEstateSignal = functionBody(supervisor, "hasStrongRealEstateAdSignal");
const locationPageNameSignal = functionBody(supervisor, "hasConservativeRealEstatePageNameSignal");
const coverageAuditor = functionBody(supervisor, "handleCoverageAuditor");
const defectInvestigator = functionBody(supervisor, "handleDefectInvestigator");
const coverageRefresh = functionBody(supervisor, "requestCoverageRefresh");
const staleAgencyWatchdog = functionBody(supervisor, "watchdogRecheckStaleAgencies");
const unresolvedPageWatchdog = functionBody(supervisor, "watchdogRequeueUnresolvedPages");
const staleBlockedArchiveWatchdog = functionBody(supervisor, "watchdogArchiveStaleBlockedJobs");
const classificationBackfill = functionBody(supervisor, "enqueueClassificationBackfillJobs");
const classificationBackfillCandidates = functionBody(supervisor, "loadClassificationBackfillCandidates");
const handleJob = functionBody(supervisor, "handleJob");
const rosterSuburbNormaliser = functionBody(supervisor, "normaliseRosterSuburb");
const metaHtmlParser = functionBody(supervisor, "normaliseMetaAdLibraryHtml");
const hostedMetaParser = [
  functionBody(supervisor, "normaliseHostedMetaItems"),
  functionBody(supervisor, "extractCandidateAds"),
].join("\n");
const captureInput = functionBody(supervisor, "captureInput");
const metaAdLibraryPageUrl = functionBody(supervisor, "metaAdLibraryPageUrl");
const configuredMetaPageCapture = functionBody(supervisor, "runMetaPageCapture");
const apifyMetaPageCapture = functionBody(supervisor, "runApifyMetaPageCapture");
const apifyActorResolution = functionBody(supervisor, "resolveApifyCaptureActor");
const apifyCandidateBenchmark = functionBody(supervisor, "runApifyCandidateBenchmarkIfNeeded");
const apifyActorBenchmark = functionBody(supervisor, "benchmarkApifyCandidateActor");
const apifyCanaryInput = functionBody(supervisor, "readApifyCanaryCaptureInput");
const apifyPageInput = functionBody(supervisor, "apifyMetaPageInput");
const apifyLocationSearchInput = functionBody(supervisor, "apifyMetaLocationSearchInput");
const apifyLocationSearchCapture = functionBody(supervisor, "runApifyLocationSearchCapture");
const apifyErrorCost = functionBody(supervisor, "costUsdFromApifyError");
const apifySpendCircuit = functionBody(supervisor, "openApifyCircuitAfterSpendWithoutIngest");
const apifySpendCircuitGuard = functionBody(supervisor, "openCircuitIfPaidSpendWithoutIngest");
const apifyLedgerSpend = functionBody(supervisor, "readApifyLedgerSpendUsd");
const apifyRawEvidence = functionBody(supervisor, "writeApifyRawEvidence");
const browserPageCapture = functionBody(supervisor, "runHermesBrowserCapture");
const browserLocationSearchCapture = functionBody(supervisor, "runHermesLocationSearchCapture");
const browserRawEvidence = functionBody(supervisor, "writeBrowserRawEvidence");
const configuredMetaFallbackSourceProvider = functionBody(supervisor, "configuredMetaFallbackSourceProvider");
const fallbackMetaPageCapture = functionBody(supervisor, "runFallbackMetaPageCapture");
const officialMetaPageApiCapture = functionBody(supervisor, "runOfficialMetaPageApiCapture");
const officialMetaArchiveUrl = functionBody(supervisor, "officialMetaAdsArchiveUrl");
const insertCoverageDefect = functionBody(supervisor, "insertCoverageDefect");
const resolveCoverageDefects = functionBody(supervisor, "resolveCoverageDefects");
const officialMetaStatusPasses = functionBody(supervisor, "officialMetaStatusPasses");
const areaAttribution = functionBody(supervisor, "upsertAreaMatchesForObservedAd");
const explicitAreaAttribution = functionBody(supervisor, "upsertExplicitAreaMatchForObservedAd");
const browserDumpDom = functionBody(supervisor, "browserDumpDom");
const captureDomOverCdp = functionBody(supervisor, "captureDomOverCdp");
const metaSearchAdPayloadCount = functionBody(supervisor, "metaSearchAdPayloadCount");
const scrollMetaAdLibraryResults = functionBody(supervisor, "scrollMetaAdLibraryResults");
const resolveRemoteBrowserWebSocket = functionBody(supervisor, "resolveRemoteBrowserWebSocket");
const remoteBrowserProbeCdpUrl = functionBody(supervisor, "remoteBrowserProbeCdpUrl");
const remoteBrowserVersionUrl = functionBody(supervisor, "remoteBrowserVersionUrl");
const rewriteRemoteBrowserWebSocketHost = functionBody(supervisor, "rewriteRemoteBrowserWebSocketHost");
const metaChallengeDetector = functionBody(supervisor, "metaAdLibraryChallengeDetected");
const metaChallengeRecorder = functionBody(supervisor, "recordMetaBrowserChallenge");
const metaChallengeJobGate = functionBody(supervisor, "shouldDeferMetaBrowserChallengeJob");
const metaChallengeJobDeferral = functionBody(supervisor, "deferMetaBrowserChallengeJob");
const metaChallengeResumeDelay = functionBody(supervisor, "metaBrowserChallengeResumeDelayMs");
const processOneJob = functionBody(supervisor, "processOneJob");
const metaChallengeCooldownRefresh = functionBody(supervisor, "refreshMetaBrowserChallengeCooldownFromSettings");
const tick = functionBody(supervisor, "tick");

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
  const captureSource = `${collector}\n${configuredMetaFallbackSourceProvider}\n${fallbackMetaPageCapture}`;
  assert.match(captureSource, /\bmetaCaptureProvider\b[\s\S]*["']http_json["']/);
  assert.match(captureSource, /\bmetaCaptureEndpoint\b/);
  assert.match(
    captureSource,
    /\bfetch\s*\(\s*metaCaptureEndpoint\b|\brest\s*\([^)]*metaCaptureEndpoint\b/s,
    "http_json capture must call the configured capture endpoint",
  );
  assert.match(
    captureSource,
    /\bbrowser\b|\bcapture[_-]?mode\b|\bprovider\b[\s\S]*http_json/i,
    "collector must preserve browser/http_json capture metadata",
  );
});

test("Hermes paid Apify capture is budget guarded and ledger backed", () => {
  const apifySource = `${apifyMetaPageCapture}\n${apifyActorResolution}\n${apifyLedgerSpend}\n${apifyRawEvidence}`;
  assert.match(supervisor, /from\s+["']\.\/apify-capture\.mjs["']/u, "supervisor must import the standalone Apify adapter");
  assert.match(supervisor, /\benv\.APIFY_TOKEN\s*\|\|\s*env\.APIFY_API_TOKEN\b/u, "supervisor must accept the operator-owned Apify token aliases");
  assert.match(researchCompose, /\bAPIFY_TOKEN:\s*\$\{APIFY_TOKEN:-\}/u, "Hermes compose service must pass APIFY_TOKEN into the container");
  assert.match(researchCompose, /\bAPIFY_API_TOKEN:\s*\$\{APIFY_API_TOKEN:-\}/u, "Hermes compose service must pass APIFY_API_TOKEN into the container");
  assert.match(apifyMetaPageCapture, /\bguardApifyBudget\b/u, "paid capture must run the budget guard before dispatch");
  assert.match(apifyMetaPageCapture, /\bensureApifyAccountLimit\b/u, "paid capture must assert the account-level spend backstop before dispatch");
  assert.match(apifyMetaPageCapture, /\breadLedgerSpendUsd:\s*readApifyLedgerSpendUsd/u, "budget guard must read the local ad_fetch_runs ledger");
  assert.match(apifyLedgerSpend, /source_provider=like/u, "ledger spend must use a provider-prefix filter");
  assert.match(apifyLedgerSpend, /META_APIFY_SOURCE_PROVIDER_PREFIX/u, "ledger spend must be scoped to apify providers");
  assert.match(apifyMetaPageCapture, /\brunApifyCapture\b/u, "supervisor must call the standalone adapter rather than duplicating Apify fetch code");
  assert.match(apifyMetaPageCapture, /\bhasApifySchemaMap\b/u, "paid capture must not spend against actors without a schema map");
  assert.match(apifyPageInput, /\burls:\s*\[\s*url\s*\]/u, "Apify actors that require input.urls must receive the Meta Ad Library URL");
  assert.match(apifyPageInput, /\bmaxAds:\s*resultLimit\b/u, "Apify actor-specific maxAds defaults must be capped with the shared result limit");
  assert.match(apifyMetaPageCapture, /\bcostUsdFromApifyError\(error\)/u, "failed Apify captures must still ledger any charged run cost");
  assert.match(apifyMetaPageCapture, /\bopenApifyCircuitAfterSpendWithoutIngest\b/u, "charged failed Apify captures must open the paid circuit");
  assert.match(apifyErrorCost, /\bextractApifyRunCost\b/u, "Apify error cost extraction must reuse the run-detail cost parser");
  assert.match(apifySpendCircuit, /\bsetRuntimeSetting\(["']apify_state["'],\s*["']circuit_open["']/u, "spend without ingest must open the Apify circuit");
  assert.match(apifySpendCircuit, /\binsertCoverageDefect\b/u, "spend without ingest must leave an operator defect");
  assert.match(apifySpendCircuitGuard, /\bisApifySourceProvider\b/u, "generic circuit helper must only react to Apify providers");
  assert.match(apifySpendCircuitGuard, /Number\(costUsd\)\s*>\s*0[\s\S]*Number\(ingestedCount\)\s*>\s*0/u, "paid circuit helper must require positive spend and zero ingested rows");
  assert.match(apifyActorResolution, /\bselectCheapestApifyActor\b/u, "approved actor selection should use the cheapest passing actor helper");
  assert.match(apifyRawEvidence, /\bRAW_EVIDENCE_BUCKET\b/u, "schema failures should save raw Apify payload evidence");
  assert.match(apifyActorBenchmark, /item_count:\s*normalisedAds\.length[\s\S]*raw_item_count:\s*rawItems\.length[\s\S]*valid_ad_count:\s*normalisedAds\.length/u, "Apify canaries should write the canonical item_count used by zero-ad watchdogs");
});

test("Hermes browser parse failures store raw evidence pointers", () => {
  assert.match(browserPageCapture, /safeWriteBrowserRawEvidence\(["']page-capture["']/u, "page capture parse failures must save browser raw evidence");
  assert.match(browserPageCapture, /\braw_evidence\b/u, "page capture metadata must expose raw evidence pointers");
  assert.match(browserLocationSearchCapture, /safeWriteBrowserRawEvidence\(["']location-search["']/u, "location search parse failures must save browser raw evidence");
  assert.match(browserLocationSearchCapture, /\braw_evidence\b/u, "location search metadata must expose raw evidence pointers");
  assert.match(browserRawEvidence, /\bRAW_EVIDENCE_BUCKET\b/u, "browser evidence must use the configured raw evidence bucket");
  assert.match(browserRawEvidence, /["']browser["']/u, "browser evidence should be stored under a browser prefix for operator review");
});

test("Hermes Meta browser challenges cool down capture instead of masquerading as no ads", () => {
  assert.match(
    metaChallengeDetector,
    /__rd_verify_[\s\S]*executeChallenge|executeChallenge[\s\S]*__rd_verify_/u,
    "Meta challenge detector must identify the short /__rd_verify challenge page saved in raw evidence",
  );
  assert.match(
    metaHtmlParser,
    /metaAdLibraryChallengeDetected[\s\S]*browser verification challenge[\s\S]*challengeDetected/u,
    "challenge captures should be labelled explicitly instead of as generic parser failures",
  );
  assert.match(
    `${browserPageCapture}\n${browserLocationSearchCapture}`,
    /recordMetaBrowserChallenge[\s\S]*challenge_detected/u,
    "browser capture paths must record challenge cooldowns and keep challenge evidence visible",
  );
  assert.match(
    `${adPageRefresh}\n${locationAdSearchQueue}`,
    /metaBrowserChallengeCooldownRemaining[\s\S]*SkippedChallengeCooldown/u,
    "capture schedulers must stop feeding new browser captures while the challenge cooldown is active",
  );
  assert.match(
    metaChallengeRecorder,
    /setRuntimeSetting\(\s*META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING[\s\S]*disabledUntil[\s\S]*cooldownMs/u,
    "challenge recorder must persist and expose cooldown state instead of silently pausing work",
  );
  assert.match(
    `${metaChallengeCooldownRefresh}\n${tick}`,
    /readRuntimeSettings\(\s*\[META_BROWSER_CHALLENGE_DISABLED_UNTIL_SETTING\]\s*\)[\s\S]*refreshMetaBrowserChallengeCooldownFromSettings\(\)[\s\S]*enqueueDueAdPageRefreshJobs/u,
    "challenge cooldown must survive restarts and be read before capture scheduling",
  );
  assert.match(
    processOneJob,
    /shouldDeferMetaBrowserChallengeJob\(\s*job\s*\)[\s\S]*deferMetaBrowserChallengeJob\(\s*job\s*\)/u,
    "already-queued challenge retries should be deferred before capture handling",
  );
  assert.match(
    metaChallengeJobGate,
    /metaBrowserChallengeCooldownRemaining\(\)[\s\S]*LOCATION_AD_SEARCH_JOB_TYPE[\s\S]*blockwise-ad-collector[\s\S]*metaCaptureProvider === ["']hermes_browser["']/u,
    "challenge deferral should apply to free-browser Meta capture jobs while cooldown is active",
  );
  assert.match(
    metaChallengeJobDeferral,
    /attempts:\s*previousAttempts[\s\S]*available_at:[\s\S]*cooldownMs/u,
    "challenge deferral must preserve the job and avoid consuming attempts while cooling down",
  );
  assert.match(
    `${metaChallengeJobDeferral}\n${metaChallengeResumeDelay}`,
    /resume_spread_ms:\s*META_BROWSER_CHALLENGE_RESUME_SPREAD_MS[\s\S]*hash\(`\$\{job\?\.[\s\S]*job_type[\s\S]*META_BROWSER_CHALLENGE_RESUME_SPREAD_MS/u,
    "challenge deferral should stagger resume times so cooled-down capture jobs do not all become due at once",
  );
});

test("Hermes active ad collector only spends on Apify when Apify is explicitly configured", () => {
  assert.doesNotMatch(configuredMetaPageCapture, /\bcaptureWithPaidApifyFailover\b/u, "browser/http_json failures must not automatically spend on Apify");
  assert.doesNotMatch(configuredMetaPageCapture, /\brunApifyMetaPageCapture\(input,\s*fallback/u, "free capture failure must not trigger hidden paid fallback");
  assert.match(fallbackMetaPageCapture, /sourceProvider === META_APIFY_SOURCE_PROVIDER[\s\S]*runApifyMetaPageCapture\(input,\s*null,\s*\{\s*explicit:\s*true\s*\}\)/u, "Apify page capture should only run when Apify is the configured provider");
  assert.match(configuredMetaPageCapture, /\bcaptureModeForSourceProvider\b/u, "capture metadata should reflect the configured provider");
});

test("Hermes treats disabled explicit Apify capture as skipped work, not a blocked job", () => {
  assert.match(
    apifyMetaPageCapture,
    /skippedCaptureOutcome\(META_APIFY_SOURCE_PROVIDER[\s\S]*skip_reason:\s*parsedSettings\.enabled \? ["']apify_circuit_open["'] : ["']apify_disabled["']/u,
    "disabled or circuit-open explicit Apify capture should return a skipped outcome without paid dispatch",
  );
  assert.match(
    collector,
    /outcome\.status === ["']SKIPPED["'][\s\S]*status:\s*["']failed["'][\s\S]*skipped:\s*true[\s\S]*status:\s*["']complete["']/u,
    "skipped capture should complete the work queue job while recording a failed/skipped fetch run",
  );
  assert.doesNotMatch(
    collector,
    /outcome\.status === ["']SKIPPED["'][\s\S]*finishJob\([^)]*["']blocked["']/u,
    "skipped paid capture must not create health-critical blocked queue work",
  );
});

test("Hermes Apify fallback only promotes actors after capped known-good canaries", () => {
  assert.match(apifyCandidateBenchmark, /\bif \(!apifyToken\) return \{ status: ["']skipped["'], reason: ["']token_missing["'] \}/u, "benchmark must not run without an Apify token");
  assert.match(apifyCandidateBenchmark, /\bresolveApifyCaptureActor\(settings\)/u, "benchmark should skip when an approved actor already exists");
  assert.match(apifyCandidateBenchmark, /\breadApifyCanaryCaptureInput\(settings\)/u, "benchmark must target a known-good canary page from stored ads");
  assert.match(apifyCanaryInput, /observed_ads\?select=advertiser_page_id,external_ad_id[\s\S]*active_status=eq\.active/u, "canary input should come from ads already observed as active");
  assert.match(apifyActorBenchmark, /\bensureApifyAccountLimit\b/u, "canary benchmark must keep the account-level spend backstop");
  assert.match(apifyActorBenchmark, /\bguardApifyBudget\b/u, "canary benchmark must use the same ledger budget guard as paid fallback");
  assert.match(apifyActorBenchmark, /maxTotalChargedUsd:\s*canaryPerRunCapUsd/u, "canary benchmark must pass the small canary cap to Apify");
  assert.match(apifyActorBenchmark, /\bcostUsdFromApifyError\(error\)/u, "failed canary runs must still ledger any charged run cost");
  assert.match(apifyActorBenchmark, /\bopenApifyCircuitAfterSpendWithoutIngest\b/u, "charged failed canaries must open the paid circuit");
  assert.match(apifyActorBenchmark, /\binferApifySchemaMap\b[\s\S]*\bmapApifyDatasetItems\b/u, "canary benchmark must infer and validate the actor schema map");
  assert.match(apifyActorBenchmark, /\bingestMetaAd\b[\s\S]*\bingested\.length > 0/u, "actor promotion must require at least one ingested ad");
  assert.match(apifyActorBenchmark, /status:\s*passed \? ["']approved["'] : ["']candidate["']/u, "failed canaries must stay candidate, not become selectable");
  assert.match(apifyActorBenchmark, /\bsetRuntimeSetting\(["']apify_actor_id["'], actorId/u, "a passing canary should select the approved actor for future fallback");
});

test("Hermes active ad collector can prefer official paginated Meta page API", () => {
  assert.match(supervisor, /\bMETA_OFFICIAL_SOURCE_PROVIDER\s*=\s*["']official_meta_archive["']/u);
  assert.match(configuredMetaPageCapture, /\bmetaOfficialApiEnabled\b[\s\S]*\brunOfficialMetaPageApiCapture\b/u);
  assert.match(configuredMetaPageCapture, /\brunFallbackMetaPageCapture\b/u, "official API failures must fall back to the existing capture path");
  assert.match(officialMetaPageApiCapture, /\bpaging\?\.\bnext\b/u, "official page capture must follow paginated Ads Archive responses");
  assert.match(officialMetaPageApiCapture, /\bsafeOfficialAdsArchiveNextUrl\b/u, "official pagination URLs must be validated before reuse");
  assert.match(officialMetaPageApiCapture, /\btruncated\b/u, "official capture must surface page-limit truncation");
  assert.match(officialMetaPageApiCapture, /\bofficialMetaStatusPasses\(input\.activeStatus\)/u, "official capture must preserve all/active/inactive collection scope");
  assert.match(officialMetaPageApiCapture, /\bad_active_status:\s*activeStatus\.toLowerCase\(\)/u, "official rows must keep the pass status before ingest normalisation");
  assert.match(officialMetaStatusPasses, /return\s+\[\s*["']ACTIVE["']\s*,\s*["']INACTIVE["']\s*\]/u, "all-mode official capture should collect active and inactive page ads");
  assert.match(officialMetaArchiveUrl, /\bads_archive\b/u);
  assert.match(officialMetaArchiveUrl, /\bsearch_page_ids\b/u, "official capture must target the already verified Meta page id");
  assert.doesNotMatch(officialMetaArchiveUrl, /\bsearch_terms\b/u, "active collection must not become keyword/search-term collection");
  assert.doesNotMatch(officialMetaPageApiCapture, /\baccess_token\b[\s\S]*metadata\b|\bmetadata\b[\s\S]*access_token\b/u, "official token must not be stored in run metadata");
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

test("Hermes source-backed gate does not treat one roster template as national coverage", () => {
  assert.match(
    supervisor,
    /const enabledAgentRosterStates = new Set\(agentSourceDefinitions[\s\S]*type === ["']agent_roster["'][\s\S]*String\(source\.state\)\.toUpperCase\(\)/u,
    "enabled census states must come from explicitly enabled agent roster sources",
  );
  assert.match(
    supervisor,
    /const customTemplateCensusStates = new Set\(sourceTemplates\.length \? configuredTargetStates : \[\]\)/u,
    "custom census URL templates should only cover explicitly configured target states",
  );
  assert.match(
    sourceBackedStateGate,
    /enabledAgentRosterStates\.has\(code\)[\s\S]*customTemplateCensusStates\.has\(code\)/u,
    "source-backed checks must be state-specific before seeding or queueing census work",
  );
  assert.doesNotMatch(
    sourceBackedStateGate,
    /return\s+sourceTemplates\.length\s*>\s*0\s*;?/u,
    "a single configured URL template must not make every Australian state look crawlable",
  );
});

test("Hermes census rehomes legal-entity agent rows to verified trading-name agencies", () => {
  assert.match(
    verifiedSubjectUpsert,
    /findReusableAgentForVerifiedAgency\(agentNorm, agency\.state, verifiedAgencyRow\)[\s\S]*agency_id:\s*agencyId/u,
    "agent upsert should reuse and rehome a same-name legal-entity/null-agent row instead of creating or leaving a split profile",
  );
  assert.match(
    reusableAgentForVerifiedAgency,
    /agents\?select=id,agency_id,agencies[\s\S]*!row\.agency_id \|\| isLegalEntityAliasAgency/u,
    "reusable-agent lookup must consider null-agency and legal-entity agency rows",
  );
  assert.match(
    legalEntityAliasAgency,
    /legal_entity_name[\s\S]*existingName === verifiedLegalName[\s\S]*trading_names/u,
    "legal-entity alias detection must compare DEMIRS legal entity and trading-name metadata",
  );
});

test("Hermes census failures are visible and backed off", () => {
  assert.match(
    deferCensusPolicy,
    /markRefreshed[\s\S]*last_refreshed_at:\s*now\(\)/u,
    "census failures should mark the policy as attempted instead of looking untouched",
  );
  assert.match(
    agentCensus,
    /deferCensusPolicy\([^)]*errors\.length \? 6 : 24,\s*true\)/u,
    "failed census runs should update last_refreshed_at and use a shorter retry when evidence fetches failed",
  );
  assert.match(
    agentCensus,
    /insertCoverageDefect[\s\S]*census could not verify/u,
    "failed census runs should remain operator-visible as coverage defects",
  );
  assert.match(
    agentCensus,
    /census_deferred:\s*true[\s\S]*defect_recorded:\s*true/u,
    "failed census runs should finish the queue item after writing the visible defect",
  );
  assert.doesNotMatch(
    agentCensus,
    /blocked_reason:\s*reason/u,
    "census dead ends should not duplicate the same failure as both a defect and a blocked job",
  );
});

test("Hermes coverage defects upsert by subject and reason instead of flooding rows", () => {
  assert.match(
    insertCoverageDefect,
    /coverageDefectSubject\(row\)[\s\S]*coverageDefectReason\(row\)[\s\S]*occurrences:\s*Math\.max/u,
    "coverage defects need a durable subject/reason key and occurrence count",
  );
  assert.match(
    insertCoverageDefect,
    /rpc\(["']upsert_coverage_defect["'],\s*\{\s*p_defect:\s*defect\s*\}\)/u,
    "Hermes should call the database upsert RPC so duplicates increment atomically",
  );
  assert.doesNotMatch(
    insertCoverageDefect,
    /await rest\(["']research["'],\s*["']coverage_defects["'][\s\S]*body:\s*json\(row\)/u,
    "the primary path must not directly insert the raw row and recreate defect floods",
  );
  assert.match(
    coverageAuditor,
    /insertCoverageGapDefect[\s\S]*reason:\s*["']coverage_audit_gap["']/u,
    "coverage audit gaps should use one stable reason for keyed upserts",
  );
});

test("Hermes auto-resolves matching active coverage defects after later success", () => {
  assert.match(
    resolveCoverageDefects,
    /coverage_defects\?subject_type=eq\.[\s\S]*subject_key=eq\.[\s\S]*status=in\.\(open,investigating,blocked\)/u,
    "auto-resolution must target active defects by the durable subject key",
  );
  for (const source of [agentCensus, pageResolver, locationAdSearch, collector, coverageAuditor]) {
    assert.match(
      source,
      /resolveCoverageDefects\(/u,
      "successful Hermes flows should close their matching open defects",
    );
  }
  assert.match(
    collector,
    /reason:\s*["']ad_collector_capture_failed["'][\s\S]*reason:\s*["']ad_collector_truncated["']/u,
    "collector success should resolve fetch failures and non-truncated runs should resolve prior truncation defects",
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
  assert.match(
    metaHtmlParser,
    /\bmetaSearchHasConfirmedNoAds\s*\(\s*html\s*\)/u,
    "parser should treat Meta's explicit no-ads page state as a confirmed empty result instead of a retryable failure",
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

test("Hermes page resolver records unresolved pages as defects instead of blocked queue work", () => {
  assert.match(
    pageResolver,
    /insertCoverageDefect[\s\S]*page resolver could not find a Facebook page[\s\S]*unresolved_recorded:\s*true[\s\S]*defect_recorded:\s*true/u,
    "resolver no-page outcomes should be visible in defects without permanently blocking the queue",
  );
  assert.doesNotMatch(
    pageResolver,
    /blocked_reason:\s*["']page_resolver_no_verified_meta_page["']/u,
    "no-page resolver outcomes should not duplicate the visible defect as a blocked job",
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
    researchCompose,
    /HERMES_LOCATION_AD_SEARCH_PROVIDER:\s*\$\{HERMES_LOCATION_AD_SEARCH_PROVIDER:-hermes_browser\}/u,
    "location search provider selection must be explicit in the VPS runtime",
  );
  assert.match(
    `${apifyLocationSearchInput}\n${apifyLocationSearchCapture}\n${locationAdSearch}`,
    /startUrls:\s*\[\{\s*url\s*\}\][\s\S]*captureMode:\s*["']location["'][\s\S]*locationAdSearchProvider\s*===\s*["']apify["']/u,
    "approved Apify location search must use the Meta search URL and remain explicitly selected",
  );
  assert.match(
    supervisor,
    /const LOCATION_AD_SEARCH_JOB_TYPE = ["']blockwise-location-ad-search["']/u,
    "location ad search must be an explicit job type",
  );
  assert.match(
    runtimeTypes,
    /researchJobKinds\s*=\s*\[[\s\S]*["']blockwise-location-ad-search["'][\s\S]*\]/u,
    "location search must be part of the shared research job kind contract",
  );
  assert.match(
    runtimeTypes,
    /locationSearchGateSchema[\s\S]*verifiedBySkill:\s*z\.literal\(["']blockwise-location-ad-search["']\)[\s\S]*locationAdSearchPayloadSchema[\s\S]*location_search_allowed:\s*z\.literal\(true\)/u,
    "location search payload validation must preserve the explicit gate",
  );
  assert.match(
    locationAdSearchQueue,
    /\brefresh_policies\b[\s\S]*\bpostcode\b[\s\S]*\bsuburb\b/u,
    "location searches should be queued from the existing postcode refresh policies",
  );
  assert.match(
    `${locationAdSearchPriority}\n${locationAdSearchQueue}`,
    /Math\.max\(4[\s\S]*Math\.min\(5[\s\S]*priority:\s*locationAdSearchPriorityForPolicy\(policy\)/u,
    "location discovery must run ahead of media/classifier enrichment so postcode coverage does not starve",
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
    browserLocationSearchCapture,
    /const countOnly = parsed\.items\.length === 0[\s\S]*Number\(parsed\.connectionCount\) > 0[\s\S]*status:\s*errorMessage \? ["']FAILED["'] : ["']SUCCEEDED["']/u,
    "count-only location search shells should complete instead of retrying a parser failure with no ad rows",
  );
  assert.match(
    locationAdSearch,
    /confirmed_absence:\s*outcome\.metadata\?\.confirmed_absence === true[\s\S]*count_only:\s*outcome\.metadata\?\.count_only === true/u,
    "location search summaries should expose absence and count-only proofs for watchdog health checks",
  );
  assert.match(
    locationAdSearch,
    /\blocationAdMatchForInput\b[\s\S]*\bhasRealEstateAdSignalForLocation\b/u,
    "location search results must be filtered by exact visible location and real-estate signals before ingest",
  );
  assert.match(
    `${locationAdSearchQueue}\n${locationSearchRecycle}\n${locationSearchRecycleGate}`,
    /recycled_after_parser_fix_at[\s\S]*Meta Ad Library page loaded but no ad result payload could be parsed/u,
    "old location-search parser failures should recycle once through the normal active-cap gate",
  );
  assert.match(locationAdSearchQueue, /locationSearchRecycled:\s*recycled/u);
  assert.match(
    locationRealEstateSignal,
    /\bpropertyType\b[\s\S]*\bmarketAction\b/u,
    "location search real-estate filtering should require property-type terms tied to sale/lease/appraisal actions",
  );
  assert.match(
    locationRealEstateSignal,
    /homesite[\s\S]*land release[\s\S]*residential estate/u,
    "location search should keep legitimate residential estate and land-release advertising",
  );
  assert.match(
    locationRealEstateGate,
    /\bhasStrongRealEstateAdSignal\(text\)\s*\|\|\s*hasConservativeRealEstatePageNameSignal\(pageName\)/u,
    "location search should combine strong ad-copy evidence with conservative page-name evidence",
  );
  assert.match(
    locationPageNameSignal,
    /ray white[\s\S]*harcourts[\s\S]*buyers agency[\s\S]*realestate\\.com\\.au/u,
    "location search should keep known real-estate page names without depending on ad-copy jargon",
  );
  assert.doesNotMatch(
    `${locationRealEstateGate}\n${locationRealEstateSignal}\n${locationPageNameSignal}`,
    /\bhasRealEstatePageSignal\b/u,
    "location search must not reuse broad page signals where generic property or for-sale text can admit non-real-estate ads",
  );
  assert.match(
    locationAdSearch,
    /\bupsertExplicitAreaMatchForObservedAd\b|\bexplicitAreaMatch\b/u,
    "location search ingestion must attach explicit public area attribution without schema changes",
  );
});

test("Hermes coverage repair jobs are claimed and handled", () => {
  assert.match(
    supervisor,
    /const COVERAGE_AUDITOR_JOB_TYPE = ["']blockwise-coverage-auditor["']/u,
    "coverage auditor must be a named handled job type",
  );
  assert.match(
    supervisor,
    /const DEFECT_INVESTIGATOR_JOB_TYPE = ["']blockwise-defect-investigator["']/u,
    "defect investigator must be a named handled job type",
  );
  assert.match(
    supervisor,
    /HANDLED_JOB_TYPES\s*=\s*\[[\s\S]*COVERAGE_AUDITOR_JOB_TYPE[\s\S]*DEFECT_INVESTIGATOR_JOB_TYPE[\s\S]*\]/u,
    "coverage jobs must be included in claim filters, otherwise the worker never sees them",
  );
  assert.match(
    handleJob,
    /COVERAGE_AUDITOR_JOB_TYPE[\s\S]*handleCoverageAuditor\(job\)[\s\S]*DEFECT_INVESTIGATOR_JOB_TYPE[\s\S]*handleDefectInvestigator\(job\)/u,
    "coverage jobs must dispatch to concrete handlers instead of unsupported_job_type",
  );
  assert.doesNotMatch(
    `${coverageAuditor}\n${defectInvestigator}`,
    /unsupported_job_type/u,
    "coverage handlers must not self-block as unsupported",
  );
});

test("Hermes ingest events keep full audit-trail columns", () => {
  assert.match(
    recordEvent,
    /const row = \{[\s\S]*payload,\s*\.\.\.extra[\s\S]*\}/u,
    "recordEvent should pass through the full audit trail supplied in the extra payload",
  );
  assert.doesNotMatch(
    recordEvent,
    /delete\s+compatibleRow\.(?:work_queue_id|agent_decision_id|source_document_id|build_run_id|ad_fetch_run_id|payload_hash|diff)/u,
    "recordEvent must not silently strip audit columns after the schema has been repaired",
  );
  assert.doesNotMatch(
    recordEvent,
    /schema cache|PGRST204|42703/u,
    "schema mismatches in ingest_events should fail loudly instead of degrading provenance",
  );
});

test("Hermes runtime setting audit events use a non-null UUID row id", () => {
  assert.match(
    supervisor,
    /function runtimeSettingAuditRowId\(settingKey\)[\s\S]*return `\$\{hex\.slice\(0,\s*8\)\.join\(""\)\}-/u,
    "runtime_settings audit rows need a stable UUID row_id because live ingest_events rejects null row ids",
  );
  assert.match(
    setRuntimeSetting,
    /recordEvent\(["']update["'],\s*["']runtime_settings["'],\s*runtimeSettingAuditRowId\(settingKey\)/u,
    "setRuntimeSetting must not record runtime_settings audit events with row_id null",
  );
});

test("Hermes coverage auditor records gaps and triggers page-first refresh", () => {
  assert.match(
    coverageAuditor,
    /\bcoverage_audits\b[\s\S]*\baudit_method:\s*["']provider_cross_check["']/u,
    "coverage auditor should write a coverage_audits row using the existing schema",
  );
  assert.match(
    coverageAuditor,
    /\binsertCoverageGapDefect\b[\s\S]*\brequestCoverageRefresh\b/u,
    "coverage gaps should become visible defects and queue a refresh",
  );
  assert.match(
    coverageAuditor,
    /\bv_coverage_status\b|\bloadCoverageSnapshot\b/u,
    "coverage audit should use the operator coverage view/snapshot source",
  );
  assert.match(
    coverageRefresh,
    /refresh_policies\?on_conflict=postcode,state[\s\S]*resolution=ignore-duplicates/,
    "coverage repair must create a refresh policy when the postcode is not already seeded",
  );
  assert.match(
    coverageRefresh,
    /job_type:\s*["']blockwise-agent-census["'][\s\S]*location_search_allowed:\s*false[\s\S]*legacy_discovery_allowed:\s*false/u,
    "coverage refresh must stay census-first and must not enable broad location discovery",
  );
});

test("Hermes coverage repair does not queue impossible census work", () => {
  const sourceGateIndex = coverageRefresh.indexOf("if (!sourceBacked) return false");
  const queueIndex = coverageRefresh.indexOf("return enqueueFollowUp");

  assert.match(
    coverageRefresh,
    /const sourceBacked = hasCensusSourceForPolicy\(\{ postcode, state \}\)/u,
    "coverage repair must check whether the target state has an enabled census source",
  );
  assert.ok(
    sourceGateIndex >= 0 && queueIndex > sourceGateIndex,
    "coverage repair must stop before queueing a census job when no source is enabled",
  );
  assert.match(
    defectInvestigator,
    /outcome:\s*refreshQueued \? ["']refresh_queued["'] : ["']missing_census_source["']/u,
    "defect investigations should distinguish queued refreshes from missing source setup",
  );
});

test("Hermes defect investigator resolves restored coverage or queues refresh", () => {
  assert.match(
    defectInvestigator,
    /\bcoverage_defects\?select=\*&id=eq\./u,
    "defect investigator should load the defect by id",
  );
  assert.match(
    defectInvestigator,
    /status:\s*["']resolved["'][\s\S]*coverage_restored/u,
    "defect investigator should auto-resolve defects when ads are visible again",
  );
  assert.match(
    defectInvestigator,
    /\brequestCoverageRefresh\b[\s\S]*status:\s*["']investigating["']/u,
    "unresolved defects should stay visible and trigger a refresh",
  );
});

test("Hermes stale verified agencies are rechecked by postcode census", () => {
  assert.match(
    supervisor,
    /runHourlyWatchdogs[\s\S]*watchdogRecheckStaleAgencies/u,
    "stale agency rechecks should run from the watchdog phase without firing every tick",
  );
  assert.match(
    staleAgencyWatchdog,
    /agencies\?select=id,primary_postcode,state,last_seen_at[\s\S]*is_real_estate=eq\.true[\s\S]*last_seen_at=lt\./u,
    "watchdog should find old verified agencies from the existing agency table",
  );
  assert.match(
    staleAgencyWatchdog,
    /hasCensusSourceForPolicy/u,
    "watchdog must skip states that do not have an enabled evidence-backed census source",
  );
  assert.match(
    staleAgencyWatchdog,
    /job_type:\s*["']blockwise-agent-census["'][\s\S]*trigger:\s*["']stale_agency_recheck["']/u,
    "stale agencies should requeue the postcode census stage",
  );
  assert.match(
    staleAgencyWatchdog,
    /location_search_allowed:\s*false[\s\S]*legacy_discovery_allowed:\s*false/u,
    "stale-agency rechecks must stay verified-roster-first",
  );
});

test("Hermes unresolved verified pages are retried with evidence-backed resolver handoff", () => {
  assert.match(
    supervisor,
    /runHourlyWatchdogs[\s\S]*watchdogRequeueUnresolvedPages/u,
    "unresolved page retries should run from the bounded hourly watchdog phase",
  );
  assert.match(
    unresolvedPageWatchdog,
    /advertiser_pages\?select=id,agent_id,agency_id,page_url,resolution_decision_id,last_seen_at[\s\S]*status=eq\.verified_real_estate_unresolved[\s\S]*last_seen_at=lt\./u,
    "watchdog should find stale verified-but-unresolved advertiser pages",
  );
  assert.match(
    unresolvedPageWatchdog,
    /agent_decisions\?select=id,source_document_ids,decision,evidence[\s\S]*sourceDocumentIds/,
    "watchdog must recover source document ids from the prior resolver decision",
  );
  assert.match(
    unresolvedPageWatchdog,
    /job_type:\s*["']blockwise-page-resolver["'][\s\S]*forceRevisit:\s*true/u,
    "unresolved pages should requeue the resolver with a forced revisit",
  );
  assert.match(
    unresolvedPageWatchdog,
    /location_search_allowed:\s*false/u,
    "unresolved page retry must not enable broad location discovery",
  );
});

test("Hermes archives stale blocked queue jobs so public health can recover", () => {
  assert.match(
    supervisor,
    /watchdogArchiveStaleBlockedJobs/u,
    "stale blocked jobs should run from the watchdog phase",
  );
  assert.match(
    staleBlockedArchiveWatchdog,
    /7 \* 24 \* 60 \* 60 \* 1000/u,
    "blocked jobs should only be archived after seven days",
  );
  assert.match(
    staleBlockedArchiveWatchdog,
    /work_queue\?select=id,job_type,blocked_reason,last_error,result,updated_at[\s\S]*status=eq\.blocked[\s\S]*updated_at=lt\./u,
    "watchdog should find old blocked work_queue rows",
  );
  assert.match(
    staleBlockedArchiveWatchdog,
    /status:\s*["']archived["'][\s\S]*blocked_older_than_7_days/u,
    "watchdog should archive old blocked rows with an audit reason",
  );
  assert.match(
    staleBlockedArchiveWatchdog,
    /recordEvent\(["']archive["'],\s*["']work_queue["']/u,
    "archivals should be audited",
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

test("Hermes classification backfill cannot starve older unclassified creatives", () => {
  const backfillSource = `${classificationBackfill}\n${classificationBackfillCandidates}`;
  assert.doesNotMatch(
    backfillSource,
    /order=updated_at\.desc&limit=\$\{classificationBackfillBatchSize\}/u,
    "classification backfill must not only scan the newest creatives before filtering",
  );
  assert.match(
    backfillSource,
    /classified_at\.is\.null[\s\S]*classification_status\.in\.\(unclassified,failed\)/u,
    "missing or failed classifications should be the first backfill source",
  );
  assert.match(
    backfillSource,
    /order=updated_at\.asc\.nullsfirst/u,
    "classification backfill should walk old work forward instead of recirculating fresh rows",
  );
  assert.match(
    supervisor,
    /HERMES_CLASSIFICATION_WEAK_BACKFILL_BATCH_SIZE/u,
    "weak other classifications should have their own small queue budget",
  );
  assert.match(
    backfillSource,
    /ad_type\.eq\.other,primary_intent\.eq\.other[\s\S]*classificationBackfillWeakBatchSize/u,
    "weak other classifications should not consume the full missing-classification budget",
  );
  assert.match(
    backfillSource,
    /shouldReclassifyCreative\(row\)/u,
    "the backfill scheduler should still use the classifier predicate before enqueueing",
  );
});

test("Hermes compose exposes supervisor scheduler tuning knobs", () => {
  const schedulerEnvKeys = [
    "HERMES_AD_PAGE_REFRESH_INTERVAL_MINUTES",
    "HERMES_AD_PAGE_REFRESH_BATCH_SIZE",
    "HERMES_AD_PAGE_REFRESH_MAX_ACTIVE",
    "HERMES_LOCATION_AD_SEARCH_INTERVAL_MINUTES",
    "HERMES_LOCATION_AD_SEARCH_BATCH_SIZE",
    "HERMES_LOCATION_AD_SEARCH_MAX_ACTIVE",
    "HERMES_CLASSIFICATION_BACKFILL_BATCH_SIZE",
    "HERMES_CLASSIFICATION_WEAK_BACKFILL_BATCH_SIZE",
  ];

  for (const key of schedulerEnvKeys) {
    assert.match(supervisor, new RegExp(`"${key}"`, "u"), `supervisor should read ${key}`);
    assert.match(
      researchCompose,
      new RegExp(`\\b${key}:\\s*\\$\\{${key}:-\\d+\\}`, "u"),
      `production compose should expose ${key}`,
    );
  }
});

test("Hermes classifier treats stale creative jobs as no-op completions", () => {
  assert.match(
    adClassifier,
    /if \(!creative\) return \{ status: ["']complete["'][\s\S]*stale_creative_skipped/u,
    "classifier jobs for deleted creatives should not stay blocked forever",
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

test("Hermes browser capture scrolls Meta results before accepting a batch", () => {
  assert.match(
    captureDomOverCdp,
    /\bscrollMetaAdLibraryResults\s*\(\s*cdp,\s*sessionId\s*\)/u,
    "CDP capture should scroll Meta Ad Library results so collection is not capped at the first rendered batch",
  );
  assert.match(
    captureDomOverCdp,
    /\bstableAdPayloadPolls\b[\s\S]*\bmetaSearchAdPayloadCount\b/u,
    "CDP capture should wait for actual parsed ad payloads to stabilize after scrolling",
  );
  assert.match(
    metaSearchAdPayloadCount,
    /\bnormaliseHostedMetaItems\b/u,
    "positive browser batches must be based on ingestable ad payloads, not only Meta's headline count",
  );
  assert.match(
    scrollMetaAdLibraryResults,
    /querySelectorAll\(["']div["']\)[\s\S]*scrollTo\s*\(\s*0\s*,\s*element\.scrollHeight\s*\)/u,
    "scroll helper should move nested result containers to the bottom to trigger lazy-loaded ad results",
  );
  assert.match(
    scrollMetaAdLibraryResults,
    /\bInput\.dispatchMouseEvent\b[\s\S]*mouseWheel/u,
    "scroll helper should send a CDP wheel event because Meta often lazy-loads from wheel input rather than programmatic page scroll only",
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
    resolveRemoteBrowserWebSocket,
    /\bremoteBrowserProbeCdpUrl\b/u,
    "remote browser probes should use the Steel-compatible probe URL helper",
  );
  assert.match(
    remoteBrowserProbeCdpUrl,
    /\blookup\s*\(\s*parsed\.hostname\s*\)/u,
    "Steel rejects Docker service-name hosts, so probes should resolve the service name to a container IP",
  );
  assert.match(
    rewriteRemoteBrowserWebSocketHost,
    /\bhostname\s*=\s*configured\.hostname\b[\s\S]*\bport\s*=\s*configured\.port\b/u,
    "reported localhost WebSocket URLs should be rewritten to the configured remote host",
  );
});

test("Hermes compose starts Steel CDP with stable browser settings", () => {
  assert.match(
    researchCompose,
    /\bsteel:\s*[\s\S]*\bSKIP_FINGERPRINT_INJECTION:\s*\$\{STEEL_SKIP_FINGERPRINT_INJECTION:-true\}/u,
    "Steel should default fingerprint injection off because the pinned image fails launch when fingerprint generation is inconsistent",
  );
  assert.match(
    researchCompose,
    /\bhermes:\s*[\s\S]*\bdepends_on:\s*[\s\S]*-\s*steel/u,
    "starting Hermes should also start the Steel CDP sidecar",
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
  assert.match(
    collector,
    /\benqueuePostIngestJobs\s*\(\s*item,\s*payload\.advertiserPageId,\s*buildRunId,\s*job\s*\)/u,
    "collector must run post-ingest follow-up enqueueing after each ad ingest",
  );
  for (const jobType of [
    "blockwise-media-collector",
    "blockwise-ad-classifier",
  ]) {
    assert.match(
      postIngestJobs,
      new RegExp(`enqueueFollowUp[\\s\\S]*job_type:\\s*["']${escapeRegExp(jobType)}["']`, "i"),
      `post-ingest helper must enqueue ${jobType} follow-up work after ingest`,
    );
  }
});

test("Hermes active ad collector ledgers paid capture cost before ingest can fail", () => {
  assert.match(
    collector,
    /if \(isApifySourceProvider\(sourceProvider\)\)[\s\S]*status:\s*["']partial["'][\s\S]*ingest_pending:\s*true[\s\S]*cost_usd:\s*outcome\.costUsd \|\| 0/u,
    "paid capture cost must be written before ingesting ads",
  );
  assert.match(
    collector,
    /catch \(error\)[\s\S]*ingest failed after capture[\s\S]*cost_usd:\s*outcome\.costUsd \|\| 0[\s\S]*openCircuitIfPaidSpendWithoutIngest/u,
    "ingest failures after paid capture must retain cost and open circuit when no ads were ingested",
  );
  assert.match(
    collector,
    /updateFetchRun\(adFetchRunId,[\s\S]*status:\s*["']success["'][\s\S]*openCircuitIfPaidSpendWithoutIngest/u,
    "paid successful captures with zero ingested ads must still open the paid circuit",
  );
});

test("Hermes active ad collector reconciles disappeared ads after successful captures", () => {
  assert.match(
    collector,
    /reconcileMissingObservedAds[\s\S]*seenExternalAdIds:\s*ingested\.map\(\(item\)\s*=>\s*item\.external_ad_id\)/u,
    "collector should compare successful capture results against previously active ads",
  );
  assert.match(
    collector,
    /confirmed_absence[\s\S]*zeroCaptureTrusted[\s\S]*reconcileMissingObservedAds[\s\S]*seenExternalAdIds:\s*\[\]/u,
    "trusted confirmed empty captures should still advance the two-miss inactive confirmation rule",
  );
  assert.match(
    collector,
    /confirmed_absence[\s\S]*isTrustedConfirmedZeroAdCapture[\s\S]*confirmed_absence_ignored[\s\S]*ad_collector_untrusted_zero_after_positive/u,
    "untrusted fallback zero captures after prior evidence must be quarantined instead of reconciling ads",
  );
  assert.match(
    trustedZeroAdCapture,
    /sourceProvider === META_OFFICIAL_SOURCE_PROVIDER[\s\S]*observed_ads\?select=id[\s\S]*advertiser_page_id=eq\.\$\{encode\(advertiserPageId\)\}[\s\S]*return rows\.length === 0/u,
    "only the official API, or a page with no prior observed ads, can prove zero ads",
  );
  assert.match(
    missingAdReconciliation,
    /observed_ads\?select=id,external_ad_id,missing_successive_checks,ad_delivery_stopped_at[\s\S]*active_status=eq\.active/u,
    "reconciliation must inspect active observed ads for the captured page",
  );
  assert.match(
    missingAdReconciliation,
    /missing_successive_checks:\s*missingSuccessiveChecks[\s\S]*active_status:\s*["']inactive["'][\s\S]*ad_delivery_stopped_at/u,
    "missing ads must increment the confirmation counter and become inactive after the second miss",
  );
  assert.doesNotMatch(
    collector.slice(collector.indexOf("if (outcome.status !== \"SUCCEEDED\")"), collector.indexOf("const checkedAt = now()")),
    /reconcileMissingObservedAds/u,
    "provider failures must not count as missing ads",
  );
});

test("Hermes runtime ingest keeps active ad stop dates null", () => {
  assert.match(
    activeStatusForMetaAd,
    /isActive === true[\s\S]*return "active"[\s\S]*isActive === false[\s\S]*return "inactive"[\s\S]*return "unknown"/u,
    "runtime ingest must derive the same active/inactive/unknown states as the shared normaliser",
  );
  assert.match(
    deliveryStoppedAtForMetaAd,
    /activeStatus === "active"\) return null/u,
    "runtime ingest must not persist provider stop timestamps for active ads",
  );
  assert.match(
    ingestMetaAd,
    /const activeStatus = activeStatusForMetaAd\(ad\)[\s\S]*active_status:\s*activeStatus[\s\S]*ad_delivery_stopped_at:\s*deliveryStoppedAtForMetaAd\(ad, activeStatus\)/u,
    "observed_ads writes must use the active-status-aware stop-date helper",
  );
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

test("Hermes media collector refreshes dead CDN URLs from saved ad payloads", () => {
  assert.match(
    mediaCollector,
    /isDeadMediaSourceError[\s\S]*freshMediaUrlForAsset[\s\S]*source_url:\s*freshUrl[\s\S]*capture_status:\s*["']pending["']/u,
    "dead provider media URLs should be replaced from saved payload evidence and retried later",
  );
  assert.match(
    mediaCollector,
    /\brefreshed\b[\s\S]*handler:\s*["']blockwise-media-collector["']/u,
    "media collector result should expose refreshed URL counts separately from failures",
  );
  assert.match(
    freshMediaUrlForAsset,
    /ad_creatives\?select=observed_ad_id[\s\S]*observed_ads\?select=raw_payload[\s\S]*normaliseHostedMetaAd[\s\S]*creativeFromMetaAd/u,
    "fresh URL lookup must derive candidates from stored observed ad payloads using the normal Meta normaliser",
  );
});

test("Hermes media collector globally dedupes stored media by content hash", () => {
  const mediaSource = `${mediaCollector}\n${captureMediaAsset}\n${findCapturedMediaAssetByStorage}\n${findMediaBlob}\n${insertMediaBlob}`;
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
  assert.match(
    mediaSource,
    /\bfindCapturedMediaAssetByStorage\b[\s\S]*storage_bucket=eq\.\$\{encode\(mediaBucket\)\}[\s\S]*storage_path=eq\.\$\{encode\(storagePath\)\}/u,
    "media collector must check whether this creative already has a captured row for the stored blob",
  );
  assert.match(
    mediaSource,
    /capture_status:\s*["']blocked["'][\s\S]*deduped_to_media_asset_id/u,
    "duplicate stored blobs should be folded into the existing captured media row instead of creating another captured row",
  );
});

test("Hermes blocks thumbnail-sized images before storage and records their dimensions", () => {
  assert.match(
    supervisor,
    /assessCapturedImageQuality[\s\S]*readImageDimensions/u,
    "the media collector must use the shared image-quality contract",
  );
  assert.match(
    captureMediaAsset,
    /readImageDimensions\(buffer[\s\S]*assessCapturedImageQuality[\s\S]*rejected:\s*true/u,
    "image bytes must be dimension-checked before they can become captured media",
  );
  assert.match(
    mediaCollector,
    /stored\.rejected[\s\S]*capture_status:\s*["']blocked["'][\s\S]*width:\s*stored\.width[\s\S]*height:\s*stored\.height/u,
    "quality-rejected images must become blocked rows with diagnostic dimensions",
  );
});

test("Hermes media asset seeding tolerates source-url unique races", () => {
  const mediaSource = `${upsertMediaAssets}\n${functionBody(supervisor, "isMediaAssetUniqueConflict")}`;
  assert.match(
    mediaSource,
    /isMediaAssetUniqueConflict\(error\)[\s\S]*media_assets\?select=id&ad_creative_id=eq\.\$\{creativeId\}&source_url=eq/u,
    "source-url insert races should re-read the canonical media row instead of failing the collector",
  );
  assert.match(
    mediaSource,
    /duplicate key value\|media_assets_creative_/u,
    "source-url race handling should be scoped to media asset uniqueness errors",
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
