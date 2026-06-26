import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(dialog, /Add a required image before generating the ad/);
  assert.match(dialog, /Upload a file, choose from library, or generate an image/);
  assert.match(dialog, /Image upload is still running\. Wait for it to finish, then generate the ad\./);
  assert.match(dialog, /aria-invalid=\{hasDescriptionRequirement \? true : undefined\}/);
  assert.match(dialog, /aria-describedby=\{hasDescriptionRequirement \? requirementsAlertId : undefined\}/);
  assert.match(submitBody, /buildRequirementBlockers\(\{ description, hasImage: Boolean\(imageDataUrl\), uploadingImage \}\)/);
  assert.match(submitBody, /descriptionRef\.current\?\.focus\(\)/);
  assert.match(submitBody, /setShowRequirementsAlert\(true\)/);
  assert.doesNotMatch(submitBody, /setError\("Add a short description\."\)/);
  assert.doesNotMatch(submitBody, /setError\("Upload one image to generate the ad\."\)/);
});

test("campaign creation route returns actionable first-ad validation fallbacks", () => {
  const route = readFileSync("src/app/api/adstudio/campaigns/route.ts", "utf8");

  assert.match(route, /Add a short description so Blockwise knows what to write/);
  assert.match(route, /Keep the short description to 500 characters or less/);
  assert.match(route, /Add a required image before generating the ad/);
  assert.doesNotMatch(route, /A short description is required\./);
  assert.doesNotMatch(route, /An uploaded image is required\./);
});
