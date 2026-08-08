// Meta frame behaviour bar (Track B, §8) — source-contract form, matching how
// the repo's chrome tests assert (the repo has no JSX-under-node-test runner;
// real rendered output is pinned by the Playwright /dev/meta-frames harness).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const metaFrame = readFileSync("src/components/adstudio/meta-frame/meta-frame.tsx", "utf8");
const mobile = readFileSync("src/components/adstudio/meta-frame/fb-feed-mobile.tsx", "utf8");
const desktop = readFileSync("src/components/adstudio/meta-frame/fb-feed-desktop.tsx", "utf8");
const igFeed = readFileSync("src/components/adstudio/meta-frame/ig-feed.tsx", "utf8");
const stories = readFileSync("src/components/adstudio/meta-frame/stories.tsx", "utf8");
const overlay = readFileSync("src/components/adstudio/meta-frame/safe-zone-overlay.tsx", "utf8");
const bits = readFileSync("src/components/adstudio/meta-frame/frame-bits.tsx", "utf8");
const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const page = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
const proxy = readFileSync("src/app/api/adstudio/meta-preview/route.ts", "utf8");

test("all six documented placements exist and the picker exposes them", () => {
  assert.match(mobile, /export function FbFeedMobileFrame/);
  assert.match(desktop, /export function FbFeedDesktopFrame/);
  assert.match(igFeed, /export function IgFeedFrame/);
  assert.match(stories, /export function IgStoryFrame/);
  assert.match(stories, /export function FbStoryFrame/);
  assert.match(stories, /export function IgReelsFrame/);
  for (const id of ["fb-feed-mobile", "fb-feed-desktop", "ig-feed", "ig-story", "fb-story", "ig-reels"]) {
    assert.ok(metaFrame.includes(`"${id}"`), `picker offers ${id}`);
  }
  // Picker is the shadcn Tabs primitive, not a hand-rolled control.
  assert.match(metaFrame, /from "@\/components\/ui\/tabs"/);
});

test("frames bind live copy through the truncation module, not raw strings", () => {
  assert.match(mobile, /formatMetaPrimaryText\(copy\.primaryText\)/);
  assert.match(mobile, /truncateHeadline\(copy\.headline\)/);
  assert.match(desktop, /formatMetaPrimaryText\(copy\.primaryText\)/);
  assert.match(igFeed, /truncateIgCaption/);
  assert.match(stories, /truncateStoryPrimary\(copy\.primaryText\)/);
  // The See more interaction renders, not just a flat ellipsis.
  assert.match(mobile, /primary\.suffix/);
});

test("copy elements are keyboard-reachable buttons wired to the edit fields", () => {
  assert.match(bits, /<button/);
  assert.match(bits, /aria-pressed=\{selectedElement === element\}/);
  assert.match(bits, /onSelectText\?\.\(element\)/);
});

test("chrome is Meta's own visual language, not Blockwise tokens or styles.ts", () => {
  // Meta's measured values ported from the old .studio-metachrome CSS.
  assert.match(mobile, /#65676b/);
  assert.match(mobile, /#f0f2f5/);
  assert.match(mobile, /#e4e6eb/);
  assert.match(mobile, /Sponsored/);
  assert.match(stories, /linear-gradient\(180deg, rgba\(0,0,0,0\.42\)/);
  // No additions to the legacy CSS-in-TS module or globals.
  assert.doesNotMatch(mobile, /studio-metachrome/);
  assert.doesNotMatch(bits, /from "\.\/\.\.\/styles"/);
});

test("story safe zones use the Appendix A numbers with the Reels band", () => {
  assert.match(overlay, /STORY_SAFE_TOP_PX = 250/);
  assert.match(overlay, /STORY_SAFE_BOTTOM_PX = 340/);
  assert.match(overlay, /REELS_BOTTOM_CLEARANCE_PX = 672/);
  assert.match(overlay, /pointer-events-none/);
});

test("workbench swaps MetaChromePreview for MetaFrame only behind the flag", () => {
  assert.match(page, /useV2Frames=\{adstudioTemplatesV2Enabled\(\)\}/);
  assert.match(workbench, /const frameChrome = useV2Frames \?/);
  assert.match(workbench, /<MetaFrame/);
  assert.match(workbench, /<MetaChromePreview/);
});

test("generatepreviews proxy is on-demand, workspace-fenced, format-guarded", () => {
  assert.match(proxy, /requireAdStudioRequest/);
  assert.match(proxy, /listProviderConnections/);
  assert.match(proxy, /loadStoredProviderTokens/);
  // All seven documented formats; anything else falls back, never crashes.
  for (const format of [
    "MOBILE_FEED_STANDARD",
    "DESKTOP_FEED_STANDARD",
    "INSTAGRAM_STANDARD",
    "INSTAGRAM_STORY",
    "FACEBOOK_STORY_MOBILE",
    "INSTAGRAM_REELS",
    "RIGHT_COLUMN_STANDARD",
  ]) {
    assert.ok(proxy.includes(format), `proxy accepts ${format}`);
  }
  // On-demand only — nothing calls Meta automatically on load.
  assert.doesNotMatch(proxy, /export async function GET/);
});
