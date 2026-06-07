import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");

const paths = {
  adSchema: "src/lib/research/schemas/ads.ts",
  classifierSkill: "hermes/skills/blockwise-ad-classifier/SKILL.md",
  commonSchema: "src/lib/research/schemas/common.ts",
  entitiesSchema: "src/lib/research/schemas/entities.ts",
  hardResetMigration: "supabase/migrations/202605300003_blockwise_hard_reset_clean_schema.sql",
  jsonRules: "src/lib/adstudio/prompts/shared/json_rules.md",
  metaCapture: "hermes/tools/meta-library-capture/src/capture.ts",
  metaCard: "src/components/research/meta-ad-library-card.tsx",
  researchPage: "src/app/(customer)/ad-radar/page.tsx",
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
