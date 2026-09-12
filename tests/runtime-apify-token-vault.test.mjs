import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/202609120001_runtime_apify_provider_token_vault.sql", import.meta.url), "utf8");

test("runtime vault migration allows Apify without widening access", () => {
  assert.match(migration, /runtime_provider in \('openai', 'google', 'apify'\)/u);
  assert.match(migration, /p_runtime_provider not in \('openai', 'google', 'apify'\)/u);
  assert.match(migration, /revoke all on function public\.runtime_provider_token_vault_get\(text\) from public, anon, authenticated/u);
  assert.match(migration, /grant execute on function public\.runtime_provider_token_vault_get\(text\) to service_role/u);
  assert.doesNotMatch(migration, /private\.provider_token_vault.*rest/u);
});
