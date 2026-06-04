import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
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
