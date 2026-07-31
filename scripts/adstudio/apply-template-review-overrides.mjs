#!/usr/bin/env node
// Folds template-review overrides saved in Supabase (adstudio_template_review_overrides)
// back into src/lib/adstudio/template-gallery/<id>.json so git stays the canonical
// source. Run with --clear to delete rows that were applied successfully.
//
// Usage:
//   node scripts/adstudio/apply-template-review-overrides.mjs [--clear]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "../lib/supabase-server-credential.mjs";

const root = process.cwd();
const GALLERY_DIR = join(root, "src", "lib", "adstudio", "template-gallery");
const clear = process.argv.includes("--clear");

for (const path of [join(root, ".env.local"), join(root, ".env")]) {
  if (existsSync(path)) process.loadEnvFile(path);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) {
  console.error("Missing env: set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  process.exit(1);
}
const supabase = createSupabaseServerClient(createClient, url, process.env, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: rows, error } = await supabase
  .from("adstudio_template_review_overrides")
  .select("template_id,payload,updated_at")
  .order("template_id");
if (error) {
  console.error(`Failed to read overrides: ${error.message}`);
  process.exit(1);
}

if (!rows?.length) {
  console.log("No template review overrides to apply.");
  process.exit(0);
}

const applied = [];
const skipped = [];

for (const row of rows) {
  const filePath = join(GALLERY_DIR, `${row.template_id}.json`);
  if (!/^[a-zA-Z0-9_-]+$/.test(row.template_id) || !existsSync(filePath)) {
    console.warn(`SKIP ${row.template_id}: no matching gallery file.`);
    skipped.push(row.template_id);
    continue;
  }

  const template = JSON.parse(readFileSync(filePath, "utf-8"));
  const payload = row.payload ?? {};
  if (payload.typography) template.typography = payload.typography;
  if (payload.textInputs) {
    template.inputs = { ...(template.inputs ?? {}), text: payload.textInputs };
  }

  writeFileSync(filePath, JSON.stringify(template, null, 2) + "\n", "utf-8");
  console.log(`APPLIED ${row.template_id} (saved ${row.updated_at})`);
  applied.push(row.template_id);
}

if (clear && applied.length > 0) {
  const { error: deleteError } = await supabase
    .from("adstudio_template_review_overrides")
    .delete()
    .in("template_id", applied);
  if (deleteError) {
    console.error(`Failed to clear applied overrides: ${deleteError.message}`);
    process.exit(1);
  }
  console.log(`Cleared ${applied.length} applied override(s).`);
}

console.log(
  `Done: ${applied.length} applied, ${skipped.length} skipped${
    clear ? "" : " (rows kept; pass --clear to delete applied rows)"
  }. Review the diff and commit the gallery changes.`,
);
