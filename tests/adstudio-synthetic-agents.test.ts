import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/202606090003_synthetic_agents.sql";

test("synthetic-agents migration is wrapped in a transaction", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /^\s*begin;/im, "migration must start with begin;");
  assert.match(sql, /commit;/i, "migration must end with commit;");
});

test("synthetic-agents migration creates research.synthetic_agents table", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /create table if not exists research\.synthetic_agents/i,
    "expected CREATE TABLE for research.synthetic_agents",
  );
});

test("synthetic-agents migration has CHECK constraints enforcing is_synthetic=true and not_a_real_person=true", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(
    sql,
    /check\s*\(\s*is_synthetic\s*=\s*true\s*\)/i,
    "expected CHECK (is_synthetic = true)",
  );
  assert.match(
    sql,
    /check\s*\(\s*not_a_real_person\s*=\s*true\s*\)/i,
    "expected CHECK (not_a_real_person = true)",
  );
});

test("synthetic-agents migration enables RLS and denies public/anon/authenticated direct access", () => {
  const sql = readFileSync(migrationPath, "utf8");
  assert.match(sql, /alter table research\.synthetic_agents enable row level security/i);
  assert.match(sql, /revoke all on research\.synthetic_agents from public, anon, authenticated/i);
  assert.match(sql, /grant all on research\.synthetic_agents to service_role/i);
  assert.doesNotMatch(
    sql,
    /grant\s+[^;]*on research\.synthetic_agents to authenticated/i,
    "must not grant authenticated role direct table access",
  );
});
