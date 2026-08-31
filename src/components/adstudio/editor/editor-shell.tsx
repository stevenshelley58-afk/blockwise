"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplatePack, Placement, LayoutLayer, ImageSlotLayer, Rect } from "../../../../packages/ad-template-pack-contract/src/types";
import { brandPackColoursToRoleMap, buildAdDocument, editorTextInputs, hasTemplateCopy, resolveColourMap, useEditorState, type BrandPackColours, type EditorState, type SavedEditorSeed } from "./use-editor-state";
import { ColourPanel } from "./colour-panel";
import { CropDialog } from "./crop-dialog";
import { InputsPanel } from "./inputs-panel";
import { LayoutSchematic } from "./layout-schematic";
import { MetaCopyPanel } from "./meta-copy-panel";
import { FeedPreview, StoryPreview } from "./meta-previews";

// ---------------------------------------------------------------------------
// Editor Shell — Creative / Ad copy / Colours tabs.
//
// Center stage shows a placement-specific Meta preview (Feed 4:5 card or
// full-bleed 9:16 Story) built from the real creative, copy, assets and
// resolved palette — it updates live with every edit.
//   Creative — "Use template copy", editable on-image text, uploaded assets.
//   Ad copy  — brief + AI generation, editable Meta copy, CTA.
//   Colours  — template / Brand Pack / custom per-role colour modes.
// Save persists the AdDocument through POST /api/adstudio/ads/[id]/save —
// the server renders Feed AND Story PNGs.
// ---------------------------------------------------------------------------

export interface EditorBrandPack {
  colours: BrandPackColours;
  /** Customer-facing business name for the Meta previews. */
  businessName: string;
  /** Brand Pack logo for the Meta preview avatar; null → initials fallback. */
  logoUrl: string | null;
}

export interface EditorShellProps {
  pack: TemplatePack;
  /** Customer ad row the document saves against (created server-side). */
  adId: string;
  /** Workspace scope for the Save API call. */
  workspaceId: string;
  /** Whether Save is enabled. */
  canSave?: boolean;
  /** The workspace Brand Pack (latest non-demo kit), or null when none. */
  brandPack?: EditorBrandPack | null;
  /**
   * Saved-document seed for an EXISTING ad (server-loaded). Null for a brand
   * new ad — the editor then starts with empty placeholders and never
   * auto-inserts template copy.
   */
  savedSeed?: SavedEditorSeed | null;
}

type EditorTab = "creative" | "copy" | "colours";

const TABS: Array<{ id: EditorTab; label: string }> = [
  { id: "creative", label: "Creative" },
  { id: "copy", label: "Ad copy" },
  { id: "colours", label: "Colours" },
];

export function EditorShell({ pack, adId, workspaceId, canSave = true, brandPack = null, savedSeed = null }: EditorShellProps) {
  const router = useRouter();
  const {
    state,
    activeLayout,
    canUndo,
    canRedo,
    setActivePlacement,
    selectLayer,
    updateTextValue,
    updateImageValue,
    updateCrop,
    setColourMode,
    updateCustomColour,
    useTemplateCopy,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
    updateMetaCopy,
  } = useEditorState(pack, savedSeed);

  const [activeTab, setActiveTab] = useState<EditorTab>("creative");

  /** Which slot's crop dialog is open — always the ACTIVE placement's crop. */
  const [cropTarget, setCropTarget] = useState<{ slot: ImageSlotLayer; placement: Placement } | null>(null);

  // AI copy workflow state — generating / failure / retry are all explicit.
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedOnce, setGeneratedOnce] = useState(false);

  const imageValuesMap = Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.dataUrl]));
  const businessName = brandPack?.businessName?.trim() || "Your business";
  const logoUrl = brandPack?.logoUrl ?? null;

  /** Open the crop dialog for a slot (no-op until an image is picked). */
  const openCrop = useCallback(
    (slot: ImageSlotLayer) => {
      const value = state.imageValues.find(iv => iv.inputKey === slot.inputKey);
      if (!value?.dataUrl) return; // nothing to crop yet
      setCropTarget({ slot, placement: state.activePlacement });
    },
    [state.imageValues, state.activePlacement],
  );

  /** Resolve an input key to its first image slot in the active layout. */
  const openCropForInput = useCallback(
    (key: string) => {
      const slot = activeLayout.layers.find((l): l is ImageSlotLayer => l.type === "image_slot" && l.inputKey === key);
      if (slot) openCrop(slot);
    },
    [activeLayout, openCrop],
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const document = await buildAdDocument(state);
      const res = await fetch(
        `/api/adstudio/ads/${encodeURIComponent(adId)}/save?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document, expectedRevision: state.lastSavedRevision ?? 0 }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { ad?: { revisionNumber?: number }; error?: string };
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      markSaved(body.ad?.revisionNumber ?? state.lastSavedRevision ?? 0);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [adId, workspaceId, state, markSaved, setSaving, setError]);

  /**
   * AI copy generation: posts the brief to the existing copy-proposal
   * endpoint and inserts the generated primary text, headline and
   * description straight into the ordinary editable fields. The CTA
   * selection is preserved. On-image overlay suggestions are applied to the
   * text fields too — every field stays editable either way.
   */
  const generateCopy = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/copy-proposal?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, copy: state.metaCopy }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        onImage?: Record<string, string>;
        copy?: Partial<{ primaryText: string; headline: string; description: string; cta: string }>;
        error?: string;
      };
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Copy generation failed.");
      const { primaryText = "", headline = "", description = "" } = body.copy;
      updateMetaCopy("primaryText", primaryText);
      updateMetaCopy("headline", headline);
      updateMetaCopy("description", description);
      // CTA is a deliberate selection — generation never overwrites it.
      for (const [key, value] of Object.entries(body.onImage ?? {})) {
        if (typeof value === "string" && value.trim()) updateTextValue(key, value);
      }
      setGeneratedOnce(true);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Copy generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [adId, workspaceId, brief, state.metaCopy, updateMetaCopy, updateTextValue]);

  /**
   * Publish always freezes the LAST SAVED revision (server-side). If the
   * editor is dirty there is no saved revision for that content yet, so Save
   * first; if Save fails, refuse to navigate (the error banner explains why).
   */
  const handlePublish = useCallback(async () => {
    if (state.isDirty || state.lastSavedRevision === null) {
      const saved = await handleSave();
      if (!saved) return; // error banner already set — refuse
    }
    router.push(`/ad-studio/packs/${encodeURIComponent(pack.packId)}/publish`);
  }, [state.isDirty, state.lastSavedRevision, handleSave, router, pack.packId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if (e.key === "Escape") {
      selectLayer(null);
    }
  }, [undo, redo, selectLayer]);

  /** Colour mode selection — Brand Pack overlays its roles onto the template palette. */
  const handleSelectColourMode = useCallback(
    (mode: EditorState["colourMode"]) => {
      if (mode === "brand_pack" && brandPack) {
        setColourMode("brand_pack", resolveColourMap(pack.semanticColours, "brand_pack", brandPackColoursToRoleMap(brandPack.colours)));
      } else {
        setColourMode(mode);
      }
    },
    [brandPack, pack.semanticColours, setColourMode],
  );

  const showTemplateCopyButton = hasTemplateCopy(pack);

  return (
    <div
      className="flex h-full flex-col bg-(--canvas)"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Ad Studio editor"
    >
      {/* Top bar: placement tabs + actions */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-(--line) bg-(--surface) px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-1">
          {(["feed", "story"] as Placement[]).map(p => (
            <button
              key={p}
              onClick={() => setActivePlacement(p)}
              className={`rounded-(--r-control) px-3 py-2 text-sm font-medium transition sm:px-4 ${
                state.activePlacement === p
                  ? "bg-(--ui-primary) text-white"
                  : "text-muted-foreground hover:bg-(--surface-subtle)"
              }`}
              aria-pressed={state.activePlacement === p}
            >
              {p === "feed" ? "Feed" : "Story"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {state.isDirty && (
            <span className="hidden text-xs text-muted-foreground sm:inline">Unsaved changes</span>
          )}
          {state.lastSavedRevision !== null && !state.isDirty && (
            <span className="hidden text-xs text-muted-foreground sm:inline">Saved</span>
          )}
          <button
            onClick={undo}
            disabled={!canUndo}
            className="rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Undo"
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Redo"
          >
            ↪
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || state.isSaving}
            className="rounded-(--r-control) border border-(--line) px-4 py-2 text-sm font-semibold text-foreground hover:bg-(--surface-subtle) disabled:opacity-50"
          >
            {state.isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handlePublish}
            disabled={!canSave || state.isSaving}
            className="rounded-(--r-control) bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            title={state.isDirty ? "Save first — publishing freezes the last saved revision" : "Publish this ad to Meta"}
          >
            Publish
          </button>
        </div>
      </header>

      {/* Main area: layers + live Meta preview + tabbed panel */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Layer panel — desktop only; on mobile the preview + tabs matter more */}
        <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-(--line) bg-(--surface) p-3 lg:block">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Layers
          </h3>
          <ul className="space-y-1">
            {[...activeLayout.layers].reverse().map(layer => (
              <li key={layer.layerId}>
                <button
                  onClick={() => selectLayer(layer.layerId)}
                  className={`w-full rounded-(--r-control) px-3 py-2 text-left text-sm transition ${
                    state.selectedLayerId === layer.layerId
                      ? "bg-(--ui-primary)/10 text-(--ui-primary) ring-1 ring-(--ui-primary)/30"
                      : "text-foreground hover:bg-(--surface-subtle)"
                  }`}
                >
                  <span className="text-xs text-muted-foreground">{layerTypeLabel(layer.type)}</span>
                  <span className="ml-2">{layerLabel(layer)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Live Meta preview for the ACTIVE placement */}
        <main
          className="flex min-h-[60vh] flex-1 items-start justify-center overflow-y-auto bg-(--surface-subtle) p-4 sm:p-6 lg:min-h-0 lg:items-center"
          aria-label={`${state.activePlacement} preview`}
        >
          {state.activePlacement === "feed" ? (
            <FeedPreview
              layout={activeLayout}
              colours={state.resolvedColourMap}
              textValues={state.textValues}
              imageValues={imageValuesMap}
              copy={state.metaCopy}
              businessName={businessName}
              logoUrl={logoUrl}
              className="my-auto"
            />
          ) : (
            <StoryPreview
              layout={activeLayout}
              colours={state.resolvedColourMap}
              textValues={state.textValues}
              imageValues={imageValuesMap}
              copy={state.metaCopy}
              businessName={businessName}
              logoUrl={logoUrl}
              className="my-auto"
            />
          )}
        </main>

        {/* Tabbed panel — side column on desktop, full-width section on mobile */}
        <aside className="w-full shrink-0 border-t border-(--line) bg-(--surface) lg:w-80 lg:border-l lg:border-t-0">
          <div role="tablist" aria-label="Editor panels" className="flex border-b border-(--line)">
            {TABS.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  activeTab === tab.id
                    ? "border-(--ui-primary) text-(--ui-primary)"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4 lg:max-h-[calc(100vh-8.5rem)]">
            {activeTab === "creative" && (
              <div className="space-y-4">
                {showTemplateCopyButton && (
                  <div className="rounded-(--r-control) border border-(--line) bg-(--surface-subtle) p-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      This template ships with suggested copy. Use it as a starting
                      point — everything stays editable, and your own text is never
                      overwritten.
                    </p>
                    <button
                      type="button"
                      onClick={useTemplateCopy}
                      className="mt-2 w-full rounded-(--r-control) border border-(--ui-primary) px-3 py-2 text-sm font-semibold text-(--ui-primary) transition hover:bg-(--ui-primary)/10"
                    >
                      Use template copy
                    </button>
                  </div>
                )}
                <InputsPanel
                  textInputs={editorTextInputs(pack)}
                  imageInputs={pack.imageInputs}
                  textValues={state.textValues}
                  imageValues={imageValuesMap}
                  onTextChange={updateTextValue}
                  onImageChange={updateImageValue}
                  onCropClick={openCropForInput}
                />
              </div>
            )}

            {activeTab === "copy" && (
              <div className="space-y-4">
                <section aria-label="AI copy generation" className="rounded-(--r-control) border border-(--line) bg-(--surface-subtle) p-3">
                  <h4 className="mb-1 text-sm font-semibold text-foreground">Generate copy with AI</h4>
                  <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
                    Describe the property, offer or audience. Generated primary text,
                    headline and description are inserted below — edit them freely.
                    Your CTA choice is kept.
                  </p>
                  <textarea
                    value={brief}
                    onChange={event => setBrief(event.target.value)}
                    rows={4}
                    placeholder="e.g. Family home open this Saturday in Joondalup, first-home buyers, highlight the renovated kitchen…"
                    className="w-full rounded-(--r-control) border border-(--line) bg-(--surface) px-3 py-2 text-sm text-foreground outline-none focus:border-(--ui-primary)"
                    aria-label="Copy brief"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={generateCopy}
                      disabled={generating || brief.trim().length === 0}
                      className="flex-1 rounded-(--r-control) bg-(--ui-primary) px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {generating ? "Generating…" : generatedOnce ? "Regenerate copy" : "Generate copy"}
                    </button>
                    {generateError && (
                      <button
                        type="button"
                        onClick={generateCopy}
                        disabled={generating}
                        className="rounded-(--r-control) border border-(--line) px-3 py-2 text-sm font-medium text-foreground transition hover:bg-(--surface)"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                  {generating && (
                    <p className="mt-2 text-xs text-muted-foreground" role="status">
                      Drafting your copy — this usually takes a few seconds…
                    </p>
                  )}
                  {generateError && (
                    <p className="mt-2 text-xs text-red-600" role="alert">
                      {generateError} Your existing copy is unchanged.
                    </p>
                  )}
                </section>

                <MetaCopyPanel
                  values={state.metaCopy}
                  onChange={updateMetaCopy}
                />
              </div>
            )}

            {activeTab === "colours" && (
              <ColourPanel
                colourMode={state.colourMode}
                templateColours={pack.semanticColours}
                brandColours={brandPack?.colours ?? null}
                resolvedColourMap={state.resolvedColourMap}
                onSelectMode={handleSelectColourMode}
                onChangeCustomRole={updateCustomColour}
              />
            )}
          </div>
        </aside>
      </div>

      {/* Crop dialog — per-placement crop for the selected image slot */}
      {cropTarget && <CropDialogHost cropTarget={cropTarget} state={state} pack={pack} onApply={updateCrop} onClose={() => setCropTarget(null)} />}

      {/* Error banner */}
      {state.error && (
        <div
          className="border-t border-red-200 bg-red-50 px-5 py-2 text-sm text-red-700"
          role="alert"
        >
          {state.error}
        </div>
      )}
    </div>
  );
}

function layerTypeLabel(type: LayoutLayer["type"]): string {
  switch (type) {
    case "plate": return "BG";
    case "image_slot": return "IMG";
    case "overlay_patch": return "FX";
    case "text": return "TXT";
    case "logo": return "LOG";
  }
}

function layerLabel(layer: LayoutLayer): string {
  switch (layer.type) {
    case "plate": return "Background";
    case "image_slot": return layer.inputKey;
    case "overlay_patch": return `Overlay ${Math.round(layer.opacity * 100)}%`;
    case "text": return layer.inputKey;
    case "logo": return layer.inputKey;
  }
}

// ---------------------------------------------------------------------------
// CropDialogHost — resolves the open crop target into CropDialog props.
// The crop rect always targets the placement the slot belongs to, so Feed
// and Story keep independent crops for the same shared image.
// ---------------------------------------------------------------------------

function CropDialogHost({
  cropTarget,
  state,
  pack,
  onApply,
  onClose,
}: {
  cropTarget: { slot: ImageSlotLayer; placement: Placement };
  state: EditorState;
  pack: TemplatePack;
  onApply: (key: string, placement: Placement, crop: Rect) => void;
  onClose: () => void;
}) {
  const { slot, placement } = cropTarget;
  const input = pack.imageInputs.find(i => i.key === slot.inputKey);
  const value = state.imageValues.find(iv => iv.inputKey === slot.inputKey);
  if (!input || !value?.dataUrl) return null;

  return (
    <CropDialog
      imageUrl={value.dataUrl}
      input={input}
      crop={value.crops[placement] ?? slot.defaultCrop}
      aspectRatio={slot.geometry.width / slot.geometry.height}
      onConfirm={crop => {
        onApply(slot.inputKey, placement, crop);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
