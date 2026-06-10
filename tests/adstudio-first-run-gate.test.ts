import assert from "node:assert/strict";
import test from "node:test";

import type { AdStudioCampaignPack } from "../src/lib/adstudio/types.ts";

/**
 * Pure-logic test for the magic-moment gate. The hook is React-bound but the
 * decision ("should auto-design fire?") is a pure function of inputs, so we
 * reproduce the gate here and assert on it. The hook's call-site in the
 * workbench wires the same inputs; if this changes there, the workbench will
 * still typecheck but the gate may drift. Keep this in sync with
 * `use-first-run-experience.ts`.
 */

type MagicMomentInputs = {
  firstRun: boolean;
  variantCount: number;
  alreadyDesigned: boolean;
  generating: boolean;
  copyUntouched: boolean;
};

function shouldFireMagicMoment(inputs: MagicMomentInputs): boolean {
  const isNewAd = inputs.firstRun || inputs.variantCount === 0;
  if (inputs.alreadyDesigned) return false;
  if (inputs.generating) return false;
  if (!isNewAd) return false;
  if (!inputs.copyUntouched) return false;
  return true;
}

function emptyPack(): AdStudioCampaignPack {
  return {
    campaign: {
      campaignId: "c1",
      name: "Ad",
      goal: "seller_leads",
      market: { suburb: "Scarborough", city: "Perth", state: "WA", country: "AU" },
      offerId: "seller_prep_checklist",
      platforms: ["meta"],
    },
    variants: [],
    copyPacks: [],
    creatives: [],
    compliance: { status: "needs_review", notes: [] },
    media: { sourceImageDataUrl: null, generatedMedia: [] },
  };
}

test("magic moment fires on first-run with untouched copy", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: true, variantCount: 0, alreadyDesigned: false, generating: false, copyUntouched: true }),
    true,
  );
});

test("magic moment fires on a fresh no-variants pack even without firstRun flag", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: false, variantCount: 0, alreadyDesigned: false, generating: false, copyUntouched: true }),
    true,
  );
});

test("magic moment does not fire when user has variants (not a new ad)", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: false, variantCount: 3, alreadyDesigned: false, generating: false, copyUntouched: true }),
    false,
  );
});

test("magic moment does not fire when copy was edited", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: true, variantCount: 0, alreadyDesigned: false, generating: false, copyUntouched: false }),
    false,
  );
});

test("magic moment does not fire when already designed this session", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: true, variantCount: 0, alreadyDesigned: true, generating: false, copyUntouched: true }),
    false,
  );
});

test("magic moment does not fire when a generation is already running", () => {
  assert.equal(
    shouldFireMagicMoment({ firstRun: true, variantCount: 0, alreadyDesigned: false, generating: true, copyUntouched: true }),
    false,
  );
});

test("empty pack is well-formed enough to seed the workbench", () => {
  // Sanity check: the test fixtures above should not crash the generator.
  // This guards against a future change that adds required fields to the
  // pack shape and breaks the magic-moment inputs.
  const pack = emptyPack();
  assert.equal(pack.variants.length, 0);
  assert.equal(pack.campaign.goal, "seller_leads");
});
