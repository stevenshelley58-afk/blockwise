import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  appendAdStudioCreativeRevision,
  claimAdStudioCreativeRevisionMutation,
  executeAdStudioCreativeRevisionMutation,
} from "../src/lib/adstudio/creative-revisions.ts";

const migrationPath = "supabase/migrations/202607130003_adstudio_creative_revisions.sql";
const lockdownMigrationPath = "supabase/migrations/20260811140232_revision_rpc_service_role_only.sql";
const creativeDmlLockdownMigrationPath = "supabase/migrations/20260811170000_adstudio_creatives_server_owned_dml.sql";
const dbTestPath = "supabase/tests/adstudio_creative_revisions.test.sql";
const ownershipDbTestPath = "supabase/tests/adstudio_campaign_pack_ownership.test.sql";
const routePath = "src/app/api/adstudio/creatives/[id]/edit/route.ts";
const requestHash = "a".repeat(64);

test("creative revision migration backfills every creative and installs an append-only CAS path", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(dbTestPath), true);
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table public\.adstudio_creative_revisions/i);
  assert.match(sql, /create table public\.adstudio_creative_revision_mutations/i);
  assert.match(sql, /request_hash text not null/i);
  assert.match(sql, /alter table public\.adstudio_creatives[\s\S]*add column active_revision_id uuid/i);
  assert.match(sql, /lock table public\.adstudio_creatives/i);
  assert.match(sql, /insert into public\.adstudio_creative_revisions[\s\S]*migration_backfill/i);
  assert.match(sql, /count\(\*\)[\s\S]*unresolved[\s\S]*raise exception/i);
  assert.match(sql, /alter column active_revision_id set not null/i);
  assert.match(sql, /alter table public\.adstudio_creative_revisions enable row level security/i);
  assert.match(sql, /private\.adstudio_has_workspace_access\(workspace_id\)/i);
  assert.match(sql, /revoke (?:insert|update|delete)[\s\S]*adstudio_creative_revisions[\s\S]*authenticated/i);
  assert.doesNotMatch(sql, /drop table|truncate table/i);
  assert.match(sql, /adstudio_guard_creative_version_update/i);
  assert.match(sql, /new\.active_revision_id := next_revision_id/i);
  assert.match(sql, /'campaign_persist'/i);
  assert.match(sql, /adstudio_preserve_creative_revision_history/i);
  assert.match(sql, /Creative revision history must be preserved/i);

  assert.match(sql, /create or replace function public\.adstudio_claim_creative_revision_mutation/i);

  assert.match(sql, /create or replace function public\.adstudio_append_creative_revision/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /where c\.workspace_id = p_workspace_id[\s\S]*and c\.id = p_creative_id[\s\S]*for update/i);
  assert.match(sql, /current_active_revision_id is distinct from p_expected_active_revision_id/i);
  assert.match(sql, /errcode = '40001'/i);
  assert.match(sql, /insert into public\.adstudio_creative_revisions/i);
  assert.match(sql, /update public\.adstudio_creatives[\s\S]*where workspace_id = p_workspace_id[\s\S]*and id = p_creative_id/i);
  assert.match(sql, /revoke all on function public\.adstudio_append_creative_revision[\s\S]*from public, anon/i);
  assert.match(sql, /grant execute on function public\.adstudio_append_creative_revision[\s\S]*to authenticated, service_role/i);

  const appendFunction = sql.slice(sql.indexOf("create or replace function public.adstudio_append_creative_revision"));
  assert.ok(
    appendFunction.indexOf("for update") < appendFunction.indexOf("where m.workspace_id = p_workspace_id"),
    "append locks the creative before checking idempotency",
  );
});

test("revision mutation RPCs are locked to service-role server work in a forward migration", () => {
  assert.equal(existsSync(lockdownMigrationPath), true);
  const sql = readFileSync(lockdownMigrationPath, "utf8");

  for (const functionName of [
    "adstudio_claim_creative_revision_mutation",
    "adstudio_release_creative_revision_mutation",
    "adstudio_append_creative_revision",
  ]) {
    const section = sql.slice(sql.indexOf(`revoke all on function public.${functionName}`));
    assert.match(section, /from public, anon, authenticated/i);
    assert.match(section, /to service_role/i);
    assert.doesNotMatch(section, /to authenticated(?:,|;)/i);
  }
});

test("creative table DML and whole-pack persistence are service-role only", () => {
  assert.equal(existsSync(creativeDmlLockdownMigrationPath), true);
  assert.equal(existsSync(ownershipDbTestPath), true);
  const sql = readFileSync(creativeDmlLockdownMigrationPath, "utf8");

  assert.match(sql, /revoke insert, update, delete on table public\.adstudio_creatives\s+from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public\.adstudio_creatives to authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.adstudio_creatives to service_role/i);
  assert.match(sql, /grant select, insert, update on table[\s\S]*public\.adstudio_brand_kits,[\s\S]*public\.adstudio_campaigns,[\s\S]*public\.adstudio_campaign_variants,[\s\S]*public\.adstudio_platform_copy,[\s\S]*public\.adstudio_compliance_reports[\s\S]*to service_role/i);
  for (const policy of [
    "adstudio_workspace_insert",
    "adstudio_workspace_update",
    "adstudio_workspace_delete",
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on public\\.adstudio_creatives`, "i"));
  }

  const packSection = sql.slice(sql.indexOf("revoke all on function public.adstudio_persist_campaign_pack"));
  assert.match(packSection, /from public, anon, authenticated/i);
  assert.match(packSection, /to service_role/i);
  assert.doesNotMatch(packSection, /to authenticated(?:,|;)/i);
  assert.match(sql, /ADSTUDIO_CAMPAIGN_PACK_OWNERSHIP_VIOLATION/);
  assert.match(sql, /ADSTUDIO_INVALID_CAMPAIGN_PACK/);
  assert.match(sql, /where adstudio_creatives\.workspace_id = excluded\.workspace_id\s+and adstudio_creatives\.campaign_id = excluded\.campaign_id/i);
  assert.match(sql, /became owned by another workspace or campaign during persistence/i);
});

test("every application creative writer crosses an authenticated workspace boundary before using service role", () => {
  const persistence = readFileSync("src/lib/adstudio/persistence.ts", "utf8");
  const draftRoute = readFileSync("src/app/api/adstudio/campaigns/[id]/draft/route.ts", "utf8");
  const publishRoute = readFileSync("src/app/api/adstudio/export-packages/[id]/publish/route.ts", "utf8");
  const layersRoute = readFileSync("src/app/api/adstudio/creatives/[id]/layers/route.ts", "utf8");
  const campaignRoute = readFileSync("src/app/api/adstudio/campaigns/[id]/route.ts", "utf8");
  const layerDerivation = readFileSync("src/lib/adstudio/layer-derivation.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  assert.match(persistence, /persistAdStudioCampaignPack\(\s*supabase: SupabaseServiceClient/);
  assert.match(generation, /SupabaseGenerationClient = SupabaseServiceClient/);
  assert.match(layerDerivation, /type SupabaseClient = ReturnType<typeof createSupabaseServiceClient>/);

  assert.ok(draftRoute.indexOf("requireAdStudioRequest(request)") < draftRoute.indexOf("createSupabaseServiceClient()"));
  assert.match(draftRoute, /creatives: existing\.creatives/);
  assert.match(draftRoute, /\{ \.\.\.submittedPack, creatives: \[\] \}/);
  assert.match(draftRoute, /persistAdStudioCampaignPack\(\s*createSupabaseServiceClient\(\)/);
  assert.match(publishRoute, /persistAdStudioCampaignPack\(serviceSupabase, basePack/);

  assert.ok(layersRoute.indexOf("requireAdStudioRequest(request)") < layersRoute.indexOf("createSupabaseServiceClient()"));
  assert.match(layersRoute, /\.eq\("workspace_id", context\.access\.workspaceId\)\s*\.eq\("id", id\)/);
  assert.match(layersRoute, /supabase: creativeService/);
  assert.ok(campaignRoute.indexOf("requireAdStudioRequest(request)") < campaignRoute.indexOf("const service = createSupabaseServiceClient()"));
  assert.match(campaignRoute, /service\s*\.from\("adstudio_creatives"\)\s*\.delete\(\)\s*\.eq\("workspace_id", access\.access\.workspaceId\)\s*\.eq\("campaign_id", id\)/);
});

test("revision claim helper maps stale and in-flight claims without dispatching work", async () => {
  const errors = [
    { code: "40001", message: "ADSTUDIO_STALE_REVISION" },
    { code: "55P03", message: "ADSTUDIO_EDIT_IN_PROGRESS" },
  ];

  for (const [index, error] of errors.entries()) {
    const result = await claimAdStudioCreativeRevisionMutation(
      { async rpc() { return { data: null, error }; } },
      {
        workspaceId: "11111111-1111-4111-8111-111111111111",
        creativeId: "22222222-2222-4222-8222-222222222222",
        expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
        mutationId: "44444444-4444-4444-8444-444444444444",
        requestHash,
      },
    );
    assert.deepEqual(result, { ok: false, reason: index === 0 ? "stale_revision" : "edit_in_progress" });
  }
});

test("revision helper maps a stale CAS result to a typed conflict", async () => {
  const client = {
    async rpc() {
      return { data: null, error: { code: "40001", message: "ADSTUDIO_STALE_REVISION" } };
    },
  };

  const result = await appendAdStudioCreativeRevision(client, {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    creativeId: "22222222-2222-4222-8222-222222222222",
    expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
    canvas: { objects: [] },
    renderStatus: "rendered",
    creationOperation: "targeted_edit",
    mutationId: "44444444-4444-4444-8444-444444444444",
    requestHash,
  });

  assert.deepEqual(result, { ok: false, reason: "stale_revision" });
});

test("revision helper sends workspace-scoped CAS arguments and returns the appended revision", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return {
        data: [{ revision_id: "55555555-5555-4555-8555-555555555555", revision_number: 2 }],
        error: null,
      };
    },
  };

  const result = await appendAdStudioCreativeRevision(client, {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    creativeId: "22222222-2222-4222-8222-222222222222",
    expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
    canvas: { objects: [{ objectId: "template_clone_image" }] },
    renderStatus: "rendered",
    creationOperation: "targeted_edit",
    mutationId: "44444444-4444-4444-8444-444444444444",
    requestHash,
  });

  assert.equal(calls[0]?.name, "adstudio_append_creative_revision");
  assert.equal(calls[0]?.args.p_workspace_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0]?.args.p_expected_active_revision_id, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(result, {
    ok: true,
    revisionId: "55555555-5555-4555-8555-555555555555",
    revisionNumber: 2,
  });
});

test("concurrent duplicate appends resolve to the same completed revision", async () => {
  let calls = 0;
  const client = {
    async rpc() {
      calls += 1;
      await Promise.resolve();
      return {
        data: [{ revision_id: "55555555-5555-4555-8555-555555555555", revision_number: 2 }],
        error: null,
      };
    },
  };
  const input = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    creativeId: "22222222-2222-4222-8222-222222222222",
    expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
    canvas: { objects: [] },
    renderStatus: "rendered",
    creationOperation: "targeted_edit" as const,
    mutationId: "44444444-4444-4444-8444-444444444444",
    requestHash,
  };

  const results = await Promise.all([
    appendAdStudioCreativeRevision(client, input),
    appendAdStudioCreativeRevision(client, input),
  ]);
  assert.equal(calls, 2);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], {
    ok: true,
    revisionId: "55555555-5555-4555-8555-555555555555",
    revisionNumber: 2,
  });
});

test("targeted edit appends through the revision CAS and returns a clean stale conflict", () => {
  const route = readFileSync(routePath, "utf8");

  assert.match(route, /active_revision_id/);
  assert.match(route, /appendAdStudioCreativeRevision/);
  assert.match(route, /executeAdStudioCreativeRevisionMutation/);
  assert.match(route, /expectedRevisionId/);
  assert.match(route, /mutationId/);
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /requestHash/);
  assert.match(route, /requireAdStudioRequest\(request\)[\s\S]*createSupabaseServiceClient\(\)/);
  assert.match(route, /executeAdStudioCreativeRevisionMutation\(revisionService,/);
  assert.match(route, /appendAdStudioCreativeRevision\(revisionService,/);
  assert.match(route, /releaseAdStudioCreativeRevisionMutation\(revisionService,/);
  assert.doesNotMatch(route, /executeAdStudioCreativeRevisionMutation\(context\.supabase,/);
  assert.doesNotMatch(route, /appendAdStudioCreativeRevision\(context\.supabase,/);
  assert.doesNotMatch(route, /releaseAdStudioCreativeRevisionMutation\(context\.supabase,/);
  assert.ok(
    route.indexOf("executeAdStudioCreativeRevisionMutation") < route.indexOf("generateCloneWithCascade({"),
    "the route claims before paid provider dispatch",
  );
  assert.match(route, /reason === "stale_revision"/);
  assert.match(route, /code: "stale_revision"/);
  assert.match(route, /status: 409/);
  assert.doesNotMatch(route, /\.from\("adstudio_creatives"\)[\s\S]{0,300}\.update\(\{ canvas_json:/);
});

test("revision claim binds a mutation ID to one canonical request hash", async () => {
  const calls: Array<Record<string, unknown>> = [];
  await claimAdStudioCreativeRevisionMutation(
    {
      async rpc(_name, args) {
        calls.push(args);
        return { data: [{ state: "claimed" }], error: null };
      },
    },
    {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      creativeId: "22222222-2222-4222-8222-222222222222",
      expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
      mutationId: "44444444-4444-4444-8444-444444444444",
      requestHash,
    },
  );

  assert.equal(calls[0]?.p_request_hash, requestHash);
});

test("revision claim maps mutation content mismatch to a typed conflict", async () => {
  const result = await claimAdStudioCreativeRevisionMutation(
    {
      async rpc() {
        return {
          data: null,
          error: { code: "22023", message: "ADSTUDIO_MUTATION_CONTENT_MISMATCH" },
        };
      },
    },
    {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      creativeId: "22222222-2222-4222-8222-222222222222",
      expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
      mutationId: "44444444-4444-4444-8444-444444444444",
      requestHash,
    },
  );

  assert.deepEqual(result, { ok: false, reason: "mutation_content_mismatch" });
});

test("a lost success response replays the completed revision without dispatching provider work", async () => {
  let completed = false;
  let providerDispatches = 0;
  const client = {
    async rpc() {
      return completed
        ? {
            data: [{
              state: "completed",
              revision_id: "55555555-5555-4555-8555-555555555555",
              revision_number: 2,
              canvas_json: { objects: [{ content: "saved-edit.png" }] },
            }],
            error: null,
          }
        : { data: [{ state: "claimed" }], error: null };
    },
  };
  const input = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    creativeId: "22222222-2222-4222-8222-222222222222",
    expectedActiveRevisionId: "33333333-3333-4333-8333-333333333333",
    mutationId: "44444444-4444-4444-8444-444444444444",
    requestHash,
  };

  await executeAdStudioCreativeRevisionMutation(client, input, async () => {
    providerDispatches += 1;
    completed = true;
    return { response: "lost after commit" };
  });
  const retry = await executeAdStudioCreativeRevisionMutation(client, input, async () => {
    providerDispatches += 1;
    return { response: "must not run" };
  });

  assert.equal(providerDispatches, 1);
  assert.equal(retry.ok && retry.state, "completed");
  assert.equal(retry.ok && retry.state === "completed" && retry.revisionId, "55555555-5555-4555-8555-555555555555");
});
