import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Supabase local config exposes app schemas and seed SQL path", () => {
  const config = readFileSync("supabase/config.toml", "utf8");
  assert.match(config, /schemas = \["public", "graphql_public"\]/);
  assert.doesNotMatch(config, /schemas = \[[^\]]*"research"/);
  assert.match(config, /sql_paths = \["\.\/seed\.sql"\]/);
});
