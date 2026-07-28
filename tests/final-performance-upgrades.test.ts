import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("campaign reads use one compact pack load and bounded deferred metadata", () => {
  const campaignRoute = readFileSync("src/app/api/adstudio/campaigns/[id]/route.ts", "utf8");
  const listRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const topbar = readFileSync("src/components/adstudio/topbar.tsx", "utf8");
  const getHandler = campaignRoute.slice(
    campaignRoute.indexOf("export async function GET"),
    campaignRoute.indexOf("export async function PATCH"),
  );

  assert.match(getHandler, /loadAdStudioCampaignPack/);
  assert.match(getHandler, /compactAdStudioCampaignPackForTransport/);
  assert.doesNotMatch(getHandler, /\.from\(/);
  assert.match(listRoute, /\.limit\(limit\)/);
  assert.match(listRoute, /Math\.min\(100/);
  assert.match(topbar, /requestIdleCallback/);
  assert.match(topbar, /campaigns\?limit=50/);
});

test("AdStudio completion uses Realtime with low-frequency resilience checks", () => {
  const campaignActions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");

  assert.match(campaignActions, /table: "adstudio_creative_jobs"/);
  assert.match(campaignActions, /"postgres_changes"/);
  assert.match(campaignActions, /TEMPLATE_JOB_FALLBACK_INTERVAL_MS = 30_000/);
  assert.match(campaignActions, /job\.campaignPack/);
  assert.doesNotMatch(campaignActions, /TEMPLATE_JOB_POLL_INTERVAL_MS|loadCampaignPackById|sleep\(2_500\)/);

  assert.match(workbench, /table: "adstudio_creatives"/);
  assert.match(workbench, /campaign_id=eq\.\$\{editorPreparingCampaignId\}/);
  assert.match(workbench, /30_000/);
  assert.doesNotMatch(workbench, /attempts >= 40|setTimeout\(\(\) => void poll\(\), 1500\)/);
});

test("performance telemetry and database guards ship with the hot-path changes", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260728125603_finish_performance_hot_paths.sql",
    "utf8",
  );

  assert.match(layout, /@vercel\/speed-insights\/next/);
  assert.match(layout, /<SpeedInsights \/>/);
  assert.match(migration, /alter publication supabase_realtime add table public\.adstudio_creatives/);
  assert.match(migration, /alter publication supabase_realtime add table public\.adstudio_creative_jobs/);
  assert.match(migration, /owned_ad_performance_adstudio_campaign_idx/);
  assert.match(migration, /owned_ad_performance_adstudio_creative_idx/);
});
