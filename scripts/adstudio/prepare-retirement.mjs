#!/usr/bin/env node

/**
 * Read-only AdStudio retirement inventory. It never calls Meta DELETE and
 * never mutates Supabase. Run with service credentials only from the VPS:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/adstudio/prepare-retirement.mjs > /secure/retirement.json
 *
 * The resulting ID-scoped manifest is the only allowed input to the separate
 * operator runbook. Do not turn this script into a delete command.
 */
const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const headers = { apikey: key, authorization: `Bearer ${key}` };
async function get(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&order=workspace_id.asc,id.asc`, {
      headers: { ...headers, Range: `${offset}-${offset + 999}` },
    });
    const payload = await response.json();
    // Legacy tables legitimately vary by deployment. Their absence is recorded;
    // any other error stops the inventory rather than producing a partial plan.
    if (response.status === 404 || payload.code === "PGRST205") return { present: false, rows: [] };
    if (!response.ok) throw new Error(`${table}: ${payload.message ?? response.status}`);
    if (!Array.isArray(payload)) throw new Error(`${table}: expected an array response`);
    rows.push(...payload);
    if (payload.length < 1000) return { present: true, rows };
  }
}
async function getAll(tables) {
  const entries = await Promise.all(tables.map(async (table) => [table, await get(table)]));
  return Object.fromEntries(entries);
}

const inventory = await getAll([
  "adstudio_campaigns", "adstudio_campaign_variants", "adstudio_creatives", "adstudio_creative_revisions",
  "adstudio_creative_revision_mutations", "adstudio_creative_jobs", "adstudio_job_runs", "adstudio_exports",
  "adstudio_creative_objects", "adstudio_platform_copy", "adstudio_compliance_reports", "adstudio_clone_candidate_audits",
  "adstudio_provider_runs", "adstudio_provider_run_attempts", "adstudio_provider_attempt_outbox", "adstudio_generation_locks",
  "adstudio_brand_assets", "adstudio_brand_kits", "adstudio_template_review_overrides", "meta_publish_plans",
  "meta_publish_plan_mutations", "approval_requests", "lead_source_attribution", "meta_leads", "leads",
  "lead_events", "lead_delivery_attempts", "lead_dedupe_records", "job_queue",
]);
const rows = (table) => inventory[table].rows;
const canonicalContractVersion = "finished_clone_v1";
const allPlans = rows("meta_publish_plans");
const allCampaigns = rows("adstudio_campaigns");
function isCanonicalPlan(plan) {
  const json = plan.plan_json;
  return json?.publishContractVersion === canonicalContractVersion
    && Array.isArray(json?.creatives)
    && json.creatives.length > 0
    && json.creatives.every((creative) => Array.isArray(creative.revisionBindings) && creative.revisionBindings.length > 0);
}
function isCanonicalCampaign(campaign) {
  return campaign.template_snapshot_json?.publishContractVersion === canonicalContractVersion;
}
const canonicalPlans = allPlans.filter(isCanonicalPlan);
const malformedCanonicalPlans = allPlans.filter((plan) =>
  plan.plan_json?.publishContractVersion === canonicalContractVersion && !isCanonicalPlan(plan),
);
if (malformedCanonicalPlans.length) throw new Error(`Canonical Meta plans missing immutable revision bindings: ${malformedCanonicalPlans.map((row) => row.id).join(", ")}`);
const canonicalPlanIds = new Set(canonicalPlans.map((row) => row.id));
const canonicalCampaignIds = new Set([
  ...canonicalPlans.map((row) => row.adstudio_campaign_id),
  ...allCampaigns.filter(isCanonicalCampaign).map((row) => row.id),
]);
const plans = allPlans.filter((row) => !canonicalPlanIds.has(row.id));
const campaignIds = new Set(allCampaigns.filter((row) => !canonicalCampaignIds.has(row.id)).map((row) => row.id));
const campaigns = allCampaigns.filter((row) => campaignIds.has(row.id));
const canonicalLegacyPlanOverlap = plans.filter((row) => canonicalCampaignIds.has(row.adstudio_campaign_id));
if (canonicalLegacyPlanOverlap.length) throw new Error(`Campaign has both canonical and legacy Meta plans: ${canonicalLegacyPlanOverlap.map((row) => row.adstudio_campaign_id).join(", ")}`);
const planIds = new Set(plans.map((row) => row.id));
const workspaceIds = new Set([...campaigns, ...plans].map((row) => row.workspace_id).filter(Boolean));
const belongs = (row) => workspaceIds.has(row.workspace_id)
  && (campaignIds.has(row.campaign_id) || campaignIds.has(row.adstudio_campaign_id) || planIds.has(row.meta_publish_plan_id));

const legacyJobKinds = new Set(["publish.meta", "sync.meta.leads"]);
function jsonReferencesPlanId(value) {
  if (typeof value === "string") return planIds.has(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(jsonReferencesPlanId);
  return Object.entries(value).some(([key, entry]) =>
    (key === "planId" || key === "plan_id" || key === "metaPublishPlanId" || key === "meta_publish_plan_id")
      ? typeof entry === "string" && planIds.has(entry)
      : jsonReferencesPlanId(entry),
  );
}
const scopedTables = Object.fromEntries(Object.entries(inventory).map(([table, value]) => [
  table,
  value.rows.filter((row) => {
    // Brand kits/assets are shared new-system resources. They are retained
    // unless a separately proven FK-level ownership migration classifies them.
    if (table === "adstudio_brand_assets" || table === "adstudio_brand_kits") return false;
    if (table === "adstudio_campaigns") return campaignIds.has(row.id);
    if (table === "meta_publish_plans") return planIds.has(row.id);
    if (table === "job_queue") return workspaceIds.has(row.workspace_id)
      && legacyJobKinds.has(String(row.kind))
      && jsonReferencesPlanId(row.payload_json ?? row.payload ?? row.data_json);
    if (table === "approval_requests") return workspaceIds.has(row.workspace_id)
      && ((row.target_type === "meta_publish_plan" && planIds.has(row.target_id))
        || (row.target_type === "adstudio_campaign" && campaignIds.has(row.target_id)));
    if (table === "lead_source_attribution" || table === "meta_leads" || table === "leads" || table === "lead_events" || table === "lead_delivery_attempts" || table === "lead_dedupe_records") {
      return workspaceIds.has(row.workspace_id) && (planIds.has(row.meta_publish_plan_id) || campaignIds.has(row.adstudio_campaign_id));
    }
    return belongs(row);
  }),
]));

const unclassifiedPresentTables = Object.entries(inventory)
  .filter(([table, value]) => value.present && !(table in scopedTables))
  .map(([table]) => table);
if (unclassifiedPresentTables.length) throw new Error(`Unclassified present retirement tables: ${unclassifiedPresentTables.join(", ")}`);

const storageRefs = Object.values(scopedTables).flatMap((table) => table.flatMap((row) => [
  row.storage_path, row.preview_url, row.full_url, row.render_path, row.export_path,
])).filter((value) => typeof value === "string");
const parsedStorageObjects = storageRefs.map(storageObjectFromReference);
const unparsedStorageReferences = storageRefs.filter((reference, index) => !parsedStorageObjects[index]);
if (unparsedStorageReferences.length) throw new Error(`Unclassified storage references: ${unparsedStorageReferences.slice(0, 5).join(", ")}`);
const storageObjects = [...new Map(parsedStorageObjects.map((item) => [`${item.bucketId}:${item.name}`, item])).values()]
  .sort((left, right) => `${left.bucketId}/${left.name}`.localeCompare(`${right.bucketId}/${right.name}`));
const storagePaths = storageObjects.map((item) => item.name);

function storageObjectFromReference(value) {
  if (!value.startsWith("http")) return { bucketId: "workspace-artifacts", name: value };
  try {
    const urlValue = new URL(value);
    const marker = "/storage/v1/object/";
    const index = urlValue.pathname.indexOf(marker);
    if (index < 0) return null;
    const pieces = urlValue.pathname.slice(index + marker.length).split("/");
    if (["public", "authenticated", "sign"].includes(pieces[0])) pieces.shift();
    const bucketId = pieces.shift();
    const name = pieces.map(decodeURIComponent).join("/");
    return bucketId && name ? { bucketId, name } : null;
  } catch {
    return null;
  }
}

const externalObjects = plans.flatMap((plan) => {
  const objects = plan.reconciled_objects_json ?? {};
  return [
    ...(objects.campaignId ? [{ workspaceId: plan.workspace_id, planId: plan.id, type: "campaign", id: objects.campaignId }] : []),
    ...Object.values(objects.adIds ?? {}).map((id) => ({ workspaceId: plan.workspace_id, planId: plan.id, type: "ad", id })),
    ...Object.values(objects.adSetIds ?? {}).map((id) => ({ workspaceId: plan.workspace_id, planId: plan.id, type: "adset", id })),
    ...Object.values(objects.creativeIds ?? {}).map((id) => ({ workspaceId: plan.workspace_id, planId: plan.id, type: "creative", id })),
    ...Object.values(objects.leadFormIds ?? {}).map((id) => ({ workspaceId: plan.workspace_id, planId: plan.id, type: "lead_form", id })),
  ];
});

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  readOnly: true,
  completeOnlyAfterPausedCanary: true,
  inventoryPresence: Object.fromEntries(Object.entries(inventory).map(([table, value]) => [table, value.present])),
  counts: Object.fromEntries(Object.entries(scopedTables).map(([table, value]) => [table, value.length])),
  workspaceIds: [...workspaceIds].sort(),
  retainedCanonical: {
    planIds: [...canonicalPlanIds].sort(),
    campaignIds: [...canonicalCampaignIds].sort(),
  },
  tables: scopedTables,
  storagePaths,
  storageObjects,
  retainedExcludedTables: ["workspaces", "provider_connections", "private.provider_token_vault", "audit_logs", "billing_events", "stripe_webhook_events", "meta_free_live_claims", "meta_free_live_claim_mutations", "adstudio_brand_assets", "adstudio_brand_kits"],
  dependencyDeletionOrder: ["job_queue", "lead_events", "lead_delivery_attempts", "lead_dedupe_records", "lead_source_attribution", "meta_leads", "leads", "adstudio_provider_attempt_outbox", "adstudio_provider_run_attempts", "adstudio_provider_runs", "adstudio_generation_locks", "adstudio_creative_revision_mutations", "adstudio_creative_revisions", "adstudio_creative_jobs", "adstudio_job_runs", "adstudio_creative_objects", "adstudio_creatives", "adstudio_campaign_variants", "meta_publish_plan_mutations", "approval_requests", "meta_publish_plans", "adstudio_platform_copy", "adstudio_compliance_reports", "adstudio_clone_candidate_audits", "adstudio_template_review_overrides", "adstudio_exports", "adstudio_campaigns"],
  providerDeletionOrder: ["ad", "adset", "creative", "campaign", "lead_form"],
  externalObjects,
}, null, 2));
