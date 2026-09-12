import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsLogoImportRecovery } from "../../src/components/adstudio/brand-studio.tsx";

const publishFlow = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
const brandStudio = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");

test("ordinary publish setup keeps named provider choices behind customisation", () => {
  assert.match(publishFlow, /Why use this campaign setup/);
  assert.match(publishFlow, /Customise setup/);
  assert.ok(publishFlow.indexOf("Customise setup") < publishFlow.indexOf('id="publish-target"'));
  assert.doesNotMatch(publishFlow, /placeholder="(?:Campaign ID|Ad set ID|Latitude|Longitude)"/);
});

test("ordinary publish setup uses plain-language choices and one spend approval", () => {
  for (const label of ["Average daily budget", "Town or suburb", "Where your ad appears", "Starts", "Ends"]) {
    assert.ok(publishFlow.includes(label), label);
  }
  assert.match(publishFlow, /Approve & publish/);
  assert.match(publishFlow, /No total spending cap is set/);
  assert.match(publishFlow, /Shared with existing ads, not a per-ad allowance/);
  assert.doesNotMatch(publishFlow, /I confirm the daily spend/);
});

test("legacy external logo URLs give a safe existing-flow recovery", () => {
  assert.equal(needsLogoImportRecovery("https://agency.example/logo.png"), true);
  assert.equal(needsLogoImportRecovery("http://legacy.example/logo.png"), true);
  assert.equal(needsLogoImportRecovery("/api/adstudio/media?path=workspace%2Flogo.png"), false);
  assert.equal(needsLogoImportRecovery("https://blockwise.sale/api/adstudio/media?path=workspace%2Flogo.png"), false);
  assert.equal(needsLogoImportRecovery("data:image/png;base64,AAAA"), false);
  assert.equal(needsLogoImportRecovery("blob:https://blockwise.sale/example"), false);
  assert.equal(needsLogoImportRecovery(""), false);
  assert.match(brandStudio, /Rescan your website above to import it safely, or upload a replacement below/);
  assert.match(brandStudio, /AssetUploadDropzone/);
  assert.match(brandStudio, /uploadLogoAsset/);
  assert.doesNotMatch(brandStudio, /Content-Security-Policy/);
});
