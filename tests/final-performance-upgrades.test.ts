import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("performance telemetry and database guards ship with the hot-path changes", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260728125603_finish_performance_hot_paths.sql",
    "utf8",
  );

  assert.doesNotMatch(layout, /@vercel\/speed-insights\/next/);
  assert.doesNotMatch(layout, /<SpeedInsights \/>/);
  assert.match(migration, /alter publication supabase_realtime add table public\.adstudio_creatives/);
  assert.match(migration, /alter publication supabase_realtime add table public\.adstudio_creative_jobs/);
  assert.match(migration, /owned_ad_performance_adstudio_campaign_idx/);
  assert.match(migration, /owned_ad_performance_adstudio_creative_idx/);
});
