import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { briefGuidanceForTemplate } from "../src/components/adstudio/new-ad-dialog-brief.ts";
import {
  defaultImageForTemplateSlot,
  defaultTextForTemplateField,
  imageRequirementsForTemplate,
} from "../src/components/adstudio/new-ad-dialog-slots.ts";
import { extractBrandKitFromWebsite } from "../src/lib/adstudio/brand-extraction.ts";
import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

test("the dialog collects only the selected template's declared inputs", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  assert.deepEqual(imageRequirementsForTemplate(template).map((slot) => slot.id), template.inputs.images.map((input) => input.key));
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  assert.match(dialog, /imageRequirementsForTemplate\(selectedTemplate\)/);
  assert.match(dialog, /customerCopyFieldsForTemplate\(selectedTemplate\)/);
  assert.doesNotMatch(dialog, /generate-options|generate-clone|Fabric|canvas\.objects/);
});

test("the customer flow uses template terminology and shared dropdown styling", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
  const styles = readFileSync("src/components/adstudio/styles.ts", "utf8");
  const customerCopy = `${dialog}\n${workbench}`;

  assert.doesNotMatch(customerCopy, /Choose a sample|Clone this sample|Sample gallery|label: "Samples"/);
  assert.match(customerCopy, /Choose a template|Use this template|Template gallery|label: "Templates"/);
  assert.match(styles, /\.studio-screen select\{appearance:none/);
  assert.match(styles, /\.studio-screen select:focus-visible/);
  assert.match(styles, /\.studio-screen select:disabled/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
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

test("the customer chooses fast or high quality without provider jargon", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const types = readFileSync("src/lib/adstudio/types.ts", "utf8");

  assert.match(types, /generationQuality\?:\s*"fast" \| "high"/);
  assert.match(dialog, /legend>Generation quality<\/legend>/);
  assert.match(dialog, /Fast/);
  assert.match(dialog, /Usually ready in about 30–45 seconds/);
  assert.match(dialog, /High quality/);
  assert.match(dialog, /Usually ready in about 2–3 minutes/);
  assert.match(dialog, /generationQuality/);
  assert.doesNotMatch(dialog, /Gemini|GPT Image|OpenAI|fal\.ai/);
});

test("goal-specific guidance does not introduce a second template recipe", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  const guidance = briefGuidanceForTemplate(template);
  assert.equal(guidance.fieldLabel, "Listing details");
  assert.match(guidance.note, /template details are examples only/);
  assert.equal(briefGuidanceForTemplate(undefined).fieldLabel, "Short description");
});

test("the dialog prefills reusable Brand Pack facts but not campaign-specific details", () => {
  const extracted = extractBrandKitFromWebsite({
    workspaceId: "workspace_brand_defaults",
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: { "https://northstar.example": "<title>Northstar Realty</title>" },
  });
  const brandKit = {
    ...extracted,
    identity: {
      ...extracted.identity,
      businessName: "Northstar Realty",
      tradingName: "Northstar",
    },
    logos: { primaryLogoUrl: "/logo.png", darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
    assets: { headshots: ["/agent.jpg"], officeImages: ["/office.jpg"], listingImages: [], socialProofImages: [] },
    contact: { phone: "08 5555 0101", email: "hello@northstar.example", address: null, socialLinks: [] },
  };

  assert.equal(defaultImageForTemplateSlot({ id: "agency_logo", label: "Agency logo" }, brandKit), "/logo.png");
  assert.equal(defaultImageForTemplateSlot({ id: "agent_headshot", label: "Agent portrait" }, brandKit), "/agent.jpg");
  assert.equal(defaultImageForTemplateSlot({ id: "property_photo", label: "Property image" }, brandKit), "");
  assert.equal(defaultTextForTemplateField({ key: "agency_name", label: "Agency name" }, brandKit), "Northstar");
  assert.equal(defaultTextForTemplateField({ key: "phone", label: "Phone" }, brandKit), "08 5555 0101");
  assert.equal(defaultTextForTemplateField({ key: "address", label: "Address" }, brandKit), "");
  assert.equal(defaultTextForTemplateField({ key: "price", label: "Price" }, brandKit), "");
});
