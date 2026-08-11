import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AD_STUDIO_TEMPLATES } from "../src/lib/adstudio/templates.ts";

const flow = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");

test("the customer flow collects only the selected template's declared inputs", () => {
  const template = AD_STUDIO_TEMPLATES[0]!;
  const createInput = flow.slice(flow.indexOf("const input: FirstAdInput"), flow.indexOf("setCreateError", flow.indexOf("const input: FirstAdInput")));
  assert.ok(template.inputs.images.length > 0);
  assert.ok(template.inputs.text.length > 0);
  assert.match(flow, /selectedTemplate\.inputs\.images\.map/);
  assert.match(flow, /selectedTemplate\.inputs\.text\.map/);
  assert.match(flow, /imageDataUrls: imageValues/);
  assert.match(flow, /onImageCopy: textValues/);
  assert.doesNotMatch(createInput, /provider|model|layer|generationQuality|colourSource/);
});

test("the compact route exposes one Create, Edit, Publish path and no pre-clone editor", () => {
  assert.match(flow, /type Stage = "create" \| "edit" \| "publish"/);
  assert.match(flow, /disabled=\{disabled\}/);
  assert.match(flow, /const canEdit = hasFinishedPlacement\(pack, "4:5"\) \|\| hasFinishedPlacement\(pack, "9:16"\)/);
  assert.match(flow, /await generateFirstAd\(input\)/);
  assert.match(flow, /setStage\("edit"\)/);
  assert.match(flow, /<CompactCreativeEditor/);
  assert.match(flow, /<CompactPublish/);
  assert.doesNotMatch(flow, /InPlaceAdEditor|PublishSetupPanel|STYLES/);
});

test("the customer flow keeps the server as the only clone generator", () => {
  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");
  assert.doesNotMatch(flow, /buildCloneImageRequest|templateCloneImage/);
  assert.match(route, /adstudio\.generate\.template/);
  assert.match(actions, /waitForTemplateCampaignJob/);
  assert.match(actions, /Your ad is ready to edit/);
});

test("the flow uses shadcn primitives and responsive Tailwind layout", () => {
  assert.match(flow, /@\/components\/ui\/button/);
  assert.match(flow, /@\/components\/ui\/card/);
  assert.match(flow, /@\/components\/ui\/dialog/);
  assert.match(flow, /@\/components\/ui\/textarea/);
  assert.match(flow, /sm:grid-cols-2/);
  assert.match(flow, /lg:grid-cols-3/);
  assert.match(flow, /max-h-\[92dvh\]/);
});
