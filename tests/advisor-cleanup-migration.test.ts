import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/202606090001_advisor_index_and_rls_initplan_cleanup.sql";

const sql = readFileSync(migrationPath, "utf8");

const lines = sql.split("\n");
// Each covering index is wrapped in an exception-handled `execute` so the
// migration also replays cleanly on Supabase preview branches whose schema
// lacks prod's out-of-band drift columns.
const createIndexLines = lines.filter((line) => line.trim().startsWith("execute 'create index"));
// Executable body = everything except header/section comment lines.
const body = lines.filter((line) => !line.trim().startsWith("--")).join("\n");

test("advisor cleanup migration is additive and idempotent", () => {
  assert.equal(createIndexLines.length, 137);
  const guarded = createIndexLines.filter((line) => line.trim().startsWith("execute 'create index if not exists "));
  assert.equal(guarded.length, 137);
  // Every wrapped index skips drift (missing column/table) instead of failing.
  const skipGuards = lines.filter((line) => line.includes("exception when undefined_column or undefined_table"));
  assert.equal(skipGuards.length, 137);
});

test("advisor cleanup migration only indexes app-owned schemas", () => {
  // Supabase-managed (auth, storage) and deprecated (research_legacy) schemas
  // must be left untouched.
  const included = createIndexLines.filter((line) => {
    const target = line.slice(line.indexOf(" on ") + 4);
    return target.startsWith("public.") || target.startsWith("private.") || target.startsWith("research.");
  });
  assert.equal(included.length, 137);

  const excluded = createIndexLines.filter((line) => {
    const target = line.slice(line.indexOf(" on ") + 4);
    return target.startsWith("auth.") || target.startsWith("storage.") || target.startsWith("research_legacy.");
  });
  assert.equal(excluded.length, 0);

  // Spot-check a covering index in each included schema.
  assert.ok(sql.includes("execute 'create index if not exists provider_token_vault_workspace_id_idx on private.provider_token_vault (workspace_id)';"));
  assert.ok(sql.includes("execute 'create index if not exists ai_runs_user_id_idx on public.ai_runs (user_id)';"));
  assert.ok(sql.includes("execute 'create index if not exists work_queue_advertiser_page_id_idx on research.work_queue (advertiser_page_id)';"));
});

test("advisor cleanup migration fixes the three auth_rls_initplan policies", () => {
  // Each policy is dropped-if-exists then recreated (idempotent reapply).
  assert.ok(sql.includes("drop policy if exists profiles_select_self_or_operator on public."));
  assert.ok(sql.includes("create policy profiles_select_self_or_operator on public."));
  assert.ok(sql.includes("drop policy if exists profiles_update_self_or_operator on public."));
  assert.ok(sql.includes("create policy profiles_update_self_or_operator on public."));
  assert.ok(sql.includes("drop policy if exists workspaces_insert_authenticated on public."));
  assert.ok(sql.includes("create policy workspaces_insert_authenticated on public."));

  // auth.uid() must be wrapped in a scalar sub-select (the initplan fix).
  assert.ok(sql.includes("id = (select auth.uid()) or public.is_operator()"));
  assert.ok(sql.includes("created_by = (select auth.uid()) or public.is_operator()"));

  // Every auth.uid() in the executable body must be wrapped (header comment excluded).
  const totalUid = body.split("auth.uid()").length - 1;
  const wrappedUid = body.split("(select auth.uid())").length - 1;
  assert.equal(totalUid, wrappedUid);

  // Behaviour preservation: the INSERT policy keeps its authenticated role.
  assert.ok(body.includes("for insert to authenticated"));
});
