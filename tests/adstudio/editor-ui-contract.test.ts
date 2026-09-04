import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("customer Ad Studio workbench contract", () => {
  it("keeps the layered preview behind one progressive inspector", () => {
    const source = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    assert.match(source, /INSPECTOR_TABS/);
    assert.match(source, /aria-label="Editor inspector"/);
    assert.match(source, /<Sheet open=\{mobileInspectorOpen\}/);
    assert.match(source, /Review & publish/);
    assert.match(source, /<LayeredCanvas/);
    assert.doesNotMatch(source, /mobilePanel/);
  });

  it("uses the route workbench flow without fixed viewport shells", () => {
    const editorRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
    const stableEditorRoute = readFileSync("src/app/(customer)/ad-studio/ads/[id]/page.tsx", "utf8");
    const publishRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    assert.doesNotMatch(editorRoute, /fixed inset-0/);
    assert.doesNotMatch(publishRoute, /fixed inset-0/);
    assert.match(editorRoute, /Use this template/);
    assert.match(stableEditorRoute, /<EditorShell/);
    assert.match(stableEditorRoute, /h-full min-h-0 flex-col overflow-hidden/);
    assert.match(stableEditorRoute, /h-full min-h-0 overflow-y-auto/);
    assert.match(publishRoute, /<PublishFlow/);
  });

  it("constrains contextual editor geometry to the Studio viewport", () => {
    const studioShell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
    assert.match(studioShell, /contextual \? "h-dvh overflow-hidden" : "min-h-dvh"/);
    assert.match(studioShell, /contextual \? "min-h-0 overflow-hidden"/);
    assert.match(studioShell, /<main className=\{cn\("min-w-0 flex-1"/);
  });

  it("keeps Fabric geometry aligned with the pack x/y contract", () => {
    const canvas = readFileSync("src/components/adstudio/editor/layered-canvas.tsx", "utf8");
    const geometry = readFileSync("src/components/adstudio/editor/layer-geometry.ts", "utf8");
    const editor = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    assert.match(geometry, /function fabricRectGeometry\(geometry: Rect\)/);
    assert.match(geometry, /left: geometry\.x/);
    assert.match(geometry, /top: geometry\.y/);
    assert.match(geometry, /originX: "left"/);
    assert.match(geometry, /originY: "top"/);
    assert.match(canvas, /canvas\.setDimensions\(\{ width: dims\.width, height: dims\.height \}\)/);
    assert.match(canvas, /canvas\.setDimensions\(\{ width, height \}, \{ cssOnly: true \}\)/);
    assert.match(canvas, /canvas\.setViewportTransform\(\[1, 0, 0, 1, 0, 0\]\)/);
    assert.doesNotMatch(canvas, /setDimensions\(\{ width: Math\.floor\(dims\.width \* zoom\)/);
    assert.match(canvas, /resolveGeometry\(layer\.geometry, PLACEMENT_DIMENSIONS\[placement\]\)/);
    assert.match(canvas, /fabricPathPosition\(path, geometry\)/);
    assert.match(canvas, /function maskForSlot[\s\S]*?\.\.\.fabricCircleGeometry\(geometry\)/);
    assert.match(canvas, /M 0 \$\{geometry\.height \/ 2\}/);
    assert.match(canvas, /\{ x: 0, y: 0 \}/);
    assert.match(canvas, /const w = geometry\.width, h = geometry\.height/);
    assert.match(geometry, /values\.every\(\(value\) => Math\.abs\(value\) <= 1\.001\)/);
    assert.doesNotMatch(canvas, /new fabric\.Rect\(\{ \.\.\.geometry/);
    assert.match(canvas, /ensureLocalFont/);
    assert.match(canvas, /fontStem\(layer\.font\.file\)/);
    assert.match(canvas, /layer\.shape === "notched"/);
    assert.match(canvas, /layer\.shape === "wave"/);
    assert.match(canvas, /layer\.shape === "ring"/);
    assert.match(canvas, /new fabric\.Path/);
    assert.match(editor, /\[scrollbar-width:none\]/);
  });

  it("keeps mobile editor actions compact without hiding workflow controls", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    assert.match(shell, /grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
    assert.match(shell, /<span className="xl:hidden">Review<\/span>/);
    assert.match(shell, /className="hidden xl:inline">\{state\.isSaving \? "Saving…" : "Save"\}<\/span>/);
    assert.match(shell, /grid-cols-5/);
    assert.match(shell, /<Eye className="size-4" \/>Preview/);
    assert.match(shell, /setPreviewMode\("meta"\)/);
    assert.match(shell, /<Layers3 className="size-4" \/>Layers/);
    assert.match(shell, /<Sheet open=\{mobileLayersOpen\}/);
  });

  it("keeps Home cards contained and exposes exact edit/review destinations", () => {
    const home = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
    const command = readFileSync("src/components/adstudio/home-command.tsx", "utf8");
    assert.match(home, /<li key=\{template\.templateId\} className="min-w-0">/);
    assert.match(home, /<HomeCommand/);
    assert.match(command, /formatLastEdited\(ad\.updatedAt, timeZone, dateLocale\)/);
    assert.match(home, /timeZone/);
    assert.match(home, /resolveTimeZone\(auth\.claims\?\.user_metadata\?\.timezone, access\.region\)/);
    assert.match(home, /dateLocale = access\.region === "US" \? "en-US" : "en-AU"/);
    assert.match(command, /href=\{`\/ad-studio\/ads\/\$\{encodeURIComponent\(ad\.adId\)\}`\}/);
    assert.match(command, /href=\{`\/ad-studio\/templates\/\$\{encodeURIComponent\(ad\.templateId\)\}\/publish\?adId=\$\{encodeURIComponent\(ad\.adId\)\}`\}/);
    assert.match(command, /<Link[^>]*>Edit<\/Link>/);
    assert.match(command, /<Link[^>]*>Review<\/Link>/);
  });

  it("keeps editor inputs rounded, labelled, and progressive", () => {
    const inputs = readFileSync("src/components/adstudio/editor/inputs-panel.tsx", "utf8");
    const copy = readFileSync("src/components/adstudio/editor/meta-copy-panel.tsx", "utf8");
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const colours = readFileSync("src/components/adstudio/editor/colour-toggle.tsx", "utf8");

    assert.match(inputs, /missingRequiredImages/);
    assert.match(inputs, /role="status"/);
    assert.match(inputs, /rounded-\(--r-card\)/);
    assert.match(copy, /id="meta-copy-cta"/);
    assert.match(copy, /border border-input/);
    assert.match(shell, /AI brief/);
    assert.match(shell, /Generate copy/);
    assert.match(shell, /"design" \| "meta" \| "split"/);
    assert.match(shell, /TabsTrigger value="both"/);
    assert.match(shell, /aria-label="Canvas tools"/);
    assert.match(shell, /aria-label="Canvas zoom"/);
    assert.match(shell, /aria-label="Editor inspector"/);
    assert.match(shell, /setInspectorOpen/);
    assert.match(shell, /publish\?adId=/);
    assert.match(shell, /e\.key\.toLowerCase\(\)/);
    assert.match(shell, /key === "y"/);
    assert.match(colours, /Template colours/);
    assert.match(colours, /useId/);
    // Three mutually exclusive colour modes (template / workspace / custom),
    // exposed as an accessible radio group with per-role custom pickers.
    assert.match(colours, /role="radiogroup"/);
    assert.match(colours, /aria-label="Colour mode"/);
    assert.match(colours, /type="color"/);
    assert.doesNotMatch(colours, /<Switch/);
    assert.doesNotMatch(shell, /Safe deterministic draft|AI draft/);
  });

  it("shows template defaults, recovers stale saves, and keeps publishing choices explicit", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const state = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    const inputs = readFileSync("src/components/adstudio/editor/inputs-panel.tsx", "utf8");
    const publish = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
    const instantForm = readFileSync("src/components/adstudio/instant-form-editor.tsx", "utf8");

    assert.match(shell, /previewTextValues/);
    assert.match(shell, /defaultImageValues/);
    assert.match(shell, /Reload latest/);
    assert.match(state, /trimmed !== \(placeholders\.get\(key\)/);
    assert.match(inputs, /Template image/);
    assert.match(inputs, /Use template image/);
    assert.match(publish, /variantIds: selectedVariants/);
    assert.match(publish, /selectedVariants\.length \* selectedAdSetCount/);
    assert.match(publish, /This ad includes an offer, guide or result promise/);
    assert.match(publish, /fulfilmentRequired: publishRequirements\.fulfilmentRequired/);
    assert.match(publish, /Fulfilment delivery URL/);
    assert.match(instantForm, /aria-label=\{label\}/);
    assert.match(instantForm, /min-h-11/);
    assert.doesNotMatch(instantForm, /--r-control/);
  });
});
