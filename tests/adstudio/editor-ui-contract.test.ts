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
    const assistant = readFileSync("src/components/adstudio/editor/ai-copy-assistant.tsx", "utf8");
    const colours = readFileSync("src/components/adstudio/editor/colour-toggle.tsx", "utf8");

    assert.match(inputs, /missingRequiredImages/);
    assert.match(inputs, /role="status"/);
    assert.match(inputs, /rounded-\(--r-card\)/);
    assert.match(inputs, /shouldUseMultilineTextInput\(input, value\)/);
    assert.match(inputs, /input\.maxLength > 100/);
    assert.match(inputs, /<textarea/);
    assert.match(inputs, /whitespace-pre-wrap/);
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
    assert.match(state, /metaCopy: normalizeEditorMetaCopy\(\{ \.\.\.prev\.metaCopy, \.\.\.copy \}\)/);
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

  it("applies the selected AI fields in one atomic undoable edit", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const state = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    const metaCopyBody = state.match(/export interface MetaCopy \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const metaFields = [...metaCopyBody.matchAll(/^\s+(\w+): string;/gm)].map(match => match[1]);
    const atomicAction = state.match(/const applySelectedCopy = useCallback\(\(onImage: Record<string, string>, copy: Partial<MetaCopy>\) => \{[\s\S]*?\n  \}, \[pushUndo\]\);/)?.[0];

    assert.deepEqual(metaFields, ["primaryText", "headline", "description", "cta"]);
    assert.ok(atomicAction, "the selected-copy state action must exist");
    assert.equal((atomicAction.match(/setState\(/g) ?? []).length, 1, "all fields must share one React state transaction");
    assert.equal((atomicAction.match(/pushUndo\(/g) ?? []).length, 1, "the complete result must undo as one edit");
    assert.match(atomicAction, /editorTextInputs\(prev\.pack\)/);
    assert.match(atomicAction, /textValues: \{ \.\.\.prev\.textValues, \.\.\.safeOnImage \}/);
    assert.match(atomicAction, /metaCopy: normalizeEditorMetaCopy\(\{ \.\.\.prev\.metaCopy, \.\.\.copy \}\)/);
    assert.match(atomicAction, /isDirty: true/);
    assert.match(atomicAction, /editVersion: \(prev\.editVersion \?\? 0\) \+ 1/);
    assert.match(shell, /setProposal\(next\);/);
    assert.doesNotMatch(shell, /setProposal\(next\);[\s\S]{0,100}applySelectedCopy/);
    assert.match(shell, /applySelectedCopy\(payload\.onImage, payload\.copy\)/);
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
    assert.match(generation, /const complete = parseCompleteAdStudioTemplateCopy\(json, input\.fields\)/);
    assert.match(generation, /copy: \{ \.\.\.complete\.copy, cta: toMetaCta\(complete\.copy\.cta\) \}/);
    assert.doesNotMatch(generation, /raw \|\| field\.sample/);
    assert.equal((route.match(/cta: toMetaCta\(result\.copy\.cta\)/g) ?? []).length, 1, "the endpoint must defensively return a supported Meta CTA enum");
  });

  it("reviews every generated field before Use all or Use selected changes the ad", () => {
    const shell = readFileSync("src/components/adstudio/editor/editor-shell.tsx", "utf8");
    const assistant = readFileSync("src/components/adstudio/editor/ai-copy-assistant.tsx", "utf8");
    const selection = readFileSync("src/components/adstudio/editor/ai-copy-selection.ts", "utf8");

    assert.match(shell, /<AiCopyAssistant[\s\S]*?<MetaCopyPanel/);
    assert.match(assistant, /Review suggestions/);
    assert.match(assistant, /Use all/);
    assert.match(assistant, /Use selected \(\{selectedCount\}\)/);
    assert.match(assistant, /<Checkbox/);
    assert.match(selection, /selectedAiCopyPayload/);
    assert.match(selection, /metaCopySelectionKey/);
    assert.doesNotMatch(shell, /applyCompleteCopy\(next\.onImage, next\.copy\)/);
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
