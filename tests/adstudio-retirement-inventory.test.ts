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
  assert.deepEqual(manifest.retainedCanonical, { planIds: ["plan_canary"], campaignIds: ["campaign_canary"] });
});
