"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlignLeft, ArrowLeft, Crop, Eye, Image as ImageIcon, Layers3, MousePointer2, Palette, PanelRightClose, PanelRightOpen, PencilLine, RotateCcw, RotateCw, Save, Type, ZoomIn, ZoomOut } from "lucide-react";
import type { AdTemplate, Placement, ImageSlotLayer, LayoutLayer, Layout, Rect, ColourRole } from "../../../../packages/ad-template-contract/src/types";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-contract/src/types";
import { buildAdDocument, brandPackColoursToRoleMap, editorTextInputs, hasTemplateCopy, previewTextValues, resolveColourMap, useEditorState, type BrandPackColours, type EditorState, type MetaCopy } from "./use-editor-state";
import { ColourToggle, type ColourMode } from "./colour-toggle";
import { CropDialog } from "./crop-dialog";
import { InputsPanel } from "./inputs-panel";
import { LayeredCanvas } from "./layered-canvas";
import { MetaCopyPanel } from "./meta-copy-panel";
import { FeedPreview, StoryPreview } from "./meta-previews";
import { uploadCustomerImage } from "./customer-image-upload";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { META_COPY_CONSTRAINTS } from "../../../lib/adstudio/meta-copy-contract";
import { templateAssetProxyUrl } from "@/lib/adstudio/pack-gallery";

// ---------------------------------------------------------------------------
// Editor Shell — Phase 6 foundation
//
// Feed and Story tabs, live SVG layout preview (follows the active
// placement, click-to-select layers), shared text/image content inputs,
// layer selection, template-vs-Brand-Pack colour toggle, undo/redo,
// dirty/saved/error state.
// Save persists the AdDocument through POST /api/adstudio/ads/[id]/save —
// the server renders Feed AND Story PNGs.
// ---------------------------------------------------------------------------

export interface EditorShellProps {
  pack: AdTemplate;
  /** Customer ad row the document saves against (created server-side). */
  adId: string;
  /** Workspace scope for the Save API call. */
  workspaceId: string;
  /** Whether Save is enabled. */
  canSave?: boolean;
  /**
   * The workspace Brand Pack's colours block (loaded server-side by the pack
   * page — latest non-demo kit). Null when the workspace has no Brand Pack;
   * the workspace colour mode is then disabled and the template palette stays.
   */
  brandColours?: BrandPackColours | null;
  /**
   * The workspace Brand Pack's business name (Brand Studio identity). Used as
   * the DEFAULT display name for Meta previews; the customer's per-ad
   * override (brandBusinessName) wins when set.
   */
  brandBusinessName?: string;
  /**
   * Workspace library assets (Brand Studio uploads) offered as a per-slot
   * "Library…" source in the Visual tab, alongside direct upload.
   */
  libraryAssets?: Array<{ id?: string; url: string; label: string }>;
  /** Brand Pack primary logo URL for the Meta preview avatar (null → initials). */
  brandLogoUrl?: string | null;
  initialDocument?: AdDocumentParsed;
  initialRevision?: number;
  adName?: string;
}

type InspectorTab = "creative" | "copy" | "colours";
const INSPECTOR_TABS: Array<{ value: InspectorTab; label: string; icon: typeof PencilLine }> = [
  { value: "creative", label: "Media", icon: PencilLine },
  { value: "copy", label: "Content", icon: AlignLeft },
  { value: "colours", label: "Appearance", icon: Palette },
];

export function EditorShell({ pack, adId, workspaceId, canSave = true, brandColours = null, brandBusinessName = "", libraryAssets, brandLogoUrl = null, initialDocument, initialRevision, adName = "Untitled ad" }: EditorShellProps) {
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
    updateCustomColour,
    setTemplateCopyApplied,
    updateBusinessName,
    updateDestinationUrl,
    undo,
    redo,
    markSaved,
    setSaving,
    setError,
    updateMetaCopy,
    applyGeneratedCopy,
  } = useEditorState(pack, initialDocument, initialRevision);

  /** Which slot's crop dialog is open — always the ACTIVE placement's crop. */
  const [cropTarget, setCropTarget] = useState<{ slot: ImageSlotLayer; placement: Placement } | null>(null);
  const [proposalBrief, setProposalBrief] = useState("");
  const [proposal, setProposal] = useState<{ onImage: Record<string, string>; copy: Partial<MetaCopy>; source: string } | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [pendingImageUploads, setPendingImageUploads] = useState(0);
  const [saveConflict, setSaveConflict] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("copy");
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const imageUploadTokens = useRef(new Map<string, number>());
  const [pendingCropKey, setPendingCropKey] = useState<string | null>(null);
  const [name, setName] = useState(adName);
  const persistedName = useRef(adName);

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
      const slot = activeLayout.layers.find((l: LayoutLayer): l is ImageSlotLayer => l.type === "image_slot" && l.inputKey === key);
      if (slot) openCrop(slot);
    },
    [activeLayout, openCrop],
  );

  useEffect(() => {
    if (!pendingCropKey) return;
    const value = state.imageValues.find(item => item.inputKey === pendingCropKey);
    if (!value?.dataUrl) return;
    openCropForInput(pendingCropKey);
    setPendingCropKey(null);
  }, [pendingCropKey, state.imageValues, openCropForInput]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    const overLimit = [
      ...editorTextInputs(pack).filter(input => (state.textValues[input.key] ?? "").length > input.maxLength).map(input => `${input.label} is over its ${input.maxLength}-character limit.`),
      state.metaCopy.primaryText.length > META_COPY_CONSTRAINTS.primaryText ? `Primary text is over its ${META_COPY_CONSTRAINTS.primaryText}-character limit.` : "",
      state.metaCopy.headline.length > META_COPY_CONSTRAINTS.headline ? `Headline is over its ${META_COPY_CONSTRAINTS.headline}-character limit.` : "",
      state.metaCopy.description.length > META_COPY_CONSTRAINTS.description ? `Description is over its ${META_COPY_CONSTRAINTS.description}-character limit.` : "",
      state.metaCopy.cta.length > META_COPY_CONSTRAINTS.cta ? `Call to action is over its ${META_COPY_CONSTRAINTS.cta}-character limit.` : "",
    ].filter(Boolean);
    if (overLimit.length > 0) { setError(`Shorten copy before saving: ${overLimit.join(" ")}`); return false; }
    const missingImages = pack.imageInputs.filter(input => input.required !== false
      && !input.defaultAssetKey
      && !state.imageValues.find(value => value.inputKey === input.key)?.dataUrl);
    const missingText = editorTextInputs(pack).filter(input => !(state.textValues[input.key] ?? input.placeholder).trim());
    if (missingImages.length > 0 || missingText.length > 0) {
      const requirements = [
        missingImages.length > 0 ? `Add required images: ${missingImages.map(input => input.label).join(", ")}.` : "",
        missingText.length > 0 ? `Complete required text: ${missingText.map(input => input.label).join(", ")}.` : "",
      ].filter(Boolean).join(" ");
      setInspectorTab("creative");
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) setMobileInspectorOpen(true);
      setError(requirements);
      return false;
    }
    const savedEditVersion = state.editVersion ?? 0;
    setSaving(true);
    setError(null);
    setSaveConflict(false);
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
      const body = (await res.json().catch(() => ({}))) as { ad?: { revisionNumber?: number }; code?: string; error?: string };
      if (res.status === 409 || body.code === "stale_revision") {
        setSaveConflict(true);
        setError("This ad changed in another session. Reload the latest saved version before continuing.");
        return false;
      }
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      markSaved(body.ad?.revisionNumber ?? state.lastSavedRevision ?? 0, savedEditVersion);
      setSaveConflict(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }, [adId, workspaceId, pack, state, markSaved, setSaving, setError]);

  const persistName = useCallback(async () => {
    const next = name.trim().replace(/\s+/g, " ");
    if (!next) { setName(persistedName.current); return; }
    setName(next);
    if (next === persistedName.current) return;
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/rename?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: next }) });
      if (!response.ok) throw new Error("Ad name could not be saved.");
      persistedName.current = next;
      setName(next);
    } catch (error) { setError(error instanceof Error ? error.message : "Ad name could not be saved."); }
  }, [name, adId, workspaceId, setError]);

  const proposeCopy = useCallback(async () => {
    setProposalBusy(true);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/copy-proposal?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: proposalBrief, copy: state.metaCopy }),
      });
      const body = await response.json() as { onImage?: Record<string, string>; copy?: Partial<MetaCopy>; source?: string; error?: string };
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Copy proposal failed.");
      setProposal({ onImage: body.onImage ?? {}, copy: body.copy, source: body.source ?? "AI" });
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy proposal failed.");
    } finally {
      setProposalBusy(false);
    }
  }, [adId, workspaceId, proposalBrief, state.metaCopy, setError]);

  const useAllProposal = useCallback(() => {
    if (!proposal) return;
    applyGeneratedCopy(proposal.onImage, { ...state.metaCopy, ...proposal.copy });
    setProposal(null);
  }, [proposal, state.metaCopy, applyGeneratedCopy]);

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
    router.push(`/ad-studio/templates/${encodeURIComponent(pack.templateId)}/publish?adId=${encodeURIComponent(adId)}`);
  }, [state.isDirty, state.lastSavedRevision, handleSave, router, adId, pack.templateId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const modifier = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (modifier && key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    if (modifier && key === "y") {
      e.preventDefault();
      redo();
    }
    if (modifier && key === "s") {
      e.preventDefault();
      void handleSave();
    }
    if (e.key === "Escape") {
      selectLayer(null);
    }
  }, [undo, redo, selectLayer, handleSave]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [state.isDirty]);

  // Colour modes resolve from the same never-invent-a-palette rule: template
  // colours always; Brand Pack roles override where the kit has a field;
  // custom mode keeps the live per-role map the customer edits.
  const handleColourModeChange = useCallback(
    (mode: ColourMode) => {
      if (mode === "brand_pack") {
        setColourMode(
          "brand_pack",
          resolveColourMap(pack.semanticColours, "brand_pack", brandPackColoursToRoleMap(brandColours)),
        );
      } else if (mode === "custom") {
        setColourMode("custom", state.resolvedColourMap);
      } else {
        setColourMode("template");
      }
    },
    [pack.semanticColours, brandColours, state.resolvedColourMap, setColourMode],
  );

  /** Pick a workspace library asset for a slot (persistable media ref). */
  const handleLibraryPick = useCallback(async (key: string, sourceAssetId: string) => {
    const previousValue = state.imageValues.find(value => value.inputKey === key);
    setPendingImageUploads(count => count + 1);
    setError(null);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/media?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "adopt", sourceAssetId }) });
      const body = await response.json().catch(() => ({})) as { ref?: string; error?: string };
      if (!response.ok || !body.ref) throw new Error(body.error ?? "We could not use that workspace image.");
      updateImageValue(key, body.ref, null);
      setPendingCropKey(key);
    } catch (error) {
      updateImageValue(key, previousValue?.dataUrl ?? null, previousValue?.previewUrl ?? null);
      setError(error instanceof Error ? error.message : "We could not use that workspace image.");
    } finally { setPendingImageUploads(count => Math.max(0, count - 1)); }
  }, [adId, workspaceId, state.imageValues, updateImageValue, setError]);

  const persistableLibraryAssets = libraryAssets?.filter((asset): asset is { id: string; url: string; label: string } => Boolean(asset.id));
  return <RedesignedEditor
    pack={pack}
    adId={adId}
    state={state}
    activeLayout={activeLayout}
    templateId={pack.templateId}
    brandColours={brandColours}
    brandBusinessName={brandBusinessName}
    brandLogoUrl={brandLogoUrl}
    libraryAssets={persistableLibraryAssets}
    canSave={canSave}
    canUndo={canUndo}
    canRedo={canRedo}
    saveConflict={saveConflict}
    pendingImageUploads={pendingImageUploads}
    inspectorTab={inspectorTab}
    setInspectorTab={setInspectorTab}
    mobileInspectorOpen={mobileInspectorOpen}
    setMobileInspectorOpen={setMobileInspectorOpen}
    handleSave={handleSave}
    handlePublish={handlePublish}
    handleKeyDown={handleKeyDown}
    undo={undo}
    redo={redo}
    setActivePlacement={setActivePlacement}
    selectLayer={selectLayer}
    handleColourModeChange={handleColourModeChange}
    handleCustomColourChange={updateCustomColour}
    handleTemplateCopyChange={setTemplateCopyApplied}
    handleBusinessNameChange={updateBusinessName}
    handleLibraryPick={handleLibraryPick}
    handleImageChange={handleImageChange}
    openCrop={openCrop}
    openCropForInput={openCropForInput}
    updateTextValue={updateTextValue}
    updateMetaCopy={updateMetaCopy}
    updateDestinationUrl={updateDestinationUrl}
    updateCrop={updateCrop}
    setError={setError}
    cropTarget={cropTarget}
    setCropTarget={setCropTarget}
    proposalBrief={proposalBrief}
    setProposalBrief={setProposalBrief}
    proposalBusy={proposalBusy}
    proposal={proposal}
    proposeCopy={proposeCopy}
    useAllProposal={useAllProposal}
    name={name}
    setName={setName}
    persistName={persistName}
  />;
}

function RedesignedEditor({ pack, adId, templateId, state, activeLayout, brandColours, brandBusinessName, brandLogoUrl, libraryAssets, canSave, canUndo, canRedo, saveConflict, pendingImageUploads, inspectorTab, setInspectorTab, mobileInspectorOpen, setMobileInspectorOpen, handleSave, handlePublish, handleKeyDown, undo, redo, setActivePlacement, selectLayer, handleColourModeChange, handleCustomColourChange, handleTemplateCopyChange, handleBusinessNameChange, handleLibraryPick, handleImageChange, openCrop, openCropForInput, updateTextValue, updateMetaCopy, updateDestinationUrl, updateCrop, setError, cropTarget, setCropTarget, proposalBrief, setProposalBrief, proposal, proposalBusy, proposeCopy, useAllProposal, name, setName, persistName }: {
  pack: AdTemplate; adId: string; templateId: string; state: EditorState; activeLayout: AdTemplate["feedLayout"]; brandColours: BrandPackColours | null; brandBusinessName: string; brandLogoUrl: string | null; libraryAssets?: Array<{ id: string; url: string; label: string }>; canSave: boolean; canUndo: boolean; canRedo: boolean; saveConflict: boolean; pendingImageUploads: number;
  inspectorTab: InspectorTab; setInspectorTab: (value: InspectorTab) => void; mobileInspectorOpen: boolean; setMobileInspectorOpen: (value: boolean) => void; handleSave: () => Promise<boolean>; handlePublish: () => Promise<void>; handleKeyDown: (event: KeyboardEvent) => void; undo: () => void; redo: () => void; setActivePlacement: (value: Placement) => void; selectLayer: (value: string | null) => void;
  handleColourModeChange: (mode: ColourMode) => void; handleCustomColourChange: (role: ColourRole, hex: string) => void; handleTemplateCopyChange: (enabled: boolean) => void; handleBusinessNameChange: (value: string) => void; handleLibraryPick: (key: string, sourceAssetId: string) => Promise<void>; handleImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; openCrop: (slot: ImageSlotLayer) => void; openCropForInput: (key: string) => void; updateTextValue: (key: string, value: string) => void; updateMetaCopy: (field: keyof MetaCopy, value: string) => void; updateDestinationUrl: (value: string) => void; updateCrop: (key: string, placement: Placement, crop: Rect) => void; setError: (value: string | null) => void;
  cropTarget: { slot: ImageSlotLayer; placement: Placement } | null; setCropTarget: (value: { slot: ImageSlotLayer; placement: Placement } | null) => void; proposalBrief: string; setProposalBrief: (value: string) => void; proposal: { onImage: Record<string, string>; copy: Partial<MetaCopy>; source: string } | null; proposalBusy: boolean; proposeCopy: () => Promise<void>; useAllProposal: () => void;
  name: string; setName: (value: string) => void; persistName: () => Promise<void>;
}) {
  const defaultImageValues = Object.fromEntries(pack.imageInputs.flatMap(input => input.defaultAssetKey
    ? [[input.key, templateAssetProxyUrl(templateId, input.defaultAssetKey, adId)!] as const]
    : []));
  const customerImageValues = Object.fromEntries(state.imageValues.flatMap(value => {
    const image = value.previewUrl ?? value.dataUrl;
    return image ? [[value.inputKey, image] as const] : [];
  }));
  const previewImages = { ...defaultImageValues, ...customerImageValues };
  const previewCopy = previewTextValues(pack, state.textValues);
  const [previewMode, setPreviewMode] = useState<"design" | "meta" | "split">("meta");
  const [zoom, setZoom] = useState<"fit" | 1 | 1.25 | 0.8>("fit");
  const [placementView, setPlacementView] = useState<Placement | "both">(state.activePlacement);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const metaPreviewBase = {
    templateId,
    existingAdId: adId,
    assets: pack.assets,
    colours: state.resolvedColourMap,
    textValues: previewCopy,
    imageValues: previewImages,
    copy: state.metaCopy,
    businessName: state.brandBusinessName.trim() || brandBusinessName,
    logoUrl: brandLogoUrl,
    destinationUrl: state.destinationUrl,
  } as const;
  const feedMetaPreview = (
    <FeedPreview
      {...metaPreviewBase}
      layout={pack.feedLayout}
      cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops.feed]))}
      className="max-h-full"
    />
  );
  const storyMetaPreview = (
    <StoryPreview
      {...metaPreviewBase}
      layout={pack.storyLayout}
      cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops.story]))}
      className="max-h-full"
    />
  );
  const metaPreview = state.activePlacement === "feed" ? feedMetaPreview : storyMetaPreview;
  const inspector = <InspectorContent tab={inspectorTab} pack={pack} state={state} defaultImageValues={defaultImageValues} brandColours={brandColours} brandBusinessName={brandBusinessName} libraryAssets={libraryAssets} onTextChange={updateTextValue} onImageChange={handleImageChange} onCropClick={openCropForInput} onMetaChange={updateMetaCopy} onDestinationChange={updateDestinationUrl} onColourModeChange={handleColourModeChange} onCustomColourChange={handleCustomColourChange} onTemplateCopyChange={handleTemplateCopyChange} onBusinessNameChange={handleBusinessNameChange} onLibraryPick={handleLibraryPick} proposalBrief={proposalBrief} proposal={proposal} proposalBusy={proposalBusy} onBriefChange={setProposalBrief} onPropose={proposeCopy} onUseAllProposal={useAllProposal} />;
  const saveStatus = pendingImageUploads > 0 ? "Uploading…" : state.isSaving ? "Saving…" : state.isDirty ? "Unsaved changes" : state.lastSavedRevision !== null ? "Saved" : "Not saved yet";
  const workingLayout = state.activePlacement === "feed" ? pack.feedLayout : pack.storyLayout;
  const selectedLayer = workingLayout.layers.find(layer => layer.layerId === state.selectedLayerId) ?? null;
  const choosePlacementView = (value: string) => {
    const next = value as Placement | "both";
    setPlacementView(next);
    if (next !== "both") setActivePlacement(next);
  };
  const openInspector = (tab: InspectorTab) => {
    setInspectorTab(tab);
    setInspectorOpen(true);
    setLayersOpen(false);
  };
  const editLayer = (placement: Placement, layerId: string) => {
    setActivePlacement(placement);
    selectLayer(layerId);
    const layout = placement === "feed" ? pack.feedLayout : pack.storyLayout;
    const layer = layout.layers.find((candidate) => candidate.layerId === layerId);
    const tab: InspectorTab = layer?.type === "text" ? "copy" : layer?.type === "image_slot" || layer?.type === "logo" ? "creative" : "colours";
    openInspector(tab);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) setMobileInspectorOpen(true);
    if (layer && "inputKey" in layer) {
      window.setTimeout(() => document.getElementById(`creative-${layer.inputKey}`)?.focus(), 80);
    }
  };
  const canvasFor = (placement: Placement, canvasZoom: "fit" | 0.8 | 1 | 1.25 = zoom, interactive = true) => (
    <DesignCanvas
      templateId={templateId}
      existingAdId={adId}
      assets={pack.assets}
      layout={placement === "feed" ? pack.feedLayout : pack.storyLayout}
      placement={placement}
      colours={state.resolvedColourMap}
      imageValues={previewImages}
      textValues={previewCopy}
      cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops[placement]]))}
      selectedLayerId={interactive && placement === state.activePlacement ? state.selectedLayerId : null}
      onSelect={interactive ? layerId => { if (layerId) editLayer(placement, layerId); } : undefined}
      onError={setError}
      zoom={canvasZoom}
    />
  );
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground" onKeyDown={handleKeyDown} tabIndex={0} role="region" aria-label="Ad Studio editor">
    <header className="relative grid min-h-14 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] items-center gap-x-1.5 gap-y-1 border-b border-border bg-card px-2 py-1.5 xl:flex xl:h-16 xl:flex-nowrap xl:justify-between xl:gap-2 xl:px-4 xl:py-0">
      <Button variant="ghost" size="icon" aria-label="Back to library" className="col-start-1 row-start-1 min-h-11 min-w-11 rounded-full xl:order-1" onClick={() => { if (!state.isDirty || window.confirm("You have unsaved changes. Leave this ad?")) window.location.href = "/ad-studio/library?view=ads"; }}><ArrowLeft className="size-4" /></Button><input aria-label="Ad name" maxLength={120} value={name} onChange={event => setName(event.target.value)} onBlur={() => void persistName()} onKeyDown={event => { if (event.key === "Enter") { event.currentTarget.blur(); } }} className="col-start-2 row-start-1 min-w-0 max-w-[220px] flex-1 truncate border-0 bg-transparent px-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring xl:order-2" />
      <div className="col-span-3 row-start-2 flex min-w-0 justify-center xl:pointer-events-none xl:absolute xl:inset-x-0 xl:top-1/2 xl:-translate-y-1/2"><Tabs value={placementView} onValueChange={choosePlacementView} className="min-w-0 xl:pointer-events-auto"><TabsList aria-label="Ad format" className="max-w-full overflow-x-auto bg-muted/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><TabsTrigger value="feed" className="min-h-11 px-3 text-xs xl:px-4 xl:text-sm">Feed</TabsTrigger><TabsTrigger value="story" className="min-h-11 px-3 text-xs xl:px-4 xl:text-sm">Story</TabsTrigger><TabsTrigger value="both" className="min-h-11 px-3 text-xs xl:px-4 xl:text-sm">Both</TabsTrigger></TabsList></Tabs></div>
      <span className="col-span-2 row-start-3 min-w-0 truncate text-left text-[10px] text-muted-foreground xl:order-4 xl:w-auto xl:text-right xl:text-xs" role="status" aria-live="polite">{saveStatus}</span>
      <div className="col-start-3 row-start-3 ml-auto flex shrink-0 items-center gap-0.5 xl:order-5 xl:gap-1"><Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo" className="min-h-11 min-w-11 rounded-full"><RotateCcw /></Button><Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo" className="min-h-11 min-w-11 rounded-full"><RotateCw /></Button><Button variant="outline" onClick={handleSave} disabled={!canSave || state.isSaving || pendingImageUploads > 0} aria-label={state.isSaving ? "Saving" : "Save"} className="min-h-11 min-w-11 rounded-full px-2 xl:min-w-0 xl:px-4"><span className="hidden xl:inline">{state.isSaving ? "Saving…" : "Save"}</span><Save className="size-4 xl:ml-1.5" /></Button><Button variant="ghost" size="icon" aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"} aria-pressed={inspectorOpen} className="hidden min-h-11 min-w-11 rounded-full xl:inline-flex" onClick={() => setInspectorOpen(value => !value)}>{inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}</Button></div>
      <Button onClick={handlePublish} disabled={!canSave || state.isSaving || pendingImageUploads > 0} className="col-start-3 row-start-1 min-h-11 rounded-full px-3 text-xs xl:order-6 xl:px-4 xl:text-sm"><span className="xl:hidden">Review</span><span className="hidden xl:inline">Review & publish</span></Button>
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
      <nav className="hidden w-16 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-(--ink) py-3 text-white xl:flex" aria-label="Canvas tools">
        <EditorToolButton label="Select" icon={MousePointer2} active={!layersOpen && !inspectorOpen} onClick={() => { selectLayer(null); setLayersOpen(false); setInspectorOpen(false); }} />
        <EditorToolButton label="Media" icon={ImageIcon} active={!layersOpen && inspectorOpen && inspectorTab === "creative"} onClick={() => openInspector("creative")} />
        <EditorToolButton label="Content" icon={Type} active={!layersOpen && inspectorOpen && inspectorTab === "copy"} onClick={() => openInspector("copy")} />
        <EditorToolButton label="Appearance" icon={Palette} active={!layersOpen && inspectorOpen && inspectorTab === "colours"} onClick={() => openInspector("colours")} />
        <div className="my-1 h-px w-7 bg-white/10" />
        <EditorToolButton label="Layers" icon={Layers3} active={layersOpen} onClick={() => { setLayersOpen(value => !value); setInspectorOpen(false); }} />
      </nav>
      {layersOpen ? <LayersPanel pack={pack} layout={workingLayout} selectedLayerId={state.selectedLayerId} onSelect={(layerId) => { if (layerId) editLayer(state.activePlacement, layerId); }} onClose={() => setLayersOpen(false)} /> : null}
      <section aria-label="Ad canvas" className="relative order-first flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-(--ink) p-3 md:p-4 xl:order-none">
        <div className="z-10 flex shrink-0 flex-wrap items-center justify-center gap-1 rounded-full border border-white/10 bg-(--surface) p-1 shadow-float" role="radiogroup" aria-label="Preview mode">
          {([["design", "Design"], ["meta", "Meta preview"], ["split", "Split"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={previewMode === value}
              onClick={() => setPreviewMode(value)}
              className={cn(
                "min-h-9 rounded-full px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                previewMode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {previewMode === "design" && selectedLayer ? <div className="absolute left-1/2 top-16 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-(--surface) p-1 pl-3 shadow-float"><span className="max-w-40 truncate text-xs font-semibold">{layerLabel(selectedLayer, pack)}</span><Button type="button" variant="ghost" size="sm" className="h-9 rounded-full" onClick={() => editLayer(state.activePlacement, selectedLayer.layerId)}>Edit</Button>{selectedLayer.type === "image_slot" ? <Button type="button" variant="ghost" size="sm" className="h-9 rounded-full" onClick={() => openCrop(selectedLayer)}><Crop className="size-3.5" /> Crop</Button> : null}</div> : null}
        {previewMode === "design" ? (
          placementView === "both" ? <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2 md:overflow-hidden"><PlacementCanvas label="Feed" active={state.activePlacement === "feed"}>{canvasFor("feed", "fit")}</PlacementCanvas><PlacementCanvas label="Story" active={state.activePlacement === "story"}>{canvasFor("story", "fit")}</PlacementCanvas></div> : canvasFor(placementView)
        ) : previewMode === "meta" ? (
          placementView === "both" ? <div className="grid min-h-0 w-full flex-1 grid-cols-1 gap-3 overflow-auto md:grid-cols-2"><PlacementCanvas label="Feed preview">{feedMetaPreview}</PlacementCanvas><PlacementCanvas label="Story preview">{storyMetaPreview}</PlacementCanvas></div> : <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">{metaPreview}</div>
        ) : <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 overflow-auto md:flex-row"><div className="flex min-h-0 min-w-0 max-w-full flex-1 items-center justify-center">{canvasFor(state.activePlacement, "fit", false)}</div><div className="flex min-h-0 min-w-0 max-w-full flex-1 items-center justify-center overflow-hidden">{metaPreview}</div></div>}
        {previewMode === "design" ? <div className="z-10 flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-(--surface) p-1 shadow-float" aria-label="Canvas zoom"><button type="button" aria-pressed={zoom === "fit"} className="min-h-9 rounded-full px-3 text-xs font-semibold hover:bg-muted" onClick={() => setZoom("fit")}>Fit</button><button type="button" aria-pressed={zoom === 1} className="min-h-9 rounded-full px-3 text-xs font-semibold hover:bg-muted" onClick={() => setZoom(1)}>100%</button><button type="button" className="min-h-9 min-w-9 rounded-full hover:bg-muted" aria-label="Zoom out" onClick={() => setZoom(0.8)}><ZoomOut className="mx-auto size-4" /></button><button type="button" className="min-h-9 min-w-9 rounded-full hover:bg-muted" aria-label="Zoom in" onClick={() => setZoom(1.25)}><ZoomIn className="mx-auto size-4" /></button><span className="px-2 text-xs font-medium text-muted-foreground" role="status" aria-live="polite">{placementView === "both" ? "Both · fit" : zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}</span></div> : null}
      </section>
      {inspectorOpen ? <aside aria-label="Editor inspector" className="hidden w-[22rem] shrink-0 overflow-y-auto border-l border-border bg-card xl:block"><InspectorTabs value={inspectorTab} onChange={setInspectorTab} />{inspector}</aside> : null}
    </div>
    <nav className="z-20 grid shrink-0 grid-cols-5 border-t border-border bg-card p-1.5 xl:hidden" aria-label="Editor tools">{INSPECTOR_TABS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={inspectorTab === value && mobileInspectorOpen} onClick={() => { setInspectorTab(value); setMobileLayersOpen(false); setMobileInspectorOpen(true); }} className={cn("flex min-h-11 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", inspectorTab === value && mobileInspectorOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{<Icon className="size-4" />}{label}</button>)}<button type="button" aria-pressed={mobileLayersOpen} onClick={() => { setMobileInspectorOpen(false); setMobileLayersOpen(true); }} className={cn("flex min-h-11 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mobileLayersOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}><Layers3 className="size-4" />Layers</button><button type="button" aria-pressed={previewMode === "meta" && !mobileInspectorOpen && !mobileLayersOpen} onClick={() => { setPreviewMode("meta"); setMobileInspectorOpen(false); setMobileLayersOpen(false); }} className={cn("flex min-h-11 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", previewMode === "meta" && !mobileInspectorOpen && !mobileLayersOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}><Eye className="size-4" />Preview</button></nav>
    <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}><SheetContent side="bottom" className="max-h-[82dvh] overflow-y-auto rounded-t-(--r-card) p-0 xl:hidden"><SheetHeader><SheetTitle>{INSPECTOR_TABS.find(tab => tab.value === inspectorTab)?.label}</SheetTitle><SheetDescription>Make one change at a time; your preview updates as you work.</SheetDescription></SheetHeader>{inspector}</SheetContent></Sheet>
    <Sheet open={mobileLayersOpen} onOpenChange={setMobileLayersOpen}><SheetContent side="bottom" className="max-h-[70dvh] overflow-y-auto rounded-t-(--r-card) p-0 xl:hidden"><SheetHeader><SheetTitle>Layers</SheetTitle><SheetDescription>Select an element to edit it on the canvas.</SheetDescription></SheetHeader><LayersPanel pack={pack} layout={workingLayout} selectedLayerId={state.selectedLayerId} onSelect={layerId => { if (layerId) editLayer(state.activePlacement, layerId); setMobileLayersOpen(false); }} /></SheetContent></Sheet>
    {cropTarget && <CropDialogHost cropTarget={cropTarget} state={state} pack={pack} onApply={updateCrop} onClose={() => setCropTarget(null)} />}
    {state.error && <Alert variant="destructive" role="alert" className="m-3"><AlertTitle>Check this before continuing</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>{state.error}</span><Button variant="outline" size="sm" onClick={() => saveConflict ? window.location.reload() : setError(null)} className="min-h-11 shrink-0">{saveConflict ? "Reload latest" : "Dismiss"}</Button></AlertDescription></Alert>}
  </div>;
}

function EditorToolButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof PencilLine; active: boolean; onClick: () => void }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} onClick={onClick} className={cn("grid min-h-12 w-12 place-items-center rounded-xl text-white/55 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", active ? "bg-white/12 text-white" : "hover:bg-white/8 hover:text-white")}><Icon className="size-[18px]" /></button>;
}

function LayersPanel({ pack, layout, selectedLayerId, onSelect, onClose }: { pack: AdTemplate; layout: Layout; selectedLayerId: string | null; onSelect: (value: string | null) => void; onClose?: () => void }) {
  return <aside aria-label="Layers" className="w-full shrink-0 overflow-y-auto border-r border-border bg-card xl:w-64"><div className="flex min-h-14 items-center justify-between border-b border-border px-4"><div><p className="font-display text-sm font-extrabold">Layers</p><p className="text-[10px] text-muted-foreground">{layout.placement === "feed" ? "Feed" : "Story"} composition</p></div>{onClose ? <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 rounded-full" onClick={onClose} aria-label="Close layers"><PanelRightClose /></Button> : null}</div><div className="grid gap-1 p-2">{[...layout.layers].reverse().map(layer => <button key={layer.layerId} type="button" aria-pressed={selectedLayerId === layer.layerId} onClick={() => onSelect(layer.layerId)} className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selectedLayerId === layer.layerId ? "bg-primary text-primary-foreground" : "hover:bg-muted")}><span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", selectedLayerId === layer.layerId ? "bg-white/12" : "bg-muted text-muted-foreground")}>{layer.type === "text" ? <Type className="size-3.5" /> : layer.type === "image_slot" || layer.type === "logo" ? <ImageIcon className="size-3.5" /> : <Layers3 className="size-3.5" />}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{layerLabel(layer, pack)}</span><span className={cn("block truncate text-[10px]", selectedLayerId === layer.layerId ? "text-white/65" : "text-muted-foreground")}>{layer.type.replaceAll("_", " ")}</span></span></button>)}</div></aside>;
}

function layerLabel(layer: LayoutLayer, pack: AdTemplate): string {
  if (layer.type === "text") return pack.textInputs.find(input => input.key === layer.inputKey)?.label ?? "Text";
  if (layer.type === "image_slot" || layer.type === "logo") return pack.imageInputs.find(input => input.key === layer.inputKey)?.label ?? (layer.type === "logo" ? "Logo" : "Image");
  if (layer.type === "icon") return layer.icon || "Icon";
  if (layer.type === "plate") return "Background";
  if (layer.type === "overlay_patch") return "Image overlay";
  return layer.shape === "line" ? "Divider" : "Shape";
}

function PlacementCanvas({ label, active = false, children }: { label: string; active?: boolean; children: ReactNode }) {
  return <div className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-(--r-card) border", active ? "border-white/35" : "border-white/10")}><span className="absolute left-3 top-3 z-10 rounded-full bg-(--ink)/80 px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[.12em] text-white/75">{label}</span>{children}</div>;
}

type DesignCanvasProps = {
  templateId: string;
  existingAdId: string;
  assets: AdTemplate["assets"];
  layout: Layout;
  placement: Placement;
  colours: AdTemplate["semanticColours"];
  imageValues: Record<string, string | null>;
  textValues: Record<string, string>;
  cropOverrides?: Record<string, Rect | null | undefined>;
  selectedLayerId?: string | null;
  onSelect?: (layerId: string | null) => void;
  onCropImage?: (slot: ImageSlotLayer) => void;
  onError?: (message: string) => void;
  zoom?: "fit" | 0.8 | 1 | 1.25;
};

function DesignCanvas({ templateId, existingAdId, assets, layout, placement, colours, imageValues, textValues, cropOverrides, selectedLayerId, onSelect, onCropImage, onError, zoom = "fit" }: DesignCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 700 });
  useEffect(() => { const node = viewport.current; if (!node) return; const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight })); observer.observe(node); return () => observer.disconnect(); }, []);
  const dims = PLACEMENT_DIMENSIONS[placement];
  const fit = Math.min((size.width - 24) / dims.width, (size.height - 24) / dims.height, 1);
  const scale = zoom === "fit" ? Math.max(0.05, Math.min(1, fit)) : zoom;
  const width = Math.round(dims.width * scale), height = Math.round(dims.height * scale);
  return <div ref={viewport} className="flex min-h-0 min-w-0 flex-1 items-start justify-start overflow-auto p-3"><div className="m-auto" style={{ width, height, minWidth: width, minHeight: height }}><LayeredCanvas templateId={templateId} existingAdId={existingAdId} assets={assets} layout={layout} colours={colours} imageValues={imageValues} textValues={textValues} cropOverrides={cropOverrides} selectedLayerId={selectedLayerId} onSelect={onSelect} onCropImage={onCropImage} onError={onError} className="h-full w-full" /></div></div>;
}

function InspectorTabs({ value, onChange }: { value: InspectorTab; onChange: (value: InspectorTab) => void }) {
  return <Tabs value={value} onValueChange={next => onChange(next as InspectorTab)} className="border-b border-border p-3"><TabsList aria-label="Editor sections" className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/50 p-1">{INSPECTOR_TABS.map(({ value: tab, label, icon: Icon }) => <TabsTrigger key={tab} value={tab} className="min-h-11 justify-center gap-2 px-2 text-xs"><Icon className="size-4" />{label}</TabsTrigger>)}</TabsList></Tabs>;
}

function InspectorContent({ tab, pack, state, defaultImageValues, brandColours, brandBusinessName, libraryAssets, onTextChange, onImageChange, onCropClick, onMetaChange, onDestinationChange, onColourModeChange, onCustomColourChange, onTemplateCopyChange, onBusinessNameChange, onLibraryPick, proposalBrief, proposal, proposalBusy, onBriefChange, onPropose, onUseAllProposal }: { tab: InspectorTab; pack: AdTemplate; state: EditorState; defaultImageValues: Record<string, string>; brandColours: BrandPackColours | null; brandBusinessName: string; libraryAssets?: Array<{ id: string; url: string; label: string }>; onTextChange: (key: string, value: string) => void; onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; onCropClick: (key: string) => void; onMetaChange: (field: keyof MetaCopy, value: string) => void; onDestinationChange: (value: string) => void; onColourModeChange: (mode: ColourMode) => void; onCustomColourChange: (role: ColourRole, hex: string) => void; onTemplateCopyChange: (enabled: boolean) => void; onBusinessNameChange: (value: string) => void; onLibraryPick: (key: string, sourceAssetId: string) => Promise<void>; proposalBrief: string; proposal: { onImage: Record<string, string>; copy: Partial<MetaCopy>; source: string } | null; proposalBusy: boolean; onBriefChange: (value: string) => void; onPropose: () => Promise<void>; onUseAllProposal: () => void }) {
  if (tab === "copy") return <div><ProposalPanel brief={proposalBrief} proposal={proposal} textLabels={Object.fromEntries(pack.textInputs.map(input => [input.key, input.label]))} busy={proposalBusy} onBriefChange={onBriefChange} onPropose={onPropose} onUseAll={onUseAllProposal} onUseText={onTextChange} onUseMeta={onMetaChange} /><InputsPanel textInputs={pack.textInputs} imageInputs={[]} textValues={state.textValues} imageValues={{}} defaultImageValues={{}} onTextChange={onTextChange} onImageChange={onImageChange} onCropClick={onCropClick} templateCopyApplied={state.templateCopyApplied} templateCopyAvailable={hasTemplateCopy(pack)} onTemplateCopyChange={onTemplateCopyChange} businessName={state.brandBusinessName} businessNameDefault={brandBusinessName} onBusinessNameChange={onBusinessNameChange} showImageInputs={false} /><MetaCopyPanel values={state.metaCopy} onChange={onMetaChange} destinationUrl={state.destinationUrl} onDestinationChange={onDestinationChange} /></div>;
  if (tab === "colours") return <aside aria-label="Colours" className="space-y-4 border-t border-border p-4"><div><h3 className="text-sm font-semibold">Colours</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose the colours that feel right for this ad.</p></div><ColourToggle mode={state.colourMode} brandPackAvailable={!!brandColours} resolvedColourMap={state.resolvedColourMap} onModeChange={onColourModeChange} onCustomColourChange={onCustomColourChange} /></aside>;
  return <InputsPanel textInputs={[]} imageInputs={pack.imageInputs} textValues={{}} imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.previewUrl ?? iv.dataUrl]))} defaultImageValues={defaultImageValues} onTextChange={onTextChange} onImageChange={onImageChange} onCropClick={onCropClick} libraryAssets={libraryAssets} onLibraryPick={onLibraryPick} showTextInputs={false} showTemplateControls={false} showBusinessName={false} />;
}

function ProposalPanel({
  className,
  brief,
  proposal,
  textLabels,
  busy,
  onBriefChange,
  onPropose,
  onUseAll,
  onUseText,
  onUseMeta,
}: {
  className?: string;
  brief: string;
  proposal: { onImage: Record<string, string>; copy: Partial<MetaCopy>; source: string } | null;
  textLabels: Record<string, string>;
  busy: boolean;
  onBriefChange: (value: string) => void;
  onPropose: () => void;
  onUseAll: () => void;
  onUseText: (key: string, value: string) => void;
  onUseMeta: (field: keyof MetaCopy, value: string) => void;
}) {
  const metaLabels: Record<keyof MetaCopy, string> = {
    primaryText: "Primary text",
    headline: "Headline",
    description: "Description",
    cta: "Call to action",
  };
  return (
    <section aria-label="Copy suggestions" className={cn("p-4", className)}>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">AI Copy Assist</h3>
        <div className="mt-3">
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Describe the ad once. AI uses this brief, your Brand Pack and the template guidance to propose every on-image and Meta field. Nothing changes until you choose Use all or a field.</p>
      <label htmlFor="copy-suggestion-brief" className="mb-1 block text-sm font-medium text-foreground">What should the ad say?</label>
      <textarea id="copy-suggestion-brief" value={brief} onChange={event => onBriefChange(event.target.value)} rows={4} placeholder="Describe the property, offer or audience…" className="min-h-24 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      <button type="button" onClick={onPropose} disabled={busy} className="mt-2 min-h-11 h-auto w-full justify-start rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Generating…" : "Generate copy"}</button>
      {proposal ? (
        <div className="mt-4 space-y-2 rounded-(--r-card) border border-border bg-muted/20 p-3" aria-label="Generated copy proposal">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-semibold text-foreground">Review generated copy</p>
            <button type="button" onClick={onUseAll} className="min-h-11 w-full rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto">Use all</button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">Use every suggestion together, or apply only the fields you want.</p>
          {Object.entries(proposal.onImage).map(([key, value]) => (
            <ProposalRow key={`text:${key}`} label={textLabels[key] ?? key} value={value} onUse={() => onUseText(key, value)} />
          ))}
          {(Object.entries(proposal.copy) as Array<[keyof MetaCopy, string | undefined]>).filter((entry): entry is [keyof MetaCopy, string] => typeof entry[1] === "string").map(([field, value]) => (
            <ProposalRow key={`meta:${field}`} label={metaLabels[field]} value={value} onUse={() => onUseMeta(field, value)} />
          ))}
        </div>
      ) : null}
        </div>
      </div>
    </section>
  );
}

function ProposalRow({ label, value, onUse }: { label: string; value: string; onUse: () => void }) {
  return (
    <div className="rounded-(--r-ctl) border border-border bg-card p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{value}</p>
        </div>
        <button type="button" onClick={onUse} aria-label={`Use ${label}`} className="min-h-11 w-full shrink-0 rounded-full border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto">Use</button>
      </div>
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
  pack: AdTemplate;
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
