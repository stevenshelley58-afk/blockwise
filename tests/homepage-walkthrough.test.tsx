import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";

import { ResultsWalkthrough } from "../src/components/homepage-concept/results-walkthrough.tsx";
import { WALKTHROUGH_STEPS } from "../src/lib/homepage-concept/walkthrough.ts";

test("the walkthrough explains the complete workflow before any interaction", () => {
  assert.deepEqual(WALKTHROUGH_STEPS.map((step) => step.id), ["create", "approve", "enquiries"]);
  assert.equal(new Set(WALKTHROUGH_STEPS.map((step) => step.id)).size, 3);
  for (const step of WALKTHROUGH_STEPS) {
    assert.ok(step.label.trim());
    assert.ok(step.title.trim());
    assert.ok(step.body.trim());
  }
  const html = renderToStaticMarkup(createElement(ResultsWalkthrough));
  for (const step of WALKTHROUGH_STEPS) assert.ok(html.includes(step.label));
  assert.match(html, /Less managing ads\. More meeting sellers\./);
  assert.match(html, /Example data/);
  assert.match(html, /href="#trial"/);
  assert.match(html, /No card required/);
  assert.match(html, /id="results"/);
  assert.doesNotMatch(html, /style="opacity:0(?:;|")/);
  assert.doesNotMatch(html, /href="(?:mailto:|tel:)/);
});

test("the walkthrough remains a secret-free client-side illustration", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/results-walkthrough.tsx", import.meta.url), "utf8");
  const fixture = await readFile(new URL("../src/lib/homepage-concept/walkthrough.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source + fixture, /fetch\s*\(|localStorage|sessionStorage|supabase|sendBeacon|setInterval/);
  assert.match(source, /useReducedMotion/);
  assert.doesNotMatch(source, /className="[^"]*hc-screen/);
});
