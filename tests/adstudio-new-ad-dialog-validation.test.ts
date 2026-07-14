import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { briefGuidanceForTemplate } from "../src/components/adstudio/new-ad-dialog-brief.ts";
import { imageRequirementsForTemplate } from "../src/components/adstudio/new-ad-dialog-slots.ts";
import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

test("the dialog collects only the selected sample's declared inputs", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  assert.deepEqual(imageRequirementsForTemplate(template).map((slot) => slot.id), template.inputs.images.map((input) => input.key));
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  assert.match(dialog, /imageRequirementsForTemplate\(selectedTemplate\)/);
  assert.match(dialog, /customerCopyFieldsForTemplate\(selectedTemplate\)/);
  assert.doesNotMatch(dialog, /generate-options|generate-clone|Fabric|canvas\.objects/);
});
test("missing customer inputs are shown together before generation", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const submit = dialog.slice(dialog.indexOf("async function submit()"), dialog.indexOf("const stepTitle ="));
  assert.match(dialog, /function buildRequirementBlockers/);
  assert.match(dialog, /role="alert" aria-live="assertive"/);
  assert.match(dialog, /missingImageLabels/);
  assert.match(dialog, /missingCopyLabels/);
  assert.match(submit, /buildRequirementBlockers/);
});

test("the server owns clone generation and the client waits for the finished ad", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  assert.doesNotMatch(dialog, /templateCloneImage|\/api\/adstudio\/copy/);
  assert.match(route, /runTemplateCampaignGeneration/);
  assert.match(route, /status: 202/);
  assert.doesNotMatch(route, /generateAdStudioCampaignPack\(\{/);
  assert.match(actions, /\/api\/adstudio\/jobs\//);
  assert.match(actions, /Your ad is ready to edit/);
  assert.match(generation, /buildTemplateCloneRequestsByFormat/);
  assert.match(generation, /runCloneQa/);
  assert.match(generation, /persistAdStudioCampaignPack/);
});

test("goal-specific guidance does not introduce a second template recipe", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  const guidance = briefGuidanceForTemplate(template);
  assert.equal(guidance.fieldLabel, "Listing details");
  assert.match(guidance.note, /sample details stay as examples only/);
  assert.equal(briefGuidanceForTemplate(undefined).fieldLabel, "Short description");
});
