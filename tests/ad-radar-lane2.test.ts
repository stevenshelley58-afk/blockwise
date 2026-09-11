import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Ad Radar search keeps query and filters in browser history state", () => {
  const source = read("src/components/research/ad-radar-search-panel.tsx");
  assert.match(source, /url\.searchParams\.set\("q", q\.trim\(\)\)/);
  assert.match(source, /url\.searchParams\.set\("agency", nextFilters\.agency\)/);
  assert.match(source, /history\.pushState\(state/);
  assert.match(source, /history\.replaceState\(state/);
  assert.match(source, /addEventListener\("popstate", restoreFromUrl\)/);
  assert.match(source, /initialValue=\{query\}/);
});

test("Saved inspiration never renders an empty collection beside a load error", () => {
  const source = read("src/app/(customer)/ad-radar/swipe-file/page.tsx");
  assert.match(source, /error || adDbError/);
  assert.ok(source.includes('href="/ad-radar/swipe-file">Retry'));
  assert.ok(source.includes("!error && !adDbError ? <section"));
});

test("Radar viewer exposes Save feedback inside the modal and keeps internal details same-tab", () => {
  const grid = read("src/components/research/ad-radar-results-grid.tsx");
  const viewer = read("src/components/ui/creative-viewer.tsx");
  assert.ok(grid.includes("actionMessage={saveError}"));
  assert.ok(grid.includes("api/research/swipe-file"));
  assert.ok(viewer.includes("actionMessage?: string | null"));
  assert.ok(viewer.includes('role="status" aria-live="polite"'));
  assert.ok(viewer.includes("const external = /^https?:/iu.test"));
});

test("Ads overview only offers New ad when reviewed templates exist", () => {
  const home = read("src/components/adstudio/home-command.tsx");
  const page = read("src/app/(customer)/ad-studio/page.tsx");
  // The page only needs `length > 0` to decide whether to offer New ad, so it
  // uses the existence probe instead of loading the whole template library:
  // listTemplates selects template_json for every active template, which
  // measured 929 kB of JSON per request to answer a boolean.
  assert.match(page, /hasActiveTemplates\(supabase\)/);
  assert.match(page, /hasAvailableTemplates/);
  assert.match(home, /hasAvailableTemplates ?/);
  assert.match(home, /Review Brand Pack/);
});

test("Empty libraries do not expose zero-count filter controls", () => {
  const ads = read("src/components/adstudio/ads-library.tsx");
  const media = read("src/components/adstudio/media-library.tsx");
  assert.ok(ads.includes("ads.length > 0 ? <>"));
  assert.ok(media.includes("allAssets.length > 0 ? <>"));
});


test("Library image previews degrade to bounded accessible fallbacks", () => {
  const safeImage = read("src/components/ui/safe-image.tsx");
  assert.match(safeImage, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(safeImage, /Preview unavailable/);
  assert.match(safeImage, /aria-label=\{accessibleLabel\}/);
  assert.match(safeImage, /compactFallback/);
});
