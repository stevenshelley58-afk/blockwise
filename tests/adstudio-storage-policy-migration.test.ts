import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260914010000_adstudio_storage_operator_read.sql";
const migrationAllowlistPath = "infra/product/product-migrations.txt";

test("workspace artifact reads use the canonical workspace access helper", () => {
  const sql = readFileSync(migrationPath, "utf8");
  const allowlist = readFileSync(migrationAllowlistPath, "utf8");

  assert.match(sql, /drop policy if exists workspace_artifacts_read on storage\.objects/i);
  assert.match(
    sql,
    /create policy workspace_artifacts_read on storage\.objects[\s\S]*for select to authenticated using/i,
  );
  assert.match(sql, /private\.adstudio_has_workspace_access\(/i);
  assert.match(sql, /private\.workspace_id_from_storage_path\(name\)/i);
  assert.doesNotMatch(sql, /public\.(?:is_workspace_member|has_workspace_role|adstudio_has_workspace_access)\(/i);
  assert.equal(
    allowlist.split(/\r?\n/).filter((line) => line === "20260914010000_adstudio_storage_operator_read.sql").length,
    1,
  );
});
