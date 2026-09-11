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
    assert.match(stableEditorRoute, /h-\[calc\(100dvh-54px-4\.75rem-env\(safe-area-inset-top\)/);
    assert.match(stableEditorRoute, /md:h-\[calc\(100dvh-60px\)/);
    assert.match(stableEditorRoute, /h-full min-h-0 overflow-y-auto/);
    assert.match(publishRoute, /<PublishFlow/);
  });

  it("constrains contextual editor geometry to the Studio viewport", () => {
    const studioShell = readFileSync("src/components/adstudio/studio-shell.tsx", "utf8");
    assert.match(studioShell, /contextual \? "h-dvh overflow-hidden" : "min-h-dvh"/);
    assert.match(studioShell, /contextual \? "min-h-0 overflow-hidden pb-/);
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
    assert.match(canvas, /ensureTemplateFont/);
    assert.match(canvas, /templateAssetProxyUrl\(templateId, assetKey, existingAdId\)/);
    assert.match(canvas, /could not be loaded from the template asset/);
    assert.match(canvas, /templateFontFamily\(templateId, layer\.font\.file\)/);
    assert.match(canvas, /loadedFontFaces.delete\(cacheKey\)/);
    // Font identity and failed-load recovery are exercised in template-font-loader.test.ts.
    assert.match(canvas, /layer\.shape === "notched"/);
    assert.match(canvas, /layer\.shape === "wave"/);
    assert.match(canvas, /layer\.shape === "ring"/);
    assert.match(canvas, /new fabric\.Path/);
  });

  it("keeps mobile editor actions compact without hiding workflow controls", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    assert.match(shell, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_2\.75rem_auto\]/);
    assert.match(shell, /aria-label="Ad format" value=\{placementView\}/);
    assert.match(shell, /min-h-11 min-w-11/);
    assert.match(shell, /grid-cols-5/);
    assert.match(shell, /<Eye className="size-4" \/>Preview/);
    assert.match(shell, /setMobilePreviewOpen\(true\)/);
    assert.match(shell, /<Sheet open=\{mobilePreviewOpen\}/);
    assert.match(shell, /<Sheet open=\{mobileLayersOpen\}/);
  });

  it("keeps the compact Ads hub and exact edit/review destinations", () => {
    const home = readFileSync("src/app/(customer)/ad-studio/page.tsx", "utf8");
    const command = readFileSync("src/components/adstudio/home-command.tsx", "utf8");
    assert.match(home, /<HomeCommand/);
    assert.match(command, /aria-label="Create a new ad from a reviewed template"/);
    assert.match(command, />New ad<\//);
    assert.match(command, /Recent ads/);
    assert.match(command, /aria-label="Ad Studio links"/);
    assert.match(command, /Photos &amp; logos/);
    assert.doesNotMatch(command, /assetsError|assets\.length/);
    assert.doesNotMatch(home, /kind: "assets"/);
    assert.doesNotMatch(command, /Create a new ad<\/span>|Workspace shortcuts|Recent assets/);
    assert.match(command, /formatLastEdited\(ad\.updatedAt, timeZone, dateLocale\)/);
    assert.match(home, /timeZone/);
    assert.match(home, /resolveTimeZone\(auth\.claims\?\.user_metadata\?\.timezone, access\.region\)/);
    assert.match(home, /dateLocale = access\.region === "US" \? "en-US" : "en-AU"/);
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
    assert.match(shell, /AI Copy Assist/);
    assert.match(shell, /Generate copy/);
    assert.match(shell, /Review generated copy/);
    assert.match(shell, /Use all/);
    assert.match(shell, /aria-label=\{`Use \$\{label\}`\}/);
    assert.match(shell, /setProposal\(\{ onImage:/);
    assert.doesNotMatch(shell, /if \(!response\.ok \|\| !body\.copy\)[\s\S]{0,180}applyGeneratedCopy/);
    assert.match(shell, /"design" \| "meta" \| "split"/);
    assert.match(shell, /TabsTrigger value="both"/);
    assert.match(shell, /aria-label="Canvas tools"/);
    assert.match(shell, /aria-label="Canvas zoom"/);
    assert.match(shell, /aria-label="Editor inspector"/);
    assert.match(shell, /setInspectorOpen/);
    assert.match(shell, /publish\?adId=/);
    assert.match(shell, /guardedEditorNavigationHref/);
    assert.match(shell, /router\.push\(href\)/);
    assert.doesNotMatch(shell, /window\.location\.assign/);
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

  it("links the clicked ad area and the field that edits it", () => {
    const canvas = readFileSync("src/components/adstudio/editor/layered-canvas.tsx", "utf8");
    const inputs = readFileSync("src/components/adstudio/editor/inputs-panel.tsx", "utf8");
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");

    // The clicked area is marked from the resolved pack geometry, above the
    // canonical server preview (z-10) and below Fabric's pointer layer (z-20).
    assert.match(canvas, /resolveGeometry\(selectedLayer\.geometry, selectionDimensions\)/);
    assert.match(canvas, /data-editor-selection=\{selectedLayer\?\.layerId\}/);
    assert.match(canvas, /border-2 border-success bg-success\/15/);
    assert.match(canvas, /selectionGeometry\.x \/ selectionDimensions\.width/);
    assert.match(canvas, /z-\[15\]/);
    // Fabric's own active-object border is off so one outline is drawn.
    assert.match(canvas, /hasBorders: false/);
    assert.doesNotMatch(canvas, /borderColor: "#16181d"/);

    // The matching control carries the same mark, in colour and in weight.
    assert.match(inputs, /highlightedKey\?: string \| null/);
    assert.match(inputs, /highlighted && "border-success bg-success-soft\/60 ring-2 ring-success\/40 focus-visible:border-success focus-visible:ring-success\/40"/);
    assert.match(inputs, /font-semibold text-success/);
    assert.match(inputs, /aria-current=\{highlighted \? "true" : undefined\}/);
    // Layers with no input (plate, shape, icon) highlight no field.
    assert.match(shell, /selectedLayer && "inputKey" in selectedLayer \? selectedLayer\.inputKey : null/);
    assert.match(shell, /highlightedKey=\{selectedInputKey\}/);
    // Focusing a field is the reverse link that selects its area.
    assert.match(inputs, /onFocus=\{\(\) => onFieldFocus\?\.\(input\.key\)\}/);
    assert.match(shell, /if \(layer && layer\.layerId !== state\.selectedLayerId\) selectLayer\(layer\.layerId\)/);
    assert.match(shell, /onFieldFocus=\{focusLayerForInput\}/);

    // The editor opens on the Meta preview, so that creative answers the same
    // click as the design canvas, and the split view stays consistent with it.
    const previews = readFileSync("src/components/adstudio/editor/meta-previews.tsx", "utf8");
    assert.match(previews, /selectedLayerId\?: string \| null/);
    assert.match(previews, /onSelect\?: \(layerId: string\) => void/);
    assert.equal(previews.match(/selectedLayerId=\{selectedLayerId\}/g)?.length, 2);
    assert.equal(previews.match(/onSelect=\{onSelect\}/g)?.length, 2);
    assert.match(shell, /\{\.\.\.previewSelection\("feed"\)\}/);
    assert.match(shell, /\{\.\.\.previewSelection\("story"\)\}/);
    assert.match(shell, /selectedLayerId: state\.activePlacement === placement \? state\.selectedLayerId : null/);
    assert.doesNotMatch(shell, /canvasFor\(state\.activePlacement, "fit", false\)/);
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
    assert.match(publish, /hidden=\{activeStage !== 1\}/);
    assert.match(publish, /const stageCanContinue = activeStage === 1[\s\S]{0,40}\? true/);
    assert.match(publish, /activeStage === 2[\s\S]{0,80}formReady && destinationReady && fulfilmentReady/);
    assert.match(publish, /activeStage === 3[\s\S]{0,80}targetReady/);
    assert.match(publish, /DownloadFormats/);
    assert.match(publish, /Download both formats/);
    assert.match(publish, /Download both files/);
    assert.match(publish, /individual links below/);
    assert.match(publish, /Edit creative and copy/);
    assert.match(publish, /This ad includes an offer, guide or result promise/);
    assert.match(publish, /fulfilmentRequired: publishRequirements\.fulfilmentRequired/);
    assert.match(publish, /Fulfilment delivery URL/);
    assert.match(instantForm, /aria-label=\{label\}/);
    assert.match(instantForm, /min-h-11/);
    assert.doesNotMatch(instantForm, /--r-control/);
  });
});
