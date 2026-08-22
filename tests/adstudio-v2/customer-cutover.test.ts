import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workbench = readFileSync("src/components/adstudio/ad-studio-workbench.tsx", "utf8");
const editClient = readFileSync("src/components/adstudio/canvas/creative-edit-client.ts", "utf8");
const inPlaceEditor = readFileSync("src/components/adstudio/canvas/in-place-ad-editor.tsx", "utf8");
const publishPanel = readFileSync("src/components/adstudio/panels/publish-panel.tsx", "utf8");
const campaignActions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");

test("v2 editor cutover happens before every legacy clone-editor path", () => {
  const editor = workbench.slice(
    workbench.indexOf("function renderCreativeEditor()"),
    workbench.indexOf("function renderHomePanel()"),
  );
  const v2Branch = editor.indexOf("if (useV2Frames && isAdDocInstanceShape(currentCreative.canvas))");
  const legacyBranch = editor.indexOf("if (isCloneCreative(currentCreative))");

  assert.ok(v2Branch >= 0, "the v2 document branch is required");
  assert.ok(legacyBranch > v2Branch, "v2 must be handled before legacy clone access");
  assert.match(editor, /instance=\{currentCreative\.canvas\}/);
  assert.doesNotMatch(editor, /canvas as unknown/);
});

test("v2 gallery cutover fails closed when no approved templates are available", () => {
  assert.match(
    workbench,
    /const adTemplates = useV2Frames \? v2Templates : v2Templates\.length > 0 \? v2Templates : visibleBuiltInTemplates;/,
  );
});

test("legacy clone edit clients accept only narrowed legacy creatives", () => {
  assert.match(editClient, /creative: AdStudioLegacyCreative;/);
  assert.match(editClient, /creative: AdStudioLegacyCreative;/);
  assert.match(inPlaceEditor, /creative: AdStudioLegacyCreative;/);
  assert.match(inPlaceEditor, /onCreativeChange: \(next: AdStudioLegacyCreative\)/);
});

test("customer previews and campaign actions use the canonical creative source", () => {
  assert.match(publishPanel, /import \{ primaryImageSource \} from "@\/lib\/adstudio\/creative-preview";/);
  assert.match(publishPanel, /const imageSource = primaryImageSource\(creative\);/);
  assert.match(campaignActions, /import \{ isLegacyCreative, primaryImageSource \} from "@\/lib\/adstudio\/creative-preview";/);
  assert.match(campaignActions, /if \(!isLegacyCreative\(creative\)\) return creative;/);
  assert.match(campaignActions, /const image = primaryImageSource\(creative\);/);
});
