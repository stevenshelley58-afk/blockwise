import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { briefGuidanceForTemplate } from "../src/components/adstudio/new-ad-dialog-brief.ts";
import { imageRequirementsForTemplate } from "../src/components/adstudio/new-ad-dialog-slots.ts";
import type { AdStudioTemplate } from "../src/lib/adstudio/index.ts";

test("new ad dialog shows combined missing-requirements guidance before generating", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const submitStart = dialog.indexOf("async function submit()");
  const submitEnd = dialog.indexOf("const stepTitle =", submitStart);
  const submitBody = dialog.slice(submitStart, submitEnd);

  assert.notEqual(submitStart, -1);
  assert.notEqual(submitEnd, -1);
  assert.match(dialog, /type RequirementBlocker/);
  assert.match(dialog, /function buildRequirementBlockers/);
  assert.match(dialog, /role="alert" aria-live="assertive"/);
  assert.match(dialog, /Add the missing details before generating/);
  assert.match(dialog, /Add a short description so Blockwise knows what to write/);
  assert.match(dialog, /missingImageLabels/);
  assert.match(dialog, /Upload a file, choose from library, or generate an image/);
  assert.match(dialog, /briefGuidanceForTemplate\(selectedTemplate\)/);
  assert.match(dialog, /studio-newad-field-help/);
  assert.match(dialog, /Image upload is still running\. Wait for it to finish, then generate the ad\./);
  assert.match(dialog, /aria-invalid=\{hasDescriptionRequirement \? true : undefined\}/);
  assert.match(dialog, /aria-describedby=\{hasDescriptionRequirement \? requirementsAlertId : undefined\}/);
  assert.match(submitBody, /buildRequirementBlockers\(\{ description, missingImageLabels, missingCopyLabels, uploadingImage \}\)/);
  assert.match(submitBody, /descriptionRef\.current\?\.focus\(\)/);
  assert.match(submitBody, /setShowRequirementsAlert\(true\)/);
  assert.doesNotMatch(submitBody, /setError\("Add a short description\."\)/);
  assert.doesNotMatch(submitBody, /setError\("Upload one image to generate the ad\."\)/);
});

test("new ad dialog derives upload slots from the selected template canvas", () => {
  const template = {
    canvas: {
      objects: [
        {
          objectId: "hero",
          type: "image",
          role: "property_photo",
          x: 0,
          y: 0,
          width: 900,
          height: 600,
          locked: false,
        },
        {
          objectId: "supporting",
          type: "image",
          role: "secondary_property_photo",
          x: 0,
          y: 610,
          width: 420,
          height: 300,
          locked: false,
        },
        {
          objectId: "headshot",
          type: "image",
          role: "agent_headshot",
          x: 760,
          y: 40,
          width: 120,
          height: 120,
          clip: "circle",
          locked: false,
        },
      ],
    },
  } as AdStudioTemplate;

  const slots = imageRequirementsForTemplate(template);

  assert.deepEqual(
    slots.map((slot) => ({ id: slot.id, label: slot.label, required: slot.required, role: slot.role })),
    [
      { id: "property_photo", label: "Property image", required: true, role: "primary" },
      { id: "secondary_property_photo", label: "Property image 2", required: true, role: "secondary" },
      { id: "agent_headshot", label: "Agent headshot", required: false, role: "agent_headshot" },
    ],
  );
  assert.equal(slots[2]?.guidance, "Circular slot");
});

test("selected template generation submits the brief and the server clones asynchronously", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");
  const submitStart = dialog.indexOf("async function submit()");
  const submitEnd = dialog.indexOf("const stepTitle =", submitStart);
  const submitBody = dialog.slice(submitStart, submitEnd);
  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  const generation = readFileSync("src/lib/adstudio/generate-template-campaign.ts", "utf8");
  const createRoute = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

  // The dialog submits raw inputs only — no client-side clone orchestration.
  assert.doesNotMatch(dialog, /generateTemplateClone/);
  assert.doesNotMatch(dialog, /\/api\/adstudio\/generate-clone/);
  assert.match(submitBody, /imageDataUrl,/);
  assert.match(submitBody, /imageDataUrls,/);
  assert.doesNotMatch(submitBody, /templateCloneImage/);

  // The route enqueues an async job (202 + jobId) with a sync dev fallback,
  // and the client polls the job then loads the finished campaign.
  assert.match(createRoute, /adstudio\.generate\.template/);
  assert.match(createRoute, /status: 202/);
  assert.match(createRoute, /ADSTUDIO_SYNC_GENERATE/);
  assert.match(actions, /response\.status === 202/);
  assert.match(actions, /\/api\/adstudio\/jobs\//);
  assert.match(actions, /\/api\/adstudio\/campaigns\/\$\{/);

  // The server pipeline still runs the cascade, QA reroll, and persisted render.
  assert.match(generation, /generateCloneWithCascade/);
  assert.match(generation, /runCloneQa/);
  assert.match(generation, /cloneQaCorrectionPrompt/);
  assert.match(generation, /persistCloneRender/);
  assert.match(generation, /persistAdStudioCampaignPack/);
});

test("campaign creation accepts persisted template clone media", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

  assert.match(route, /firstAd\.templateCloneImage/);
  assert.match(route, /Generated template clone is invalid/);
});

test("generate clone route resolves images by slot role or object id", () => {
  const route = readFileSync("src/app/api/adstudio/generate-clone/route.ts", "utf8");
  const brief = readFileSync("src/lib/adstudio/template-brief.ts", "utf8");
  const cloneTypes = readFileSync("src/lib/adstudio/reference-clone.ts", "utf8");

  assert.match(cloneTypes, /objectId\?: string/);
  assert.match(brief, /objectId: o\.objectId/);
  assert.match(route, /suppliedImages\[slot\.role\] \?\? \(slot\.objectId \? suppliedImages\[slot\.objectId\] : undefined\)/);
});

test("new ad dialog uses object IDs for duplicate image roles", () => {
  const template = {
    canvas: {
      objects: [
        { objectId: "photo-a", type: "image", role: "property_photo", x: 0, y: 0, width: 500, height: 500, locked: false },
        { objectId: "photo-b", type: "image", role: "property_photo", x: 500, y: 0, width: 500, height: 500, locked: false },
      ],
    },
  } as AdStudioTemplate;

  assert.deepEqual(
    imageRequirementsForTemplate(template).map((slot) => slot.id),
    ["photo-a", "photo-b"],
  );
});

test("selected templates ask for goal-specific campaign details", () => {
  const appraisal = briefGuidanceForTemplate(
    {
      name: "Free appraisal",
      goal: "appraisal_bookings",
      offerId: "home_value_update",
      promptHint: "Ask homeowners to request a current value update.",
    },
  );

  assert.equal(appraisal.fieldLabel, "Appraisal offer details");
  assert.match(appraisal.helperText, /suburb or street/);
  assert.match(appraisal.placeholder, /Scarborough, WA homeowners/);
  assert.match(appraisal.note, /sample details stay as examples only/);

  const market = briefGuidanceForTemplate(
    {
      name: "Market update",
      goal: "market_update_leads",
      offerId: "suburb_market_report",
      promptHint: "Promote a suburb report with a market stat.",
    },
  );

  assert.equal(market.fieldLabel, "Market update details");
  assert.match(market.helperText, /reporting period/);
  assert.match(market.placeholder, /market update/);

  const listing = briefGuidanceForTemplate(
    {
      name: "Listing launch",
      goal: "seller_leads",
      offerId: "listing_inquiries",
      promptHint: "Use customer media, local market context, compliant copy, and a direct call to action.",
    },
  );

  assert.equal(listing.fieldLabel, "Listing details");
  assert.match(listing.helperText, /price guide or inspection time/);

  // No template resolved (defensive fallback only — the dialog always selects
  // a template now that blank mode is cut).
  const fallback = briefGuidanceForTemplate(undefined);
  assert.equal(fallback.fieldLabel, "Short description");
  assert.match(fallback.placeholder, /Open home this Saturday/);
});

test("campaign creation route returns actionable first-ad validation fallbacks", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

  assert.match(route, /Add a short description so Blockwise knows what to write/);
  assert.match(route, /Keep the short description to 500 characters or less/);
  assert.match(route, /Add a required image before generating the ad/);
  assert.doesNotMatch(route, /A short description is required\./);
  assert.doesNotMatch(route, /An uploaded image is required\./);
});
