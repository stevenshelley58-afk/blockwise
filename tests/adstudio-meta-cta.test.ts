import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { labelForMetaCta, remapLegacyMetaCta, toMetaCta } from "../src/lib/adstudio/meta-cta.ts";
import { findCopyLimitViolations, findPackCopyLimitViolations } from "../src/lib/adstudio/readiness.ts";

test("one CTA mapper: labels map consistently onto the lead-ads subset", () => {
  assert.equal(toMetaCta("Book an appraisal"), "GET_QUOTE");
  assert.equal(toMetaCta("Request price update"), "GET_QUOTE");
  assert.equal(toMetaCta("Apply for tenancy"), "APPLY_NOW");
  assert.equal(toMetaCta("Subscribe to updates"), "SUBSCRIBE");
  assert.equal(toMetaCta("Seller checklist"), "DOWNLOAD");
  assert.equal(toMetaCta("Download the guide"), "DOWNLOAD");
  assert.equal(toMetaCta("Sign up"), "SIGN_UP");
  assert.equal(toMetaCta("Anything else"), "LEARN_MORE");
  // The documented lead-ads subset has no CONTACT_US; the keyword mapper
  // treats "contact us" copy as quote-shaped.
  assert.equal(toMetaCta("CONTACT_US"), "GET_QUOTE");
  assert.equal(labelForMetaCta("DOWNLOAD"), "Download");
  assert.equal(labelForMetaCta("GET_QUOTE"), "Get quote");
  assert.equal(labelForMetaCta("CONTACT_US"), "Contact us");
});

test("legacy CONTACT_US packs remap to LEARN_MORE at payload build", () => {
  assert.equal(remapLegacyMetaCta("CONTACT_US"), "LEARN_MORE");
  assert.equal(remapLegacyMetaCta("GET_QUOTE"), "GET_QUOTE");
  assert.equal(remapLegacyMetaCta("SIGN_UP"), "SIGN_UP");
});

test("no divergent CTA keyword maps remain", () => {
  for (const file of [
    "src/components/adstudio/use-copy.ts",
    "src/lib/adstudio/readiness.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /normalised\.includes\("download"\)|\/download\|checklist/, `${file} must delegate CTA mapping to meta-cta.ts`);
  }
});

test("over-limit copy blocks export and publish", () => {
  const violations = findCopyLimitViolations({
    primaryText: "x".repeat(130),
    headline: "ok",
    description: "ok",
    cta: "ok",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /primaryText is 130 characters \(Meta limit 125\)/);

  const packViolations = findPackCopyLimitViolations({
    copyPacks: [
      { meta: { primaryText: ["fine"], headlines: ["y".repeat(50)], descriptions: ["fine"] } },
    ],
  });
  assert.equal(packViolations.length, 1);
  assert.match(packViolations[0], /headline is 50 characters/);

  const publishRoute = readFileSync("src/app/api/adstudio/export-packages/[id]/publish/route.ts", "utf8");
  assert.match(publishRoute, /findPackCopyLimitViolations/);
  assert.match(publishRoute, /status: 422/);

  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  assert.match(actions, /findCopyLimitViolations\(s\.copy\)/);
});
