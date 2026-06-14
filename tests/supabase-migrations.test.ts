import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsDir = "supabase/migrations";

test("supabase migration versions are unique", () => {
  const versions = new Map<string, string[]>();

  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"))) {
    const version = file.split("_", 1)[0];
    const files = versions.get(version) ?? [];
    files.push(file);
    versions.set(version, files);
  }

  const duplicates = [...versions.entries()].filter(([, files]) => files.length > 1);

  assert.deepEqual(duplicates, []);
});

test("meta execution repair migration uses existing public RLS helper functions", () => {
  const sql = readFileSync(
    `${migrationsDir}/202606150001_repair_meta_execution_runtime_tables.sql`,
    "utf8",
  );

  assert.equal(sql.includes("private.is_operator()"), false);
  assert.equal(sql.includes("private.is_workspace_member"), false);
  assert.ok(sql.includes("public.is_operator()"));
  assert.ok(sql.includes("public.is_workspace_member(workspace_id)"));
});
