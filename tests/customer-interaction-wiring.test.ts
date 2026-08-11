import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

test("every primary customer navigation destination has a live page", () => {
  const routePages: Record<string, string> = {
    "/self-serve": "src/app/(customer)/self-serve/page.tsx",
    "/results": "src/app/(customer)/results/page.tsx",
    "/ad-radar": "src/app/(customer)/ad-radar/page.tsx",
    "/ad-studio": "src/app/(customer)/ad-studio/page.tsx",
    "/ad-studio/library": "src/app/(customer)/ad-studio/library/page.tsx",
    "/ad-studio/brand": "src/app/(customer)/ad-studio/brand/page.tsx",
    "/property-check": "src/app/(customer)/property-check/page.tsx",
    "/leads": "src/app/(customer)/leads/page.tsx",
    "/settings": "src/app/(customer)/settings/page.tsx",
  };

  for (const [route, page] of Object.entries(routePages)) {
    assert.equal(existsSync(page), true, `${route} should resolve to ${page}`);
  }
});

test("Ad Radar distinguishes request failures from empty results and offers retry", () => {
  const panel = read("src/components/research/ad-radar-search-panel.tsx");

  assert.match(panel, /if \(!res\.ok\) throw new Error\(searchFailureMessage\(res\.status\)\)/);
  assert.match(panel, /const \[searchError, setSearchError\]/);
  assert.match(panel, /role="alert"/);
  assert.match(panel, /Your search is still here/);
  assert.match(panel, /Trying again…|Try again/);
  assert.match(panel, /new AbortController\(\)/);
  assert.doesNotMatch(panel, /res\.ok \? await res\.json\(\) : \{ cards: \[\] \}/);
});

test("Ad Radar save failures remain visible and retryable", () => {
  const actions = read("src/components/research/ad-card-actions.tsx");

  assert.match(actions, /const \[errorMessage, setErrorMessage\]/);
  assert.match(actions, /Try saving again/);
  assert.match(actions, /aria-live="polite"/);
  assert.match(actions, /This ad cannot be saved yet/);
  assert.doesNotMatch(actions, /Action failed/);
});

test("compact Ad Studio keeps canonical customer destinations", () => {
  const flow = read("src/components/adstudio/ad-studio-customer-flow.tsx");
  const legacyLibrary = read("src/app/(customer)/ad-studio/library/page.tsx");
  const niche = read("src/config/niche/blockwise.ts");

  assert.match(flow, /href="\/self-serve"/);
  assert.doesNotMatch(flow, /href="\/ad-studio\/library"/);
  assert.match(legacyLibrary, /redirect\("\/ad-studio"\)/);
  assert.match(niche, /href: "\/ad-studio\/brand", label: "Brand Pack"/);
});

test("starter campaigns cannot open Edit or Publish before a clone exists", () => {
  const flow = read("src/components/adstudio/ad-studio-customer-flow.tsx");
  assert.match(flow, /const canEdit = hasFinishedPlacement\(pack, "4:5"\) \|\| hasFinishedPlacement\(pack, "9:16"\)/);
  assert.match(flow, /return Boolean\(creative\?\.activeRevisionId && creativeSource\(creative\)\)/);
  assert.match(flow, /const disabled = item\.id !== "create" && !canEdit/);
});
