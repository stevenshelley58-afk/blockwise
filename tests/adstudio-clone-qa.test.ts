import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  cloneQaCorrectionPrompt,
  cloneQaPassed,
  cloneQaWarnings,
  normalizeRenderedText,
} from "../src/lib/adstudio/clone-qa.ts";

test("normalizeRenderedText is lenient on case/punctuation but not words", () => {
  assert.equal(
    normalizeRenderedText("Open Home — Saturday, 10:30am!"),
    normalizeRenderedText("open home saturday 10:30am"),
  );
  assert.notEqual(
    normalizeRenderedText("18 Smith St Scarborough"),
    normalizeRenderedText("18 Smyth St Scarborough"),
  );
});

test("cloneQaPassed requires every copy check exact and zero defects", () => {
  const good = {
    copyChecks: [
      { key: "headline", expected: "A", rendered: "A", exact: true },
      { key: "cta_text", expected: "B", rendered: "B", exact: true },
    ],
    defects: [],
  };
  assert.equal(cloneQaPassed(good), true);
  assert.equal(cloneQaPassed({ ...good, defects: ["warped roofline"] }), false);
  assert.equal(
    cloneQaPassed({
      ...good,
      copyChecks: [{ key: "headline", expected: "A", rendered: "typo", exact: false }],
    }),
    false,
  );
});

test("correction prompt names each mismatch with the exact expected string", () => {
  const prompt = cloneQaCorrectionPrompt({
    copyChecks: [
      { key: "headline", expected: "Scarborough open home", rendered: "Scarborough open home", exact: false },
      { key: "cta_text", expected: "Book now", rendered: "Book now", exact: true },
    ],
    defects: ["cut-off text at bottom edge"],
  });
  assert.match(prompt, /headline must read EXACTLY "Scarborough open home"/);
  assert.match(prompt, /previous attempt rendered "Scarborough open home"/);
  assert.match(prompt, /fix: cut-off text at bottom edge/);
  assert.doesNotMatch(prompt, /Book now.*EXACTLY/);
});

test("cloneQaWarnings formats copy mismatches as editable warnings", () => {
  assert.deepEqual(
    cloneQaWarnings({
      copyChecks: [
        { key: "headline", expected: "just isted", rendered: "JUST LISTED", exact: false },
        { key: "phone", expected: "0412 000 000", rendered: "", exact: false },
        { key: "address", expected: "18 Smith St", rendered: "18 Smith St", exact: true },
      ],
    }),
    [
      'You typed "just isted" - the ad shows "JUST LISTED". Click the text on the ad to change it.',
      '"Phone" may be missing from the ad - check the image.',
    ],
  );
});

test("clone route runs cascade + QA reroll and never ships an unverified clone silently", () => {
  const route = readFileSync("src/app/api/adstudio/generate-clone/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/clone-generation.ts", "utf8");

  // Provider cascade from the model-profile registry, not a single hardcoded vendor.
  assert.match(generation, /tier === "preview" \? "image_draft" : "image_final"/);
  assert.match(generation, /createImageProviderForCandidate/);
  assert.match(generation, /createOpenAiImageProvider\(\)/);
  assert.match(generation, /recordAdStudioProviderRun/);
  assert.match(route, /resolveCloneProviders\(tier\)/);
  assert.doesNotMatch(route, /createFalImageProvider|fal-image-provider|FAL_KEY/);

  // Every generation is QA'd; failures reroll with a correction, and a clone
  // that still fails returns 502 with the report instead of shipping.
  assert.match(route, /runCloneQa/);
  assert.match(route, /cloneQaCorrectionPrompt/);
  assert.match(route, /status: 502/);
  assert.match(route, /runComplianceGate/);
});

test("targeted edit endpoint anchors on the current image and re-verifies the whole ad", () => {
  const route = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");
  const builder = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");

  // The anchor is the CURRENT creative image, never the template sample.
  assert.match(builder, /buildTargetedEditRequest/);
  assert.match(builder, /exactly identical to reference image 1/);
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /resolveCloneProviders\("preview"\)/);

  // Expected copy carries forward from the last verdict with the edited field
  // overridden, so unrelated drift fails QA too.
  assert.match(route, /canvas\.cloneQa\?\.copyChecks/);
  assert.match(route, /expectedCopy\[fieldKey\] = newValue/);

  // Undo history and a real failure mode.
  assert.match(route, /renderHistory/);
  assert.match(route, /status: 502/);
});

test("clone QA verdict and regions persist on the clone creative", () => {
  const generator = readFileSync("src/lib/adstudio/generator.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");

  assert.match(generator, /cloneQa: input\.cloneQa/);
  assert.match(generator, /templateCloneQaByFormat: input\.firstAd\?\.templateCloneQaByFormat/);
  // The server pipeline feeds advisory QA into the pack build and never throws
  // when the verdict is failed.
  assert.match(generation, /templateCloneQa: primaryClone\.qa \?\? undefined/);
  assert.match(generation, /templateCloneQaByFormat/);
  assert.match(generation, /annotateCloneQa/);
  assert.match(generation, /catch \(error\)[\s\S]*return null;/);
  assert.doesNotMatch(generation, /qa && !qa\.passed[\s\S]*throw/);
  assert.doesNotMatch(generation, new RegExp("TemplateCampaignQa" + "Error"));
  assert.doesNotMatch(generation, /cloneQaCorrectionPrompt/);
});
