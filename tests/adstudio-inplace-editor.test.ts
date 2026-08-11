import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flow = readFileSync("src/components/adstudio/ad-studio-customer-flow.tsx", "utf8");
const route = readFileSync("src/app/api/adstudio/creatives/[id]/edit/route.ts", "utf8");

test("finished-ad editor supports text, image direction and replacement images", () => {
  assert.match(flow, /newValue: value \}\);/);
  assert.doesNotMatch(flow, /newValue: value, patchImage/);
  assert.match(flow, /requestCreativeLayers\(creative\.creativeId\)/);
  assert.match(flow, /instruction: draft\.trim\(\)/);
  assert.match(flow, /newImage: await readFile\(scaled\)/);
  assert.match(flow, /creative\.activeRevisionId/);
  assert.match(flow, /crypto\.randomUUID\(\)/);
});

test("editor exposes accessible spatial targets for every QA region", () => {
  assert.match(flow, /creative\.canvas\.cloneQa\?\.regions/);
  assert.match(flow, /aria-label={`Edit \$\{region\.key\.replaceAll/);
  assert.match(flow, /aria-pressed=\{selectedKey === region\.key\}/);
  assert.match(flow, /left: `\$\{region\.box\.x \* 100\}%`/);
});

test("undo and redo append immutable revisions", () => {
  assert.match(flow, /mutate\(\{ action: "undo" \}\)/);
  assert.match(flow, /mutate\(\{ action: "redo" \}\)/);
  assert.match(route, /action === "undo" \|\| action === "redo"/);
  assert.match(route, /appendAdStudioCreativeRevision/);
  assert.match(route, /redoHistory/);
  assert.match(route, /targetQa \?\? canvas\.cloneQa/);
});

test("targeted edits use the latest finished ad and scoped QA path", () => {
  assert.match(route, /buildTargetedEditRequest/);
  assert.match(route, /cropRegionWithPadding/);
  assert.match(route, /compositeRegionBack/);
  assert.match(route, /expectedRevisionId/);
  assert.doesNotMatch(route, /renderExactCloneTextEdit/);
});

test("customer flow blocks Edit and Publish before a finished clone exists", () => {
  assert.match(flow, /const canEdit = hasFinishedPlacement\(pack, "4:5"\) \|\| hasFinishedPlacement\(pack, "9:16"\)/);
  assert.match(flow, /item\.id !== "create" && !canEdit/);
  assert.match(flow, /creative\?\.activeRevisionId && creativeSource\(creative\)/);
  assert.match(flow, /<CompactCreativeEditor/);
});
