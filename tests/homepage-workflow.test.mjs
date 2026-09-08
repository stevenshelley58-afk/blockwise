import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WORKFLOW_AD,
  WORKFLOW_REVIEW,
  WORKFLOW_STEPS,
  WORKFLOW_TEMPLATES,
} from "../src/lib/homepage-concept/workflow.ts";

test("workflow is one coherent three-step appraisal campaign", () => {
  assert.deepEqual(WORKFLOW_STEPS.map((step) => step.label), ["Choose", "Customise", "Budget & review"]);
  assert.equal(WORKFLOW_AD.campaign, "Free property appraisal");
  assert.equal(WORKFLOW_AD.agency, "West Coast Home Co");
  assert.equal(WORKFLOW_AD.defaultTitle, "Free property appraisal");
  assert.equal(WORKFLOW_TEMPLATES.length, 3);
  assert.ok(WORKFLOW_TEMPLATES.every((template) => template.detail === "Property appraisal"));
  assert.ok(WORKFLOW_TEMPLATES.every((template) => template.image.startsWith("/home/")));
});

test("budget review keeps transparent, bounded local settings", () => {
  assert.deepEqual(WORKFLOW_REVIEW.durations, [7, 14, 30]);
  assert.equal(WORKFLOW_REVIEW.defaultDailyBudget * WORKFLOW_REVIEW.defaultDuration, 280);
  assert.ok(WORKFLOW_REVIEW.minDailyBudget < WORKFLOW_REVIEW.defaultDailyBudget);
  assert.ok(WORKFLOW_REVIEW.maxDailyBudget > WORKFLOW_REVIEW.defaultDailyBudget);
});

test("workflow uses real local controls and no external side effects", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");

  for (const required of [
    "Example only",
    "Choose a template",
    "Customise the message",
    "Budget &amp; review",
    "Planned Meta ad spend",
    "Approve this example",
    "Nothing is saved, published or sent to Meta.",
    "TRIAL_SIGNUP_URL",
    "TRIAL_CTA_LABEL",
  ]) assert.ok(source.includes(required), required);

  assert.match(source, /<textarea/);
  assert.match(source, /type="range"/);
  assert.match(source, /<select/);
  assert.match(source, /aria-pressed=\{approved\}/);
  assert.doesNotMatch(source, /useEffect|setTimeout|setInterval|fetch\(|localStorage|sessionStorage|supabase|sendBeacon|mailto:|tel:|\u2014/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /font-size: 16px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /transition:\s*all/);
});
