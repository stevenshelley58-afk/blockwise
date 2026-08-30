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
    assert.match(editor, /Facebook Feed/);
  });

  it("keeps the prior creative visible until the latest async Fabric render is ready", () => {
    const canvas = readFileSync("src/components/adstudio/editor/layered-canvas.tsx", "utf8");
    const createIndex = canvas.indexOf("const object = await createLayerObject");
    const clearIndex = canvas.indexOf("canvas.clear()", createIndex);
    const addIndex = canvas.indexOf("nextObjects.forEach(object => canvas.add(object))", clearIndex);

    assert.ok(createIndex >= 0, "the replacement creative must be assembled asynchronously");
    assert.ok(clearIndex > createIndex, "the visible canvas must not clear before replacement layers finish");
    assert.ok(addIndex > clearIndex, "the completed replacement must be swapped into Fabric atomically");
    assert.match(canvas, /const version = \+\+renderVersionRef\.current;[\s\S]*setIsRendering\(true\)/);
    assert.match(canvas, /if \(renderVersionRef\.current !== version \|\| fabricRef\.current !== canvas\) return;[\s\S]*canvas\.discardActiveObject\(\);/);
    assert.match(canvas, /canvas\.renderAll\(\);[\s\S]*if \(renderVersionRef\.current === version && fabricRef\.current === canvas\) \{[\s\S]*setHasRendered\(true\);[\s\S]*setIsRendering\(false\);/);
    assert.match(canvas, /return \(\) => \{[\s\S]*renderVersionRef\.current \+= 1;/);
    assert.match(canvas, /\(!ready \|\| \(isRendering && !hasRendered\)\)/);
    assert.match(canvas, /pointer-events-none absolute inset-0 z-10/);
    assert.match(canvas, /aria-hidden="true"/);
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
    assert.match(shell, /aria-label="AI copy"/);
    assert.match(shell, /disabled=\{busy \|\| !brief\.trim\(\)\}/);
    assert.match(shell, /e\.key\.toLowerCase\(\)/);
    assert.match(shell, /key === "y"/);
    assert.match(colours, /Add workspace colours in Brand Studio/);
    assert.match(colours, /useId/);
    assert.match(colours, /aria-labelledby=\{`\$\{switchId\}-label`\}/);
    assert.doesNotMatch(colours, /<Label[\s\S]*<Switch/);
    assert.doesNotMatch(shell, /Safe deterministic draft|AI draft/);
  });

  it("wires the live creative into genuine Facebook Feed and Story previews", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const preview = readFileSync("src/components/adstudio/editor/meta-placement-preview.tsx", "utf8");
    const route = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/page.tsx", "utf8");
    const feedPreview = preview.slice(preview.indexOf("function MetaFeedPreview"), preview.indexOf("function MetaStoryPreview"));
    const storyPreview = preview.slice(preview.indexOf("function MetaStoryPreview"), preview.indexOf("function PageAvatar"));

    assert.match(shell, /import \{ MetaPlacementPreview, type MetaPreviewBrand \} from "\.\/meta-placement-preview"/);
    assert.match(
      shell,
      /<MetaPlacementPreview[\s\S]*?placement=\{state\.activePlacement\}[\s\S]*?brand=\{resolvedBrandPreview\}[\s\S]*?copy=\{state\.metaCopy\}[\s\S]*?creative=\{<LayeredCanvas[\s\S]*?\/>\}[\s\S]*?\/>/,
    );
    assert.match(preview, /placement === "story"[\s\S]*?<MetaStoryPreview[\s\S]*?:[\s\S]*?<MetaFeedPreview/);
    assert.match(shell, /Facebook Feed/);
    assert.match(shell, /Facebook Story/);
    assert.match(preview, /aria-label="Facebook Feed ad preview"/);
    assert.match(preview, /copy\.primaryText\.trim\(\)/);
    assert.match(preview, /copy\.headline\.trim\(\)/);
    assert.match(preview, /copy\.description\.trim\(\)/);
    assert.match(preview, /formatCta\(copy\.cta\)/);
    assert.match(preview, /label="Like"/);
    assert.match(preview, /label="Comment"/);
    assert.match(preview, /label="Share"/);
    assert.match(preview, /aria-label="Facebook Story ad preview"/);
    assert.doesNotMatch(feedPreview, /\b24\b|3 comments|Heart/);
    assert.doesNotMatch(storyPreview, /Array\.from|copy\.headline|Send/);
    assert.equal((feedPreview.match(/\{creative\}/g) ?? []).length, 1, "the Feed shell must render the live layered creative");
    assert.equal((storyPreview.match(/\{creative\}/g) ?? []).length, 1, "the Story shell must render the live layered creative");
    assert.match(route, /brandPreview=\{brandKit \? \{/);
    assert.match(route, /businessName: brandKit\.identity\.businessName/);
    assert.match(route, /displayDomain: resolveAdvertiserDomain\(\{ brandKit \}\)\.host/);
    assert.match(route, /logoUrl: brandKit\.logos\.primaryLogoUrl/);
  });

  it("normalises CTA values before controls, previews, state updates, and saves", () => {
    const panel = readFileSync("src/components/adstudio/editor/meta-copy-panel.tsx", "utf8");
    const preview = readFileSync("src/components/adstudio/editor/meta-placement-preview.tsx", "utf8");
    const state = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");

    assert.match(panel, /META_CTA_VALUES/);
    assert.match(panel, /value=\{toMetaCta\(values\.cta\)\}/);
    assert.match(panel, /\{labelForMetaCta\(cta\)\}/);
    assert.match(preview, /return labelForMetaCta\(toMetaCta\(value\)\)/);
    assert.match(state, /metaCopy: normalizeEditorMetaCopy\(defaults\.metaCopy\)/);
    assert.match(state, /metaCopy: normalizeEditorMetaCopy\(\{[\s\S]*?cta: initialDocument\.metaCta/);
    assert.match(state, /metaCopy: normalizeEditorMetaCopy\(defaults\)/);
    assert.match(state, /metaCopy: normalizeEditorMetaCopy\(copy\)/);
    assert.match(state, /\[field\]: field === "cta" \? toMetaCta\(value\) : value/);
    assert.match(state, /metaCta: toMetaCta\(state\.metaCopy\.cta\)/);
  });

  it("keeps 320px editor actions responsive and navigation touch targets at least 44px", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const navigation = readFileSync("src/components/adstudio/studio-navigation.tsx", "utf8");

    assert.match(shell, /grid-cols-\[2\.75rem_2\.75rem_minmax\(0,0\.8fr\)_minmax\(0,1\.25fr\)\]/);
    assert.match(shell, /aria-label="Review and publish"/);
    assert.match(shell, /className="sm:hidden">Review/);
    assert.match(shell, /className="hidden sm:inline">Review & publish/);
    assert.match(navigation, /min-h-11/);
    assert.doesNotMatch(navigation, /min-h-10/);
  });

  it("offers one Content action that fills every template text field together", () => {
    const inputs = readFileSync("src/components/adstudio/editor/inputs-panel.tsx", "utf8");
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const state = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    const templateAction = state.match(/const applyTemplateText = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[pushUndo\]\);/)?.[0];

    assert.equal((inputs.match(/Use template text/g) ?? []).length, 1);
    assert.match(inputs, /<Button[\s\S]*?onClick=\{onUseTemplateText\}[\s\S]*?>[\s\S]*?Use template text[\s\S]*?<\/Button>/);
    assert.match(shell, /onUseTemplateText=\{applyTemplateText\}/);
    assert.ok(templateAction, "the bulk template-text state action must exist");
    assert.equal((templateAction.match(/setState\(/g) ?? []).length, 1);
    assert.equal((templateAction.match(/pushUndo\(/g) ?? []).length, 1);
    assert.match(templateAction, /textValues: Object\.fromEntries\(editorTextInputs\(prev\.pack\)\.map\(input => \[input\.key, input\.placeholder\]\)\)/);
    assert.match(templateAction, /isDirty: true/);
    assert.match(templateAction, /editVersion: \(prev\.editVersion \?\? 0\) \+ 1/);
  });

  it("applies one AI result to every on-image field and all four Meta fields atomically", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const state = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    const metaCopyBody = state.match(/export interface MetaCopy \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const metaFields = [...metaCopyBody.matchAll(/^\s+(\w+): string;/gm)].map(match => match[1]);
    const atomicAction = state.match(/const applyCompleteCopy = useCallback\(\(onImage: Record<string, string>, copy: MetaCopy\) => \{[\s\S]*?\n  \}, \[pushUndo\]\);/)?.[0];

    assert.deepEqual(metaFields, ["primaryText", "headline", "description", "cta"]);
    assert.ok(atomicAction, "the complete-copy state action must exist");
    assert.equal((atomicAction.match(/setState\(/g) ?? []).length, 1, "all fields must share one React state transaction");
    assert.equal((atomicAction.match(/pushUndo\(/g) ?? []).length, 1, "the complete result must undo as one edit");
    assert.match(atomicAction, /editorTextInputs\(prev\.pack\)/);
    assert.match(atomicAction, /textValues: \{ \.\.\.prev\.textValues, \.\.\.safeOnImage \}/);
    assert.match(atomicAction, /metaCopy: normalizeEditorMetaCopy\(copy\)/);
    assert.match(atomicAction, /isDirty: true/);
    assert.match(atomicAction, /editVersion: \(prev\.editVersion \?\? 0\) \+ 1/);
    assert.match(shell, /const next = \{ onImage: body\.onImage \?\? \{\}, copy: body\.copy,[\s\S]*?applyCompleteCopy\(next\.onImage, next\.copy\);/);
  });

  it("requires a real AI provider and passes the complete Brand Pack into copy generation", () => {
    const route = readFileSync("src/app/api/adstudio/ads/[id]/copy-proposal/route.ts", "utf8");
    const generation = readFileSync("src/lib/adstudio/copy-generation.ts", "utf8");

    assert.match(route, /if \(!hasConfiguredAdStudioTextProvider\(\)\)/);
    assert.match(route, /AI copy is temporarily unavailable because no text provider is configured\./);
    assert.match(route, /\{ status: 503 \}/);
    assert.doesNotMatch(route, /buildDeterministicCopyProposal/);
    assert.match(generation, /"AZURE_OPENAI_API_KEY"/);
    assert.match(generation, /"OPENAI_API_KEY"/);
    assert.match(generation, /"GOOGLE_AI_API_KEY"/);
    assert.match(generation, /"DEEPSEEK_API_KEY"/);
    assert.match(generation, /TEXT_PROVIDER_API_KEYS\.some\(\(key\) => Boolean\(env\[key\]\?\.trim\(\)\)\)/);
    assert.match(route, /try \{[\s\S]*?await loadLatestBrandKit\(access\.supabase, access\.access\.workspaceId\)/);
    assert.match(route, /\.from\("adstudio_brand_kits"\)[\s\S]*?\.eq\("workspace_id", workspaceId\)[\s\S]*?\.order\("updated_at", \{ ascending: false \}\)/);
    assert.match(route, /isExampleBrandKitSourceUrl/);
    assert.match(route, /rowToBrandKit/);
    assert.match(route, /businessName: brandKit\.identity\.businessName/);
    assert.match(route, /market: \[brandKit\.identity\.marketRegion, brandKit\.identity\.marketCountry\]/);
    assert.match(route, /voice: brandKit\.tone\.voice/);
    assert.match(route, /preferredPhrases: brandKit\.tone\.preferredPhrases/);
    assert.match(route, /neverSay: brandKit\.tone\.avoid/);
    assert.match(route, /context: \{[\s\S]*?\.\.\.brandContext/);
    assert.match(route, /fields,[\s\S]*?brandKit,[\s\S]*?context:/);
    assert.match(generation, /brandKit\?: Partial<AdStudioBrandKit> \| null/);
    assert.match(generation, /brandKit: input\.brandKit/);
    assert.match(generation, /cta: toMetaCta\(clamp\(json\.cta, ADSTUDIO_COPY_LIMITS\.cta, "Learn more"\)\)/);
    assert.equal((route.match(/cta: toMetaCta\(result\.copy\.cta\)/g) ?? []).length, 1, "the endpoint must defensively return a supported Meta CTA enum");
  });

  it("generates and applies the complete copy set without per-field suggestion approval", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const proposalStart = shell.indexOf("function ProposalPanel(");
    const proposalEnd = shell.indexOf("function CropDialogHost(", proposalStart);
    const proposalPanel = proposalStart >= 0 && proposalEnd > proposalStart ? shell.slice(proposalStart, proposalEnd) : "";

    assert.ok(proposalPanel, "the AI copy panel must exist");
    assert.equal((proposalPanel.match(/<Button\b/g) ?? []).length, 1, "AI copy should have one complete-generation action");
    assert.match(proposalPanel, /Generate all copy/);
    assert.doesNotMatch(proposalPanel, /onApplyText|onApplyMeta/);
    assert.doesNotMatch(proposalPanel, /Use overlay suggestion|Use suggestion/);
    assert.doesNotMatch(proposalPanel, /proposal\.copy\[[^\]]+\]/);
    assert.match(shell, /applyCompleteCopy\(next\.onImage, next\.copy\);/);
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
