import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveTemplateSampleStyle,
  isSafeTemplateCardImagePath,
  sampleCardImagePath,
  sampleCopyForTemplate,
  sampleVarianceErrors,
  sampleVarianceSummary,
  templateCardPublicUrl,
} from "../src/lib/adstudio/template-samples.ts";

const seed = JSON.parse(readFileSync("ad-template-library/library-seed.json", "utf8")) as {
  templates: Array<Record<string, unknown>>;
};

test("template sample style assignment meets the required creative variance", () => {
  const summary = sampleVarianceSummary(seed.templates);

  assert.equal(summary.total, 45);
  assert.deepEqual(sampleVarianceErrors(seed.templates), []);
  assert.ok(summary.noPerson >= 9);
  assert.ok(summary.agentLed >= 9);
  assert.ok(summary.propertyOnly >= 9);
  assert.ok(summary.minimalCopy >= 9);
  assert.ok(summary.textHeavy >= 9);
  assert.ok(summary.organic >= 7);
  assert.ok(summary.superPremium >= 7);
  assert.ok(summary.olderAffordable >= 7);
  assert.ok(summary.newLuxury >= 7);
});

test("template sample copy resolves variables and stable card paths for every seed template", () => {
  for (const [index, template] of seed.templates.entries()) {
    const style = deriveTemplateSampleStyle(template, index);
    const copy = sampleCopyForTemplate(template, style);
    const key = String(template.template_key);

    assert.equal(style.sampleCardImagePath, sampleCardImagePath(key));
    assert.ok(copy?.headline);
    assert.ok(copy?.primaryText);
    assert.ok(copy?.description);
    assert.ok(copy?.cta);
    assert.doesNotMatch(Object.values(copy ?? {}).join(" "), /\{\{[^}]+\}\}/);
  }
});

test("template card URLs are constrained to generated template-card paths", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
  try {
    assert.equal(isSafeTemplateCardImagePath("adstudio-samples/v1/hv-01.png"), true);
    assert.equal(isSafeTemplateCardImagePath("https://cdn.example/observed.png"), false);
    assert.equal(isSafeTemplateCardImagePath("../observed.png"), false);
    assert.equal(
      templateCardPublicUrl("adstudio-samples/v1/hv-01.png"),
      "https://supabase.example/storage/v1/object/public/template-cards/adstudio-samples/v1/hv-01.png",
    );
    assert.equal(templateCardPublicUrl("https://cdn.example/observed.png"), undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  }
});

test("template card renderer verifies generated image dimensions and unresolved variables", () => {
  const renderer = readFileSync("scripts/adstudio-render-template-cards.py", "utf8");

  assert.match(renderer, /def verify_outputs/);
  assert.match(renderer, /image\.size != \(W, H\)/);
  assert.match(renderer, /Unresolved variables/);
  assert.match(renderer, /BUCKET = "template-cards"/);
});
