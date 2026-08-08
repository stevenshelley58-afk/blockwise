import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { labelForMetaCta, toMetaCta } from "../src/lib/adstudio/meta-cta.ts";
import { findCopyLimitViolations, findPackCopyLimitViolations } from "../src/lib/adstudio/readiness.ts";

test("one CTA mapper: labels map consistently, enum passthrough works", () => {
  assert.equal(toMetaCta("Book an appraisal"), "CONTACT_US");
  assert.equal(toMetaCta("Request price update"), "CONTACT_US");
  assert.equal(toMetaCta("Seller checklist"), "DOWNLOAD");
  assert.equal(toMetaCta("Download the guide"), "DOWNLOAD");
  assert.equal(toMetaCta("Sign up"), "SIGN_UP");
  assert.equal(toMetaCta("Anything else"), "LEARN_MORE");
  assert.equal(toMetaCta("CONTACT_US"), "CONTACT_US");
  assert.equal(labelForMetaCta("DOWNLOAD"), "Download");
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
    primaryText: "x".repeat(510),
    headline: "ok",
    description: "ok",
    cta: "ok",
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /primaryText is 510 characters \(Meta limit 500\)/);

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
