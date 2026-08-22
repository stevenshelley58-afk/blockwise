// Template Studio contracts (Track C, §5.2): operator-only API, dev-only
// writes, and the approve law (human confirmation + full gate).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const detail = readFileSync(join("src", "app", "api", "operator", "template-studio", "[id]", "route.ts"), "utf8");
const queue = readFileSync(join("src", "app", "api", "operator", "template-studio", "route.ts"), "utf8");
const source = readFileSync(join("src", "app", "api", "operator", "template-studio", "source", "route.ts"), "utf8");
const studioLib = readFileSync(join("src", "lib", "adstudio", "v2", "studio.ts"), "utf8");
const studioQueueLib = readFileSync(join("src", "lib", "adstudio", "v2", "studio-queue.ts"), "utf8");
const queuePage = readFileSync(join("src", "app", "(operator)", "operator", "template-studio", "page.tsx"), "utf8");
const screen = readFileSync(join("src", "components", "operator", "template-studio-client.tsx"), "utf8");

test("studio API is operator-gated and dev-only for writes", () => {
  for (const file of [detail, queue, source]) {
    assert.match(file, /requireOperator\(\)/);
  }
  assert.match(detail, /studioWritesAllowed\(\)/);
  assert.match(studioLib, /NODE_ENV !== "production"/);
});

test("approve enforces the human sign-off and the full gate", () => {
  assert.match(studioLib, /confirmation checkbox required/);
  assert.match(studioLib, /story layout required/);
  assert.match(studioLib, /public sample is missing hashed safe replacement assets/);
  assert.match(studioLib, /exceeds/);
  assert.match(studioLib, /reviewEvidence/);
  assert.match(studioLib, /reviewerUserId/);
  assert.match(studioLib, /authenticated operator user ID and email/);
  assert.match(studioLib, /customer-visible editable text field/);
  assert.match(studioLib, /sourceValues\.\$\{key\}/);
});

test("queue routes use the lightweight gallery reader", () => {
  assert.match(studioQueueLib, /node:fs/);
  assert.match(studioQueueLib, /template-gallery-v2/);
  assert.doesNotMatch(studioQueueLib, /\.\/render|template-resolver|template-doc/);
  assert.match(queue, /adstudio\/v2\/studio-queue/);
  assert.match(queuePage, /adstudio\/v2\/studio-queue/);
  assert.doesNotMatch(queuePage, /adstudio\/v2\/studio["']/);
  assert.doesNotMatch(studioLib, /export function studioQueue/);
});

test("restyle only uses verified generic assets and exact safe copy", () => {
  assert.match(studioLib, /buildRestyleSampleRenderInput/);
  assert.match(studioLib, /safe sample copy for \$\{field\.key\} must differ/);
  assert.match(studioLib, /choose a verified safe replacement photo/);
  assert.match(studioLib, /hashed safe replacement assets/);
});

test("the studio screen wires diff, check, and the required confirmation", () => {
  assert.match(screen, /mix-blend-difference/);
  assert.match(screen, /action=check/);
  assert.match(screen, /action=approve/);
  assert.match(screen, /Inspected at 100% zoom; a designer would ship this\./);
  // Approval remains disabled until the human confirms every bound gate and
  // no fidelity region exceeds the release threshold.
  assert.match(screen, /disabled=\{!confirm \|\| !sourceCurated \|\| !report \|\| report\.outsideDifferingPixels !== 0 \|\| overThreshold\.length > 0 \|\| !stressMatrixHash \|\| checking\}/);
});
