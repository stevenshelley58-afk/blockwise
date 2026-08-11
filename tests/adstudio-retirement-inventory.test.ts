import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("retirement inventory retains a canonical finished-clone canary and scopes legacy rows", () => {
  const tables = {
    adstudio_campaigns: [
      { id: "campaign_legacy", workspace_id: "workspace_1", template_snapshot_json: {} },
      { id: "campaign_canary", workspace_id: "workspace_1", template_snapshot_json: { publishContractVersion: "finished_clone_v1" } },
    ],
    meta_publish_plans: [
      { id: "plan_legacy", workspace_id: "workspace_1", adstudio_campaign_id: "campaign_legacy", plan_json: {} },
      { id: "plan_canary", workspace_id: "workspace_1", adstudio_campaign_id: "campaign_canary", plan_json: { publishContractVersion: "finished_clone_v1", creatives: [{ revisionBindings: [{ creativeId: "creative_1", revisionId: "revision_1" }] }] } },
    ],
    adstudio_campaign_variants: [
      { id: "variant_legacy", workspace_id: "workspace_1", campaign_id: "campaign_legacy" },
      { id: "variant_canary", workspace_id: "workspace_1", campaign_id: "campaign_canary" },
    ],
    adstudio_creatives: [
      { id: "creative_legacy", workspace_id: "workspace_1", campaign_id: "campaign_legacy", variant_id: "variant_legacy" },
      { id: "creative_canary", workspace_id: "workspace_1", campaign_id: "campaign_canary", variant_id: "variant_canary" },
    ],
    adstudio_creative_revisions: [
      { id: "revision_legacy", workspace_id: "workspace_1", creative_id: "creative_legacy" },
      { id: "revision_canary", workspace_id: "workspace_1", creative_id: "creative_canary" },
    ],
    adstudio_creative_revision_mutations: [
      { id: "mutation_legacy", workspace_id: "workspace_1", creative_id: "creative_legacy" },
      { id: "mutation_canary", workspace_id: "workspace_1", creative_id: "creative_canary" },
    ],
    adstudio_creative_objects: [
      { id: "object_legacy", workspace_id: "workspace_1", creative_id: "creative_legacy" },
      { id: "object_canary", workspace_id: "workspace_1", creative_id: "creative_canary" },
    ],
    adstudio_job_runs: [
      { id: "run_legacy", workspace_id: "workspace_1", input_json: { campaignId: "campaign_legacy" } },
      { id: "run_canary", workspace_id: "workspace_1", input_json: { campaignId: "campaign_canary" } },
    ],
    adstudio_creative_jobs: [
      { id: "creative_job_legacy", workspace_id: "workspace_1", campaign_id: "campaign_legacy", payload: {} },
      { id: "creative_job_canary", workspace_id: "workspace_1", campaign_id: "campaign_canary", payload: {} },
    ],
    adstudio_generation_locks: [
      { dedupe_key: "lock_legacy", workspace_id: "workspace_1", job_id: "creative_job_legacy" },
      { dedupe_key: "lock_canary", workspace_id: "workspace_1", job_id: "creative_job_canary" },
    ],
    adstudio_clone_candidate_audits: [
      { id: "audit_legacy", workspace_id: "workspace_1", correlation_id: "correlation_legacy" },
      { id: "audit_canary", workspace_id: "workspace_1", correlation_id: "correlation_canary" },
    ],
    adstudio_provider_runs: [
      { id: "provider_legacy", workspace_id: "workspace_1", campaign_id: "campaign_legacy", job_id: "run_legacy", input_json: {}, correlation_id: "correlation_legacy" },
      { id: "provider_canary", workspace_id: "workspace_1", campaign_id: "campaign_canary", job_id: "run_canary", input_json: {}, correlation_id: "correlation_canary" },
    ],
    adstudio_provider_run_attempts: [
      { id: "attempt_legacy", workspace_id: "workspace_1", provider_run_id: "provider_legacy" },
      { id: "attempt_canary", workspace_id: "workspace_1", provider_run_id: "provider_canary" },
    ],
    adstudio_provider_attempt_outbox: [
      { id: "outbox_legacy", workspace_id: "workspace_1", provider_run_id: "provider_legacy" },
      { id: "outbox_canary", workspace_id: "workspace_1", provider_run_id: "provider_canary" },
    ],
    job_queue: [
      { id: "job_legacy", workspace_id: "workspace_1", kind: "publish.meta", payload_json: { planId: "plan_legacy" } },
      { id: "job_canary", workspace_id: "workspace_1", kind: "publish.meta", payload_json: { planId: "plan_canary" } },
    ],
    approval_requests: [
      { id: "approval_legacy", workspace_id: "workspace_1", target_type: "meta_publish_plan", target_id: "plan_legacy" },
      { id: "approval_canary", workspace_id: "workspace_1", target_type: "meta_publish_plan", target_id: "plan_canary" },
    ],
  };
  const script = new URL("../scripts/adstudio/prepare-retirement.mjs", import.meta.url).href;
  const harness = `
    const tables = ${JSON.stringify(tables)};
    globalThis.fetch = async (value) => {
      const table = new URL(value).pathname.split("/").at(-1);
      return { ok: true, status: 200, json: async () => tables[table] ?? [] };
    };
    await import(${JSON.stringify(script)});
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", harness], {
    env: { ...process.env, SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "test" },
    encoding: "utf8",
  });
  const manifest = JSON.parse(output) as { counts: Record<string, number>; retainedCanonical: { planIds: string[]; campaignIds: string[] } };

  assert.equal(manifest.counts.meta_publish_plans, 1);
  assert.equal(manifest.counts.adstudio_campaigns, 1);
  assert.equal(manifest.counts.job_queue, 1);
  assert.equal(manifest.counts.approval_requests, 1);
  for (const table of [
    "adstudio_campaign_variants", "adstudio_creatives", "adstudio_creative_revisions",
    "adstudio_creative_revision_mutations", "adstudio_creative_objects", "adstudio_job_runs",
    "adstudio_provider_runs", "adstudio_provider_run_attempts", "adstudio_provider_attempt_outbox",
    "adstudio_creative_jobs", "adstudio_generation_locks", "adstudio_clone_candidate_audits",
  ]) assert.equal(manifest.counts[table], 1, `${table} should retain only its legacy child`);
  assert.deepEqual(manifest.retainedCanonical, { planIds: ["plan_canary"], campaignIds: ["campaign_canary"] });
});
