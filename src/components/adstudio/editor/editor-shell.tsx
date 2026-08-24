"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TemplatePack, Placement, LayoutLayer, ImageSlotLayer, Rect } from "../../../../packages/ad-template-pack-contract/src/types";
import type { AdDocumentParsed } from "../../../../packages/ad-template-pack-contract/src/schema";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-pack-contract/src/types";
import { buildAdDocument, brandPackColoursToRoleMap, editorTextInputs, resolveColourMap, useEditorState, type BrandPackColours, type EditorState, type MetaCopy } from "./use-editor-state";
import { ColourToggle } from "./colour-toggle";
import { CropDialog } from "./crop-dialog";
import { InputsPanel } from "./inputs-panel";
import { LayoutSchematic } from "./layout-schematic";
import { MetaCopyPanel } from "./meta-copy-panel";
import { uploadCustomerImage } from "./customer-image-upload";
import { cn } from "@/lib/utils";

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
  initialDocument?: AdDocumentParsed;
  initialRevision?: number;
}

export function EditorShell({ pack, adId, workspaceId, canSave = true, brandColours = null, initialDocument, initialRevision }: EditorShellProps) {
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
    updateImagePreview,
    updateCrop,
    setColourMode,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
    updateMetaCopy,
  } = useEditorState(pack, initialDocument, initialRevision);

  /** Which slot's crop dialog is open — always the ACTIVE placement's crop. */
  const [cropTarget, setCropTarget] = useState<{ slot: ImageSlotLayer; placement: Placement } | null>(null);
  const [proposalBrief, setProposalBrief] = useState("");
  const [proposal, setProposal] = useState<{ onImage: Record<string, string>; copy: MetaCopy; source: string } | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [pendingImageUploads, setPendingImageUploads] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const imageUploadTokens = useRef(new Map<string, number>());

  const handleImageChange = useCallback(async (key: string, change: { file: File; previewUrl: string } | null) => {
    const token = (imageUploadTokens.current.get(key) ?? 0) + 1;
    imageUploadTokens.current.set(key, token);
    if (!change) {
      updateImageValue(key, null, null);
      return;
    }
    // Keep the last verified ref visible if a replacement upload fails. The
    // preview is optimistic, but it must never replace a persisted image with
    // an invalid or half-uploaded value.
    const previousValue = state.imageValues.find(value => value.inputKey === key);
    setPendingImageUploads(count => count + 1);
    updateImagePreview(key, change.previewUrl);
    try {
      const uploaded = await uploadCustomerImage({ file: change.file, adId, workspaceId });
      if (imageUploadTokens.current.get(key) !== token) return;
      updateImageValue(key, uploaded.ref, change.previewUrl);
    } catch (error) {
      if (imageUploadTokens.current.get(key) !== token) return;
      updateImageValue(key, previousValue?.dataUrl ?? null, null);
      setError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setPendingImageUploads(count => Math.max(0, count - 1));
    }
  }, [adId, workspaceId, state.imageValues, updateImagePreview, updateImageValue, setError]);

  /** Open the crop dialog for a slot (no-op until an image is picked). */
  const openCrop = useCallback(
    (slot: ImageSlotLayer) => {
      const value = state.imageValues.find(iv => iv.inputKey === slot.inputKey);
      if (!value?.dataUrl && !value?.previewUrl) return; // nothing to crop yet
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
    const savedEditVersion = state.editVersion ?? 0;
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
      markSaved(body.ad?.revisionNumber ?? state.lastSavedRevision ?? 0, savedEditVersion);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [adId, workspaceId, state, markSaved, setSaving, setError]);

  const proposeCopy = useCallback(async () => {
    setProposalBusy(true);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/copy-proposal?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: proposalBrief, copy: state.metaCopy }),
      });
      const body = await response.json() as { onImage?: Record<string, string>; copy?: MetaCopy; source?: string; error?: string };
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Copy proposal failed.");
      setProposal({ onImage: body.onImage ?? {}, copy: body.copy, source: body.source ?? "ai" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy proposal failed.");
    } finally {
      setProposalBusy(false);
    }
  }, [adId, workspaceId, proposalBrief, state.metaCopy, setError]);

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
      className="flex h-full min-w-0 flex-col overflow-hidden bg-(--canvas)"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Ad Studio editor"
    >
      {/* Top bar: tabs + actions */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-(--line) bg-(--surface) px-3 py-2 xl:h-14 xl:flex-nowrap xl:justify-between xl:px-5 xl:py-0">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {(["feed", "story"] as Placement[]).map(p => (
            <button
              key={p}
              onClick={() => setActivePlacement(p)}
              className={`shrink-0 rounded-(--r-control) px-3 py-2 text-xs font-medium transition xl:px-4 xl:text-sm ${
                state.activePlacement === p
                  ? "bg-(--ui-primary) text-white"
                  : "text-muted-foreground hover:bg-(--surface-subtle)"
              }`}
              aria-pressed={state.activePlacement === p}
            >
              {p === "feed" ? "Feed (1080×1350)" : "Story (1080×1920)"}
            </button>
          ))}
          <span className="mx-2 hidden h-5 w-px bg-(--line) xl:block" aria-hidden="true" />
          <div className="hidden xl:block">
            <ColourToggle
              useBrandPack={state.colourMode === "brand_pack"}
              brandPackAvailable={!!brandColours}
              resolvedColourMap={state.resolvedColourMap}
              onToggle={handleColourToggle}
            />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 xl:gap-2">
          {pendingImageUploads > 0 && (
            <span className="hidden text-xs text-muted-foreground sm:inline">Uploading image...</span>
          )}
          {state.isDirty && pendingImageUploads === 0 && (
            <span className="hidden text-xs text-muted-foreground sm:inline">Unsaved changes</span>
          )}
          {state.lastSavedRevision !== null && !state.isDirty && (
            <span className="hidden text-xs text-muted-foreground sm:inline">Saved</span>
          )}
          <button
            onClick={undo}
            disabled={!canUndo}
            className="size-9 rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Undo"
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="size-9 rounded-(--r-control) p-2 text-muted-foreground hover:bg-(--surface-subtle) disabled:opacity-30"
            aria-label="Redo"
          >
            ↪
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || state.isSaving || pendingImageUploads > 0}
            className="h-9 rounded-(--r-control) bg-(--ui-primary) px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:px-4 sm:text-sm"
          >
            {state.isSaving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={handlePublish}
            disabled={!canSave || state.isSaving || pendingImageUploads > 0}
            className="h-9 rounded-(--r-control) bg-green-600 px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 sm:px-4 sm:text-sm"
            title={state.isDirty ? "Save first — publishing freezes the last saved revision" : "Freeze last saved revision and create PAUSED on Meta"}
          >
            Publish
          </button>
        </div>
      </header>

      {/* Main area: layer panel + canvas */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        {/* Layer panel */}
        <aside
          aria-label="Layers"
          className={cn(
            "z-30 w-56 shrink-0 overflow-y-auto border-r border-(--line) bg-(--surface) p-3",
            mobilePanel === "layers"
              ? "absolute inset-x-2 bottom-14 top-2 block max-h-[min(60%,30rem)] rounded-(--r-card) border shadow-xl"
              : "hidden",
            "xl:static xl:top-auto xl:right-auto xl:bottom-auto xl:left-auto xl:block xl:h-auto xl:max-h-none xl:rounded-none xl:border-b-0 xl:border-l-0 xl:border-t-0 xl:p-3 xl:shadow-none",
          )}
        >
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
        <main className="order-first flex min-h-0 min-w-0 flex-1 items-center justify-center bg-(--surface-subtle) p-3 xl:order-none xl:p-6">
          <div className="relative flex max-h-full max-w-[90%] flex-col items-center gap-2">
            <span className="rounded-full bg-(--surface) px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
              Editor preview · schematic — final PNG may differ slightly
            </span>
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
              imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.previewUrl ?? iv.dataUrl]))}
              textValues={state.textValues}
              cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops[state.activePlacement]]))}
              selectedLayerId={state.selectedLayerId}
              onSelect={selectLayer}
              onCropImage={openCrop}
              className="h-full w-full"
            />
            </div>
          </div>
        </main>

        {/* Content panel — shared text + image inputs (Feed and Story both use these) */}
        <InputsPanel
          className={cn(
            mobilePanel === "content"
              ? "absolute inset-x-2 bottom-14 top-2 z-30 block max-h-[min(60%,30rem)] w-auto max-w-[calc(100%-1rem)] rounded-(--r-card) border shadow-xl"
              : "hidden",
            "xl:static xl:block xl:h-auto xl:max-h-none xl:w-72 xl:max-w-none xl:rounded-none xl:border-b-0 xl:border-t-0 xl:shadow-none",
          )}
          textInputs={editorTextInputs(pack)}
          imageInputs={pack.imageInputs}
          textValues={state.textValues}
          imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.previewUrl ?? iv.dataUrl]))}
          onTextChange={updateTextValue}
          onImageChange={handleImageChange}
          onCropClick={openCropForInput}
        />

        {/* Meta copy panel — primary text, headline, description, CTA (shared across placements) */}
        <MetaCopyPanel
          className={cn(
            mobilePanel === "meta"
              ? "absolute inset-x-2 bottom-14 top-2 z-30 block max-h-[min(60%,30rem)] w-auto max-w-[calc(100%-1rem)] rounded-(--r-card) border shadow-xl"
              : "hidden",
            "xl:static xl:block xl:h-auto xl:max-h-none xl:w-72 xl:max-w-none xl:rounded-none xl:border-b-0 xl:border-t-0 xl:shadow-none",
          )}
          values={state.metaCopy}
          onChange={updateMetaCopy}
        />
        <ProposalPanel
          className={cn(
            mobilePanel === "ai"
              ? "absolute inset-x-2 bottom-14 top-2 z-30 block max-h-[min(60%,30rem)] w-auto max-w-[calc(100%-1rem)] rounded-(--r-card) border shadow-xl"
              : "hidden",
            "xl:static xl:block xl:h-auto xl:max-h-none xl:w-72 xl:max-w-none xl:rounded-none xl:border-b-0 xl:border-t-0 xl:shadow-none",
          )}
          brief={proposalBrief}
          proposal={proposal}
          busy={proposalBusy}
          textInputs={editorTextInputs(pack)}
          onBriefChange={setProposalBrief}
          onPropose={proposeCopy}
          onApplyText={updateTextValue}
          onApplyMeta={updateMetaCopy}
        />

        {mobilePanel === "palette" && (
          <aside
            aria-label="Palette"
            className="absolute inset-x-2 bottom-14 top-2 z-30 max-h-[min(60%,30rem)] overflow-y-auto rounded-(--r-card) border border-(--line) bg-(--surface) p-4 shadow-xl xl:hidden"
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Palette</h3>
            <ColourToggle
              useBrandPack={state.colourMode === "brand_pack"}
              brandPackAvailable={!!brandColours}
              resolvedColourMap={state.resolvedColourMap}
              onToggle={handleColourToggle}
            />
          </aside>
        )}

        <div className="z-20 flex shrink-0 items-center gap-1 overflow-x-auto border-t border-(--line) bg-(--surface) p-2 xl:hidden" role="navigation" aria-label="Editor panels">
          {MOBILE_PANELS.map(panel => (
            <button
              key={panel.key}
              type="button"
              aria-pressed={mobilePanel === panel.key}
              onClick={() => setMobilePanel(current => current === panel.key ? null : panel.key)}
              className={cn(
                "min-h-11 shrink-0 rounded-(--r-control) border px-3 text-xs font-semibold transition",
                mobilePanel === panel.key
                  ? "border-(--ui-primary) bg-(--ui-primary) text-white"
                  : "border-(--line) bg-(--surface) text-foreground hover:bg-(--surface-subtle)",
              )}
            >
              {panel.label}
            </button>
          ))}
          {mobilePanel && (
            <button
              type="button"
              aria-label="Close panel"
              onClick={() => setMobilePanel(null)}
              className="ml-auto grid min-h-11 min-w-11 shrink-0 place-items-center rounded-(--r-control) border border-(--line) text-lg text-muted-foreground hover:bg-(--surface-subtle)"
            >
              ×
            </button>
          )}
        </div>
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

function ProposalPanel({
  className,
  brief,
  proposal,
  busy,
  textInputs,
  onBriefChange,
  onPropose,
  onApplyText,
  onApplyMeta,
}: {
  className?: string;
  brief: string;
  proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null;
  busy: boolean;
  textInputs: Array<{ key: string; label: string }>;
  onBriefChange: (value: string) => void;
  onPropose: () => void;
  onApplyText: (key: string, value: string) => void;
  onApplyMeta: (field: keyof MetaCopy, value: string) => void;
}) {
  return (
    <aside aria-label="AI copy help" className={cn("w-72 shrink-0 overflow-y-auto border-l border-(--line) bg-(--surface) p-4", className)}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI copy help</h3>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Get a draft for the overlay and Meta copy. Nothing changes until you apply a suggestion.</p>
      <textarea value={brief} onChange={event => onBriefChange(event.target.value)} rows={4} placeholder="Describe the property, offer or audience…" className="w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-3 py-2 text-sm" />
      <button type="button" onClick={onPropose} disabled={busy} className="mt-2 w-full rounded-(--r-control) bg-(--ui-primary) px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Drafting…" : "Suggest copy"}</button>
      {proposal ? (
        <div className="mt-4 space-y-3 text-sm">
          <span className="text-[11px] text-muted-foreground">{proposal.source === "fallback" ? "Safe deterministic draft" : "AI draft"}</span>
          {textInputs.filter(input => proposal.onImage[input.key]).map(input => (
            <div key={input.key}>
              <span className="text-xs text-muted-foreground">{input.label}</span>
              <p className="mt-0.5 rounded border border-(--line) p-2">{proposal.onImage[input.key]}</p>
              <button type="button" onClick={() => onApplyText(input.key, proposal.onImage[input.key])} className="mt-1 text-xs font-medium text-(--ui-primary)">Use overlay suggestion</button>
            </div>
          ))}
          {(Object.keys(proposal.copy) as Array<keyof MetaCopy>).map(field => (
            <div key={field}>
              <span className="text-xs capitalize text-muted-foreground">{field.replace(/([A-Z])/g, " $1")}</span>
              <p className="mt-0.5 rounded border border-(--line) p-2 whitespace-pre-wrap">{proposal.copy[field]}</p>
              <button type="button" onClick={() => onApplyMeta(field, proposal.copy[field])} className="mt-1 text-xs font-medium text-(--ui-primary)">Use Meta suggestion</button>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
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
  if (!input || (!value?.dataUrl && !value?.previewUrl)) return null;

  return (
    <CropDialog
      imageUrl={value.previewUrl ?? value.dataUrl!}
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

type MobilePanel = "layers" | "content" | "meta" | "ai" | "palette" | null;

const MOBILE_PANELS: Array<{ key: Exclude<MobilePanel, null>; label: string }> = [
  { key: "layers", label: "Layers" },
  { key: "content", label: "Content" },
  { key: "meta", label: "Meta copy" },
  { key: "ai", label: "AI help" },
  { key: "palette", label: "Palette" },
];

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
