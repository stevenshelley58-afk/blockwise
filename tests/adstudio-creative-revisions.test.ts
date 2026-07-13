import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  appendAdStudioCreativeRevision,
  claimAdStudioCreativeRevisionMutation,
} from "../src/lib/adstudio/creative-revisions.ts";

const migrationPath = "supabase/migrations/202607130003_adstudio_creative_revisions.sql";
const dbTestPath = "supabase/tests/adstudio_creative_revisions.test.sql";
const routePath = "src/app/api/adstudio/creatives/[id]/edit/route.ts";

test("creative revision migration backfills every creative and installs an append-only CAS path", () => {
  assert.equal(existsSync(migrationPath), true);
  assert.equal(existsSync(dbTestPath), true);
  const sql = readFileSync(migrationPath, "utf8");

  assert.match(sql, /create table public\.adstudio_creative_revisions/i);
  assert.match(sql, /create table public\.adstudio_creative_revision_mutations/i);
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
  assert.match(route, /claimAdStudioCreativeRevisionMutation/);
  assert.match(route, /expectedRevisionId/);
  assert.match(route, /mutationId/);
  assert.ok(
    route.indexOf("claimAdStudioCreativeRevisionMutation") < route.indexOf("generateCloneWithCascade({"),
    "the route claims before paid provider dispatch",
  );
  assert.match(route, /reason === "stale_revision"/);
  assert.match(route, /code: "stale_revision"/);
  assert.match(route, /status: 409/);
  assert.doesNotMatch(route, /\.from\("adstudio_creatives"\)[\s\S]{0,300}\.update\(\{ canvas_json:/);
});
