import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Supabase local config exposes app schemas and seed reset recipe", () => {
  const config = readFileSync("supabase/config.toml", "utf8");
  const readme = readFileSync("README.md", "utf8");

  assert.match(config, /schemas = \["public", "graphql_public"\]/);
  assert.doesNotMatch(config, /schemas = \[[^\]]*"research"/);
  assert.match(config, /sql_paths = \["\.\/seed\.sql"\]/);
  assert.match(readme, /supabase db reset/);
  assert.match(readme, /npm run seed:test-users/);
  assert.match(readme, /BLOCKWISE_DEV_PASSWORD/);
});
