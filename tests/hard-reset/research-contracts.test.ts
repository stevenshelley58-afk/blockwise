import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

const paths = {
  adSchema: "src/lib/research/schemas/ads.ts",
  adRadarLocation: "src/lib/research/ad-radar-location.ts",
  classifierSkill: "hermes/skills/blockwise-ad-classifier/SKILL.md",
  commonSchema: "src/lib/research/schemas/common.ts",
  entitiesSchema: "src/lib/research/schemas/entities.ts",
  hardResetMigration: "supabase/migrations/202605300003_blockwise_hard_reset_clean_schema.sql",
  jsonRules: "src/lib/adstudio/prompts/shared/json_rules.md",
  metaCapture: "hermes/tools/meta-library-capture/src/capture.ts",
  metaCard: "src/components/research/meta-ad-library-card.tsx",
  censusSources: "src/lib/research/census-sources.ts",
  coverageSchema: "src/lib/research/schemas/coverage.ts",
  defectInvestigateRoute: "src/app/api/operator/research/defects/[id]/investigate/route.ts",
  operatorResearchConsole: "src/components/operator/research-console.tsx",
  operatorResearchPage: "src/app/(operator)/operator/research/page.tsx",
  policiesRoute: "src/app/api/operator/research/policies/route.ts",
  researchPage: "src/app/(customer)/ad-radar/page.tsx",
  refreshNowRoute: "src/app/api/operator/research/refresh-now/route.ts",
};

const surfacingViews = [
  "v_customer_meta_ad_library_cards",
  "v_active_ads_by_postcode",
  "v_competitors_by_postcode",
];

const safeCustomerForbiddenColumns = [
  "observed_ad_id",
  "advertiser_page_id",
  "agent_id",
  "agency_id",
  "ad_creative_id",
  "classification",
  "raw_payload",
  "payload_hash",
  "source_provider",
  "source_document_id",
  "ad_snapshot_id",
];

test("real-estate gate is durable in schema, runtime types, and every ad-surfacing view", () => {
  const gateSql = read(paths.hardResetMigration);
  const entitiesSchema = read(paths.entitiesSchema);

  assert.match(
    gateSql,
    /is_real_estate\s+boolean\s+not\s+null\s+default\s+false/i,
  );
  assert.match(gateSql, /create\s+or\s+replace\s+function\s+research\.page_is_verified_real_estate/i);
  assert.match(entitiesSchema, /\bisRealEstate\b/, "agencySchema must expose the is_real_estate gate as isRealEstate");

  for (const view of surfacingViews) {
    assert.match(
      latestViewDefinition(view),
      /research\.page_is_verified_real_estate\s*\(\s*ap\.id\s*\)|from\s+research\.v_customer_meta_ad_library_cards/i,
      `${view} must apply research.page_is_verified_real_estate(ap.id) or derive from the safe customer view`,
    );
  }
});

test("customer research view exposes only the safe public card contract", () => {
  const customerCardView = latestViewDefinition("v_customer_meta_ad_library_cards");
  const selectList = customerCardView.split(/\bfrom\b/i)[0] ?? customerCardView;
  const exposed = safeCustomerForbiddenColumns.filter((column) =>
    new RegExp(`\\bas\\s+${column}\\b|^\\s*${column}\\b`, "im").test(selectList),
  );

  assert.deepEqual(
    exposed,
    [],
    `customer research view must not expose internal columns: ${exposed.join(", ")}`,
  );
});

test("customer research view shows saved scraped ad history for verified pages", () => {
  const customerCardView = latestViewDefinition("v_customer_meta_ad_library_cards");

  assert.match(
    customerCardView,
    /ap\.status\s+in\s*\(\s*'resolved_collectable'\s*,\s*'no_ads_confirmed'\s*\)/i,
    "saved ads on verified pages must remain visible after a later no-ads refresh",
  );
  assert.doesNotMatch(
    customerCardView,
    /where\s+oa\.active_status\s*=\s*'active'/i,
    "public radar should use the active_status field instead of hiding inactive scraped ads",
  );
});

test("customer research UI does not render internal ad-library identifiers or raw contract fields", () => {
  const page = `${read(paths.researchPage)}\n${read(paths.metaCard)}`;
  const renderedInternals = [
    /Ad\s*\{\s*row\.external_ad_id\s*\}/,
    /\bexternal_ad_id\b[\s\S]*?<span/,
    /\bobserved_ad_id\b[\s\S]*?<span/,
    /\bsource_provider\b/,
    /\braw_payload\b/,
    /\bpayload_hash\b/,
    /\bad_snapshot_id\b/,
  ].filter((pattern) => pattern.test(page));

  assert.deepEqual(
    renderedInternals.map(String),
    [],
    "customer-facing Meta ad cards must hide provider/internal ids and raw fields",
  );
});

test("customer research page ranks specific location searches before direct text fallback", () => {
  const researchPage = read(paths.researchPage);
  const locationPriorityIndex = researchPage.indexOf("shouldPrioritiseAdRadarLocationSearch(searchTerm, locationGuess)");
  const directMatchIndex = researchPage.indexOf("const directMatches = allCards.filter");

  assert.ok(locationPriorityIndex >= 0, "specific postcode/suburb searches must use the location-ranked path");
  assert.ok(directMatchIndex >= 0, "research page should still keep a direct text fallback");
  assert.ok(locationPriorityIndex < directMatchIndex, "location-ranked results must be attempted before broad text matches");
});

test("legacy worker runtime is archived only and active collectors are page-first", () => {
  const sourceSchema = stripComments(read(paths.commonSchema));
  const capture = `${stripComments(read(paths.metaCapture))}\n${stripComments(read("hermes/tools/meta-library-capture/src/types.ts"))}`;
  const forbidden = [
    "apify",
    "apify_discovery",
    "ad_first",
    "ad-first",
    "location_dump",
    "location-based",
    "meta_ad_library_ui",
  ];
  const present = forbidden.filter((token) => sourceSchema.toLowerCase().includes(token));

  assert.deepEqual(
    present,
    [],
    `sourceProviderSchema must not include ad-first/location dump sources: ${present.join(", ")}`,
  );
  assert.equal(existsSync(join(root, "workers", "research-orchestrator")), false);
  assert.equal(existsSync(join(root, "workers", "meta-ad-library-collector")), false);
  assert.match(capture, /metaPageId|advertiserPageId/, "collector must run against resolved advertiser pages");
  assert.doesNotMatch(capture, /searchQuery|radius|geo/i, "capture must not be search-query/location-first");
});

test("work queue claiming is atomic and has no legacy orchestrator fallback path", () => {
  const claimSql =
    latestFunctionDefinition("claim_work_queue_jobs") ??
    "";

  assert.ok(claimSql, "research.claim_work_queue_jobs must be defined in migrations");
  assert.match(claimSql, /for\s+update\s+skip\s+locked/i, "queue claim RPC must use FOR UPDATE SKIP LOCKED");
  assert.match(claimSql, /update\s+research\.work_queue/i, "claim RPC must mark claimed jobs in the same transaction");
  assert.doesNotMatch(read(paths.hardResetMigration), /orchestrator_list_due_pages/i, "legacy orchestrator claim RPC must not be recreated in the hard reset migration");
});

test("operator postcode refresh creates a due policy and one-off census job", () => {
  const route = read(paths.refreshNowRoute);
  const censusSources = read(paths.censusSources);

  assert.match(
    route,
    /resolveAdRadarLocationSearch/,
    "postcode refresh must infer state from the national postcode index instead of assuming one market",
  );
  assert.match(
    route,
    /refresh_policies[\s\S]*upsert[\s\S]*onConflict:\s*["']postcode,state["']/,
    "refresh-now must create a refresh policy when the postcode was not pre-seeded",
  );
  assert.match(
    route,
    /hasEnabledCensusSourceForState\(state\)/,
    "refresh-now must not manually queue census work for states without an enabled source",
  );
  assert.match(
    censusSources,
    /type !== ["']agent_roster["'][\s\S]*typeof source\.state !== ["']string["'][\s\S]*source\.state\.trim\(\)\.toUpperCase\(\)/,
    "operator source checks must use enabled agent roster source states, not assume national coverage",
  );
  assert.match(
    route,
    /sourceBacked[\s\S]*queuePostcodeCensusRefresh\(research, postcode, state\)[\s\S]*recordUnsupportedPostcodeRefresh\(research, postcode, state, guard\.email\)/,
    "source-backed manual refreshes must queue census work, while unsupported states become visible defects",
  );
  assert.match(
    route,
    /const dedupeKey = `census:\$\{state\}:\$\{postcode\}`[\s\S]*work_queue[\s\S]*job_type:\s*["']blockwise-agent-census["'][\s\S]*dedupe_key:\s*dedupeKey/,
    "source-backed refresh-now must queue a direct census job so manual runs still work while scheduled policies are paused or missing",
  );
  assert.match(
    route,
    /select\(["']id,status,claim_expires_at["']\)[\s\S]*\.in\(["']status["'],\s*\[\s*["']pending["'],\s*["']claimed["'],\s*["']failed["'],\s*["']blocked["']\s*\]\)/,
    "refresh-now must inspect active or stuck census dedupe keys before inserting",
  );
  assert.match(
    route,
    /status:\s*["']pending["'][\s\S]*attempts:\s*0[\s\S]*last_error:\s*null[\s\S]*blocked_reason:\s*null/,
    "refresh-now must recycle failed, blocked, or stale-claimed census jobs instead of treating duplicates as success",
  );
  assert.match(
    route,
    /location_search_allowed:\s*false[\s\S]*legacy_discovery_allowed:\s*false/,
    "manual postcode refresh must remain verified-roster-first, not broad location scraping",
  );
  assert.match(
    route,
    /coverage_defects[\s\S]*reason:\s*["']missing_census_source["'][\s\S]*location_search_allowed:\s*false/,
    "unsupported manual refreshes must file a visible coverage defect instead of silently doing nothing",
  );
});

test("operator refresh policy validation matches the held national rollout priority range", () => {
  const nationalRollout = read("ops/national-rollout/202606020001_seed_national_postcodes.sql");
  const route = read(paths.policiesRoute);
  const coverageSchema = read(paths.coverageSchema);

  assert.match(
    nationalRollout,
    /refresh_policies_priority_check check \(priority between 1 and 6\)/,
    "national rollout widens refresh policy priority for lower-priority states",
  );
  assert.match(
    route,
    /priority:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(6\)/,
    "operator policy API must accept every priority used by the held national rollout",
  );
  assert.match(
    coverageSchema,
    /priority:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(6\)\.default\(3\)/,
    "refresh policy schema must parse every priority used by the held national rollout",
  );
});

test("coverage defect schema accepts blocked defects surfaced by repair automation", () => {
  const coverageSchema = read(paths.coverageSchema);
  const hardResetMigration = read(paths.hardResetMigration);

  assert.match(
    hardResetMigration,
    /coverage_defects[\s\S]*status in \('open', 'investigating', 'resolved', 'dismissed', 'blocked'\)/,
    "hard-reset schema treats blocked coverage defects as visible operator work",
  );
  assert.match(
    coverageSchema,
    /defectStatusSchema = z\.enum\(\[\s*["']open["'],\s*["']investigating["'],\s*["']resolved["'],\s*["']dismissed["'],\s*["']blocked["']\s*\]\)/,
    "TypeScript schema must parse blocked coverage defects emitted by Hermes/operator repair paths",
  );
});

test("operator defect investigation recycles stuck investigation jobs", () => {
  const route = read(paths.defectInvestigateRoute);

  assert.match(
    route,
    /const dedupeKey = `defect-investigate:\$\{defectId\}`[\s\S]*job_type:\s*["']blockwise-defect-investigator["'][\s\S]*dedupe_key:\s*dedupeKey/,
    "defect investigation must use one stable dedupe key per coverage defect",
  );
  assert.match(
    route,
    /select\(["']id,status,claim_expires_at["']\)[\s\S]*\.in\(["']status["'],\s*\[\s*["']pending["'],\s*["']claimed["'],\s*["']failed["'],\s*["']blocked["']\s*\]\)/,
    "defect investigation must inspect active or stuck dedupe keys before inserting",
  );
  assert.match(
    route,
    /status:\s*["']pending["'][\s\S]*attempts:\s*0[\s\S]*last_error:\s*null[\s\S]*blocked_reason:\s*null/,
    "defect investigation must recycle failed, blocked, or stale-claimed jobs",
  );
  assert.match(
    route,
    /return NextResponse\.json\(\{ ok: true, defect: id, alreadyQueued \}\)/,
    "defect investigation should preserve the existing response shape",
  );
});

test("operator research console uses exact backlog counts instead of the display sample", () => {
  const page = read(paths.operatorResearchPage);

  assert.match(page, /\.from\(["']v_coverage_status["']\)[\s\S]*\.limit\(5000\)/);
  assert.doesNotMatch(page, /\.from\(["']v_coverage_status["']\)[\s\S]*\.limit\(60\)/);
  assert.match(page, /loadQueueStats/);
  assert.match(page, /loadPipelineStats/);
  assert.match(page, /loadDefectStats/);
  assert.match(page, /select\(["']id["'],\s*\{\s*count:\s*["']exact["'],\s*head:\s*true\s*\}\)/);
  assert.match(page, /select\(["']card_id["'],\s*\{\s*count:\s*["']exact["'],\s*head:\s*true\s*\}\)/);
  assert.match(
    page,
    /row\.live_advertiser_pages\s*\?\?\s*row\.listings\s*\?\?\s*0/,
    "operator coverage must use the coverage view listings fallback when live_advertiser_pages is absent",
  );
  assert.doesNotMatch(
    page,
    /const\s+runningJobs\s*=\s*workQueue\.filter/,
    "summary counts must not be derived from the limited diagnostics table sample",
  );
});

test("operator research console exposes official Meta API readiness without secrets", () => {
  const page = read(paths.operatorResearchPage);
  const consoleSource = read(paths.operatorResearchConsole);

  assert.match(page, /META_AD_LIBRARY_ACCESS_TOKEN/);
  assert.match(page, /META_AD_LIBRARY_TOKEN/);
  assert.match(page, /loadOfficialMetaApiStatus/);
  assert.match(consoleSource, /official api/);
  assert.match(consoleSource, /Missing token/);
  assert.match(consoleSource, /required for paginated exhaustive collection/);
  assert.doesNotMatch(
    consoleSource,
    /process\.env\.META_AD_LIBRARY|accessToken/,
    "client console must receive readiness only, not token values",
  );
});

test("app-side research data loaders use statically scoped bundled data files", () => {
  const adRadarLocation = read(paths.adRadarLocation);
  const censusSources = read(paths.censusSources);

  assert.match(adRadarLocation, /createRequire\(import\.meta\.url\)/);
  assert.match(adRadarLocation, /requireJson\(["']\.\.\/\.\.\/\.\.\/hermes\/data\/au-postcodes\.json["']\)/);
  assert.doesNotMatch(
    adRadarLocation,
    /join\(process\.cwd\(\),\s*["']hermes["']/,
    "postcode lookup must not make Vercel trace the whole project from process.cwd()",
  );
  assert.match(censusSources, /createRequire\(import\.meta\.url\)/);
  assert.match(censusSources, /requireJson\(["']\.\.\/\.\.\/\.\.\/hermes\/data\/agent-sources\.json["']\)/);
  assert.doesNotMatch(
    censusSources,
    /join\(process\.cwd\(\),\s*["']hermes["']/,
    "operator census source lookup must not make Vercel trace the whole project from process.cwd()",
  );
});

test("media asset contract is strict, durable, and surfaced to the research card", () => {
  const mediaSql = read(paths.hardResetMigration);
  const gateSql = read(paths.hardResetMigration);
  const adSchema = read(paths.adSchema);
  const activeAdsView = latestViewDefinition("v_customer_meta_ad_library_cards");
  const researchPage = read(paths.researchPage);

  for (const column of ["image_storage_path", "video_storage_path", "media_assets"]) {
    assert.match(mediaSql, new RegExp(`\\b${column}\\b`, "i"));
    assert.match(activeAdsView, new RegExp(`\\bac\\.${column}\\b|media\\.${column}\\b|\\bas\\s+${column}\\b`, "i"), `${column} must be exposed to the card view`);
    assert.match(gateSql, new RegExp(`\\bac\\.${column}\\b`, "i"), `${column} must survive the gated view rebuild`);
  }

  assert.match(mediaSql, /media_assets\s+jsonb\s+not\s+null\s+default\s+'?\[\]'?::jsonb/i);
  assert.match(adSchema, /\bmediaAssetSchema\b/, "adCreativeSchema must use a named strict media asset schema");
  assert.doesNotMatch(adSchema, /mediaAssets:\s*z\.array\(\s*jsonbSchema\s*\)/, "mediaAssets must not be an untyped jsonb array");
  assert.match(researchPage, /v_customer_meta_ad_library_cards/, "customer page must read the safe card view");
  assert.match(read("src/lib/research/customer-meta-card.ts"), /storagePath[\s\S]*sourceUrl|storagePath[\s\S]*url/, "card media resolver must prefer stored media before provider URLs");
});

test("ad classifier contract requires strict JSON and a schema-aligned output", () => {
  const classifierSkill = read(paths.classifierSkill);
  const jsonRules = read(paths.jsonRules);
  const adSchema = read(paths.adSchema);

  assert.match(jsonRules, /Return only JSON matching the supplied schema/i);
  assert.match(jsonRules, /repair_once_then_fail/i);
  assert.match(
    classifierSkill,
    /shared\.json_rules|Return only JSON matching the supplied schema|repair_once_then_fail/i,
    "classifier skill must explicitly inherit the strict JSON rules",
  );
  assert.doesNotMatch(classifierSkill, /```jsonc/i, "classifier examples must be strict JSON, not JSONC");
  assert.match(adSchema, /adClassificationSchema[\s\S]*\.strict\(\)/, "classification schema must reject unknown provider fields");
  assert.doesNotMatch(classifierSkill, /\btarget_signal\b/, "classifier output keys must match targetSignal in adClassificationSchema");
});

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function allMigrationSql(): string {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => `\n-- ${file}\n${readFileSync(join(migrationsDir, file), "utf8")}`)
    .join("\n");
}

function latestViewDefinition(viewName: string): string {
  const sql = allMigrationSql();
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+view\\s+research\\.${viewName}\\s+as\\s+[\\s\\S]*?;`,
    "gi",
  );
  const matches = [...sql.matchAll(pattern)].map((match) => match[0]);
  assert.ok(matches.length > 0, `Expected a research.${viewName} view definition`);
  return matches.at(-1)!;
}

function latestFunctionDefinition(functionName: string): string | null {
  const sql = allMigrationSql();
  const pattern = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+research\\.${functionName}\\s*\\([\\s\\S]*?(?=\\n\\s*(?:create|alter|grant|comment|--|$))`,
    "gi",
  );
  const matches = [...sql.matchAll(pattern)].map((match) => match[0]);
  return matches.at(-1) ?? null;
}

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}
