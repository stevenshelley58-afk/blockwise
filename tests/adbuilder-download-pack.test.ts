import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_EXPORT_TIME_ZONE,
  DOWNLOAD_PLACEMENTS,
  adCopyFileName,
  artworkFileName,
  buildAdCopySheet,
  resolveExportTimeZone,
} from "../src/lib/adbuilder/download-pack.ts";

const exportedAt = new Date("2026-09-15T04:09:00.000Z");

const fullAd = {
  adName: "Spring listing",
  metaPrimaryText: "Book a free appraisal this week and find out what your home is worth.",
  metaHeadline: "Free home appraisal",
  metaDescription: "Local agents, no obligation.",
  metaCta: "SIGN_UP",
  destinationUrl: "https://example.com/appraisal",
  hasFeedArtwork: true,
  hasStoryArtwork: true,
  exportedAt,
};

test("artwork file names match the names the library already downloads", () => {
  assert.equal(artworkFileName("Spring listing", "feed"), "Spring_listing-feed.png");
  assert.equal(artworkFileName("Spring listing", "story"), "Spring_listing-story.png");
});

test("artwork file names fall back when the ad has no usable name", () => {
  assert.equal(artworkFileName("", "feed"), "blockwise-ad-feed.png");
  assert.equal(artworkFileName("///", "story"), "blockwise-ad-story.png");
});

test("copy sheet file name is safe and always has a fallback", () => {
  assert.equal(adCopyFileName("Spring listing"), "Spring_listing-ad-copy.txt");
  assert.equal(adCopyFileName("   "), "blockwise-ad-copy.txt");
  assert.equal(adCopyFileName('x"\r\nSet-Cookie: bad'), "x___Set-Cookie__bad-ad-copy.txt");
});

test("the pack names both placements at their real render sizes", () => {
  assert.deepEqual(
    DOWNLOAD_PLACEMENTS.map(entry => [entry.placement, entry.width, entry.height]),
    [["feed", 1080, 1350], ["story", 1080, 1920]],
  );
});

test("copy sheet carries the ad copy, button label and website URL", () => {
  const sheet = buildAdCopySheet(fullAd);
  assert.match(sheet, /^Blockwise ad export\n/);
  assert.match(sheet, /Ad: Spring listing/);
  assert.match(sheet, /Free home appraisal/);
  assert.match(sheet, /Book a free appraisal this week/);
  assert.match(sheet, /Local agents, no obligation\./);
  // The stored value is the Meta enum; the customer must read the button label.
  assert.match(sheet, /Call to action button\nSign up/);
  assert.doesNotMatch(sheet, /SIGN_UP/);
  assert.match(sheet, /Website URL\nhttps:\/\/example\.com\/appraisal/);
});

test("copy sheet names the artwork files and their dimensions", () => {
  const sheet = buildAdCopySheet(fullAd);
  assert.match(sheet, /Feed image: Spring_listing-feed\.png \(1080 x 1350\)/);
  assert.match(sheet, /Story image: Spring_listing-story\.png \(1080 x 1920\)/);
});

test("copy sheet omits sections the customer has not filled in", () => {
  const sheet = buildAdCopySheet({
    ...fullAd,
    metaPrimaryText: "",
    metaDescription: "   ",
    destinationUrl: null,
  });
  assert.doesNotMatch(sheet, /Primary text/);
  assert.doesNotMatch(sheet, /Description/);
  assert.doesNotMatch(sheet, /Website URL/);
  // The sections that do have content survive.
  assert.match(sheet, /Headline\nFree home appraisal/);
  assert.match(sheet, /Call to action button/);
});

test("copy sheet does not promise artwork that was never saved", () => {
  const sheet = buildAdCopySheet({ ...fullAd, hasFeedArtwork: false, hasStoryArtwork: false });
  assert.doesNotMatch(sheet, /Creative files/);
  assert.doesNotMatch(sheet, /\.png/);
});

test("copy sheet names only the placement that was saved", () => {
  const sheet = buildAdCopySheet({ ...fullAd, hasStoryArtwork: false });
  assert.match(sheet, /Feed image:/);
  assert.doesNotMatch(sheet, /Story image:/);
});

test("copy sheet tells the customer Meta bills their own payment method", () => {
  const sheet = buildAdCopySheet(fullAd);
  assert.match(sheet, /Running this ad yourself/);
  assert.match(sheet, /Meta charges ad spend directly to your own payment method/);
});

test("copy sheet states the export time in the workspace time zone", () => {
  const perth = buildAdCopySheet({ ...fullAd, timeZone: "Australia/Perth" });
  // 04:09 UTC on 15 September is the same afternoon in Perth.
  assert.match(perth, /Exported: 15 September 2026 at 12:09 pm/);
  const sydney = buildAdCopySheet({ ...fullAd, timeZone: "Australia/Sydney" });
  assert.match(sydney, /Exported: 15 September 2026 at 2:09 pm/);
});

test("an unusable export time zone falls back instead of throwing", () => {
  assert.equal(resolveExportTimeZone("Not/AZone"), DEFAULT_EXPORT_TIME_ZONE);
  assert.equal(resolveExportTimeZone(""), DEFAULT_EXPORT_TIME_ZONE);
  assert.equal(resolveExportTimeZone(undefined), DEFAULT_EXPORT_TIME_ZONE);
  assert.equal(resolveExportTimeZone("  Australia/Perth  "), "Australia/Perth");
  assert.doesNotThrow(() => buildAdCopySheet({ ...fullAd, timeZone: "Not/AZone" }));
});

test("copy sheet collapses a multi-line ad name onto one line", () => {
  const sheet = buildAdCopySheet({ ...fullAd, adName: "Spring\nlisting  ad" });
  assert.match(sheet, /Ad: Spring listing ad\n/);
});

test("copy sheet contains no em dashes or unresolved placeholders", () => {
  const sheet = buildAdCopySheet(fullAd);
  assert.doesNotMatch(sheet, /—/u);
  assert.doesNotMatch(sheet, /\{\{|\}\}|TODO|undefined|null/);
});

test("an ad with no saved revision and no copy still produces a readable sheet", () => {
  const sheet = buildAdCopySheet({
    adName: "Untitled ad",
    metaPrimaryText: "",
    metaHeadline: "",
    metaDescription: "",
    metaCta: "",
    destinationUrl: null,
    hasFeedArtwork: false,
    hasStoryArtwork: false,
    exportedAt,
  });
  assert.match(sheet, /Ad: Untitled ad/);
  assert.match(sheet, /Running this ad yourself/);
});

// ---------------------------------------------------------------------------
// Wiring guards. These read the shipped route so the export cannot silently
// start depending on billing, a subscription or a Meta connection.
// ---------------------------------------------------------------------------

function readRoute(): string {
  return readFileSync(
    new URL("../src/app/api/adbuilder/ads/[id]/copy/route.ts", import.meta.url),
    "utf8",
  );
}

test("the copy export is reachable with workspace access alone", () => {
  const source = readRoute();
  assert.match(source, /requireAdBuilderRequest/);
  for (const forbidden of [
    "billing_access_state",
    "stripe_subscription",
    "requireApiWorkspace",
    "evaluateCheckoutRequest",
    "provider_connections",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden), `copy export must not require ${forbidden}`);
  }
});

test("the copy export refuses to hand over a pack that was never saved", () => {
  const source = readRoute();
  assert.match(source, /active_revision_id/);
  assert.match(source, /ad_not_saved/);
});

test("the copy export stays inside the requesting workspace", () => {
  const source = readRoute();
  const scoping = source.match(/\.eq\("workspace_id", access\.access\.workspaceId\)/g) ?? [];
  assert.equal(scoping.length, 2, "both the ad and the revision read must be workspace scoped");
});

test("the copy export is served as a downloadable text file", () => {
  const source = readRoute();
  assert.match(source, /"content-type": "text\/plain; charset=utf-8"/);
  assert.match(source, /"cache-control": "private, no-store"/);
  assert.match(source, /content-disposition/);
  assert.match(source, /adCopyFileName/);
});

test("artwork download stays on the existing workspace-scoped media route", () => {
  const source = readRoute();
  assert.doesNotMatch(source, /workspace-artifacts/);
  assert.doesNotMatch(source, /storage\.from/);
});

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("the artwork download route needs workspace access alone", () => {
  const source = readSource("../src/app/api/adbuilder/media/route.ts");
  assert.match(source, /requireAdBuilderRequest/);
  for (const forbidden of ["billing_access_state", "stripe_subscription", "provider_connections"]) {
    assert.doesNotMatch(source, new RegExp(forbidden), `artwork download must not require ${forbidden}`);
  }
  // The stored path must stay inside the caller's own workspace prefix.
  assert.match(source, /path\.startsWith\(`\$\{access\.access\.workspaceId\}\/`\)/);
  assert.match(source, /path\.includes\("\.\."\)/);
});

test("the pack component points at the two no-card download routes", () => {
  const source = readSource("../src/components/adbuilder/download-ad-pack.tsx");
  assert.match(source, /\/api\/adbuilder\/media\?workspaceId=/);
  assert.match(source, /\/copy\?workspaceId=/);
  // File names come from one place, so a download never disagrees with the sheet.
  assert.match(source, /artworkFileName\(adName/);
  assert.doesNotMatch(source, /-feed\.png`/);
});

test("both the library and the publish review offer the pack", () => {
  const library = readSource("../src/components/adbuilder/ads-library.tsx");
  assert.match(library, /<DownloadAdPack/);
  assert.match(library, /variant="inline"/);
  // The library must not keep a second, divergent copy of the download URLs.
  assert.doesNotMatch(library, /api\/adbuilder\/media/);

  const publishFlow = readSource(
    "../src/app/(customer)/ad-builder/templates/[templateId]/publish/publish-flow.tsx",
  );
  assert.match(publishFlow, /<DownloadAdPack/);
  assert.match(publishFlow, /variant="panel"/);
  // Only a saved revision has artwork to hand over.
  assert.match(publishFlow, /initialState \? <div className="pt-4"><DownloadAdPack/);
});

test("the library passes the owning workspace into the pack", () => {
  const library = readSource("../src/components/adbuilder/ads-library.tsx");
  assert.match(library, /workspaceId: string/);
  assert.match(library, /<AdCard key=\{ad\.adId\} ad=\{ad\} workspaceId=\{workspaceId\} \/>/);
});
