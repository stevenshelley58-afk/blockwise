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

  it("bounds the route workbench to the available viewport without fixed overlays", () => {
    const editorRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
    const publishRoute = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/page.tsx", "utf8");
    assert.doesNotMatch(editorRoute, /fixed inset-0/);
    assert.doesNotMatch(publishRoute, /fixed inset-0/);
    assert.match(editorRoute, /h-\[calc\(100dvh-54px\)\]/);
    assert.match(editorRoute, /md:h-\[calc\(100dvh-64px\)\]/);
    assert.match(editorRoute, /min-h-0 flex-col overflow-hidden/);
    assert.match(editorRoute, /min-h-0 flex-1 overflow-hidden/);
    assert.match(editorRoute, /<EditorShell/);
    assert.match(publishRoute, /<PublishFlow/);
  });

  it("keeps Fabric geometry aligned with the pack x/y contract", () => {
    const canvas = readFileSync("src/components/adstudio/editor/layered-canvas.tsx", "utf8");
    const editor = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    assert.match(canvas, /function fabricRectGeometry\(geometry: Rect\)/);
    assert.match(canvas, /left: geometry\.x/);
    assert.match(canvas, /top: geometry\.y/);
    assert.match(canvas, /originX: "left" as const/);
    assert.match(canvas, /originY: "top" as const/);
    assert.match(canvas, /new fabric\.Textbox\([\s\S]*originX: "left"[\s\S]*originY: "top"/);
    assert.match(canvas, /function fitImageToGeometry[\s\S]*originX: "left"[\s\S]*originY: "top"/);
    assert.match(canvas, /function cropImageToGeometry[\s\S]*originX: "left"[\s\S]*originY: "top"/);
    assert.match(canvas, /case "phone"/);
    assert.match(canvas, /case "mail"/);
    assert.match(canvas, /case "globe"/);
    assert.match(canvas, /case "pin"/);
    assert.match(canvas, /strokeLineCap: "round"/);
    assert.match(canvas, /source\.length > layer\.maxCharacters/);
    assert.match(canvas, /source\.slice\(0, layer\.maxCharacters\)/);
    assert.match(canvas, /function fitTextboxToLayer/);
    assert.match(canvas, /fontSize -= 0\.5/);
    assert.match(canvas, /textbox\.textLines\.length <= layer\.maxLines/);
    assert.match(canvas, /layer\.overflowBehaviour === "truncate" \? "…" : ""/);
    assert.doesNotMatch(canvas, /new fabric\.Textbox\([\s\S]*height: geometry\.height,[\s\S]*fontFamily/);
    assert.match(canvas, /canvas\.setDimensions\(\{ width, height \}\)/);
    assert.doesNotMatch(canvas, /setDimensions\(\{ width: Math\.floor\(dims\.width \* zoom\)/);
    assert.doesNotMatch(canvas, /new fabric\.Rect\(\{ \.\.\.geometry/);
    assert.match(canvas, /ensureLocalFont/);
    assert.match(canvas, /fontStem\(layer\.font\.file\)/);
    assert.match(canvas, /layer\.shape === "notched"/);
    assert.match(canvas, /layer\.shape === "wave"/);
    assert.match(canvas, /layer\.shape === "ring"/);
    assert.match(canvas, /new fabric\.Path/);
    assert.match(editor, /\[scrollbar-width:none\]/);
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
    assert.match(shell, /<details>/);
    assert.match(shell, /min-h-11 h-auto justify-start/);
    assert.match(shell, /e\.key\.toLowerCase\(\)/);
    assert.match(shell, /key === "y"/);
    assert.match(colours, /Add workspace colours in Brand Studio/);
    assert.match(colours, /useId/);
    assert.match(colours, /aria-labelledby=\{`\$\{switchId\}-label`\}/);
    assert.doesNotMatch(colours, /<Label[\s\S]*<Switch/);
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
