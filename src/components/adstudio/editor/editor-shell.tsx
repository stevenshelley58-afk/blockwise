"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplatePack, Placement, LayoutLayer, ImageSlotLayer, Rect } from "../../../../packages/ad-template-pack-contract/src/types";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-pack-contract/src/types";
import { buildAdDocument, brandPackColoursToRoleMap, resolveColourMap, useEditorState, type BrandPackColours, type EditorState } from "./use-editor-state";
import { ColourToggle } from "./colour-toggle";
import { CropDialog } from "./crop-dialog";
import { InputsPanel } from "./inputs-panel";
import { LayoutSchematic } from "./layout-schematic";
import { MetaCopyPanel } from "./meta-copy-panel";

// ---------------------------------------------------------------------------
// Editor Shell — Phase 6 foundation
//
// Feed and Story tabs, live SVG layout schematic (follows the active
// placement, click-to-select layers), shared text/image content inputs,
// layer selection, template-vs-Brand-Pack colour toggle, undo/redo,
// dirty/saved/error state.
// Save persists the AdDocument through POST /api/adstudio/ads/[id]/save —
// the server renders Feed AND Story PNGs.
// ---------------------------------------------------------------------------

export interface EditorShellProps {
  pack: TemplatePack;
  /** Customer ad row the document saves against (created server-side). */
  adId: string;
  /** Workspace scope for the Save API call. */
  workspaceId: string;
  /** Whether Save is enabled. */
  canSave?: boolean;
  /**
   * The workspace Brand Pack's colours block (loaded server-side by the pack
   * page — latest non-demo kit). Null when the workspace has no Brand Pack;
   * the colour toggle is then disabled and the template palette stays.
   */
  brandColours?: BrandPackColours | null;
}

export function EditorShell({ pack, adId, workspaceId, canSave = true, brandColours = null }: EditorShellProps) {
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
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
    updateMetaCopy,
  } = useEditorState(pack);

  /** Which slot's crop dialog is open — always the ACTIVE placement's crop. */
  const [cropTarget, setCropTarget] = useState<{ slot: ImageSlotLayer; placement: Placement } | null>(null);

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

  // Template colours always resolve; checking the toggle overlays the
  // workspace Brand Pack palette. Roles the brand kit lacks (inverseText)
  // keep the template value — never invent a palette.
  const handleColourToggle = useCallback(
    (useBrandPack: boolean) => {
      if (useBrandPack) {
        setColourMode(
          "brand_pack",
          resolveColourMap(pack.semanticColours, "brand_pack", brandPackColoursToRoleMap(brandColours)),
        );
      } else {
        setColourMode("template");
      }
    },
    [pack.semanticColours, brandColours, setColourMode],
  );

  return (
    <div
      className="flex h-full flex-col bg-(--canvas)"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Ad Studio editor"
    >
      {/* Top bar: tabs + actions */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-(--line) bg-(--surface) px-5">
        <div className="flex items-center gap-1">
          {(["feed", "story"] as Placement[]).map(p => (
            <button
              key={p}
              onClick={() => setActivePlacement(p)}
              className={`rounded-(--r-control) px-4 py-2 text-sm font-medium transition ${
                state.activePlacement === p
                  ? "bg-(--ui-primary) text-white"
                  : "text-muted-foreground hover:bg-(--surface-subtle)"
              }`}
              aria-pressed={state.activePlacement === p}
            >
              {p === "feed" ? "Feed (1080×1350)" : "Story (1080×1920)"}
            </button>
          ))}
          <span className="mx-2 h-5 w-px bg-(--line)" aria-hidden="true" />
          <ColourToggle
            useBrandPack={state.colourMode === "brand_pack"}
            brandPackAvailable={!!brandColours}
            resolvedColourMap={state.resolvedColourMap}
            onToggle={handleColourToggle}
          />
        </div>

        <div className="flex items-center gap-2">
          {state.isDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          {state.lastSavedRevision !== null && !state.isDirty && (
            <span className="text-xs text-muted-foreground">Saved</span>
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
            className="rounded-(--r-control) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {state.isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handlePublish}
            disabled={!canSave || state.isSaving}
            className="rounded-(--r-control) bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            title={state.isDirty ? "Save first — publishing freezes the last saved revision" : "Freeze last saved revision and create PAUSED on Meta"}
          >
            Publish
          </button>
        </div>
      </header>

      {/* Main area: layer panel + canvas */}
      <div className="flex min-h-0 flex-1">
        {/* Layer panel */}
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-(--line) bg-(--surface) p-3">
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

        {/* Canvas area — live layer schematic for the active placement */}
        <main className="flex flex-1 items-center justify-center bg-(--surface-subtle) p-6">
          <div
            className="relative overflow-hidden rounded-(--r-card) bg-white shadow-lg"
            style={{
              aspectRatio: `${PLACEMENT_DIMENSIONS[state.activePlacement].width} / ${PLACEMENT_DIMENSIONS[state.activePlacement].height}`,
              maxHeight: "min(72vh, 800px)",
              maxWidth: "90%",
            }}
          >
            <LayoutSchematic
              layout={activeLayout}
              colours={state.resolvedColourMap}
              selectedLayerId={state.selectedLayerId}
              onSelect={selectLayer}
              onCropImage={openCrop}
              className="h-full w-full"
            />
          </div>
        </main>

        {/* Content panel — shared text + image inputs (Feed and Story both use these) */}
        <InputsPanel
          textInputs={pack.textInputs}
          imageInputs={pack.imageInputs}
          textValues={state.textValues}
          imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.dataUrl]))}
          onTextChange={updateTextValue}
          onImageChange={updateImageValue}
          onCropClick={openCropForInput}
        />

        {/* Meta copy panel — primary text, headline, description, CTA (shared across placements) */}
        <MetaCopyPanel values={state.metaCopy} onChange={updateMetaCopy} />
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
