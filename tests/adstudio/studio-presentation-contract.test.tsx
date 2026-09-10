import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsLogoImportRecovery } from "../../src/components/adstudio/brand-studio.tsx";

const publishFlow = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
const brandStudio = readFileSync("src/components/adstudio/brand-studio.tsx", "utf8");

test("ordinary publish setup keeps provider identifiers behind advanced setup", () => {
  assert.match(publishFlow, /Blockwise prepares a new ad for you\. You choose your daily spend, area, where it appears and timing below\./);
  assert.match(publishFlow, /Use an existing setup \(advanced\)/);
  assert.ok(publishFlow.indexOf("Use an existing setup (advanced)") < publishFlow.indexOf('id="meta-target-mode"'));
  assert.doesNotMatch(publishFlow, /Blockwise prepares a new campaign and ad set by default/);
  assert.doesNotMatch(publishFlow, /Use an existing Meta campaign \(advanced\)/);
});

test("ordinary publish setup uses plain-language required choices", () => {
  for (const label of ["Daily spend (AUD)", "Area", "Where your ad appears", "Starts", "Ends"]) {
    assert.match(publishFlow, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(publishFlow, /Set a distance around a map point \(advanced\)/);
  assert.match(publishFlow, /Meta setup details \(advanced\)/);
  assert.match(publishFlow, /I confirm the daily spend, area, places shown, timing, ad versions and any offer delivery details are correct/);
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
