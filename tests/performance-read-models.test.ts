import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
import test from "node:test";

import {
  ADSTUDIO_MEDIA_URL_LIMIT,
  isWorkspaceMediaPath,
} from "../src/lib/adstudio/media-urls.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("reporting snapshots are versioned, service-owned, and Realtime-invalidated", () => {
  const migration = read("supabase/migrations/20260728071845_performance_read_models.sql");
  assert.match(migration, /snapshot_version smallint not null default 1/);
  assert.match(migration, /unique index[\s\S]*workspace_id, provider, range_key/);
  assert.match(migration, /revoke all on table public\.reporting_snapshots from anon, authenticated/);
  assert.match(migration, /grant select on table public\.reporting_snapshots to authenticated/);
  assert.match(migration, /alter publication supabase_realtime add table public\.reporting_snapshots/);
});

test("customer reporting routes never call Meta and manual refresh only queues work", () => {
  const route = read("src/app/api/monitor-dashboard/route.ts");
  const page = read("src/app/(customer)/results/page.tsx");
  assert.match(route, /loadReportingSnapshot/);
  assert.match(route, /status: 304/);
  assert.match(route, /status: 202/);
  assert.match(route, /queueReportingRefresh/);
  assert.doesNotMatch(route, /getResultsPayload|syncProviderWorkspace/);
  assert.doesNotMatch(page, /getResultsPayload|syncProviderWorkspace/);
});

test("browser read models are identity-scoped, age-bounded, and purged on sign-out", () => {
  const store = read("src/lib/read-models/browser-store.ts");
  const shell = read("src/components/self-serve-shell.tsx");
  assert.match(store, /bw-read-models-v1/);
  assert.match(store, /24 \* 60 \* 60 \* 1000/);
  assert.match(store, /userId.*workspaceId.*surface/s);
  assert.match(store, /previous && previous !== next/);
  assert.match(shell, /purgeLocalReadModels/);
  assert.match(shell, /syncReadModelIdentity/);
});

test("smart prefetch is capped and respects browser constraints", () => {
  const source = read("src/lib/navigation/use-smart-prefetch.ts");
  assert.match(source, /\.slice\(0, 2\)/);
  assert.match(source, /saveData/);
  assert.match(source, /slow-2g/);
  assert.match(source, /visibilityState/);
  assert.match(source, /deviceMemory/);
  assert.match(source, /requestIdleCallback/);
});

test("every canonical Ad Studio sample has bounded content-hashed display variants", () => {
  const manifests = readdirSync("src/lib/adstudio/template-gallery").filter((file) =>
    file.endsWith(".json") && file !== "quality-locks.json",
  );
  for (const file of manifests) {
    const manifest = JSON.parse(
      read(`src/lib/adstudio/template-gallery/${file}`),
    ) as {
      sample: { imageSrc: string; thumbnailSrc: string; contentHash: string };
    };
    assert.equal(manifest.sample.thumbnailSrc, manifest.sample.imageSrc);
    for (const profile of ["320", "640"] as const) {
      const path = `public/adstudio-thumbnails/meta/${manifest.sample.contentHash}-${profile}.webp`;
      assert.ok(statSync(path).size <= 100_000, path);
    }
    const preview = `public/adstudio-thumbnails/meta/${manifest.sample.contentHash}-preview.webp`;
    assert.ok(statSync(preview).size <= 300_000, preview);
  }
});

test("bulk private media signing rejects cross-workspace paths and is request-bounded", () => {
  assert.equal(ADSTUDIO_MEDIA_URL_LIMIT, 100);
  assert.equal(isWorkspaceMediaPath("workspace-a", "workspace-a/assets/example.webp"), true);
  assert.equal(isWorkspaceMediaPath("workspace-a", "workspace-b/assets/example.webp"), false);
  assert.equal(isWorkspaceMediaPath("workspace-a", "workspace-a/../secret"), false);
});
