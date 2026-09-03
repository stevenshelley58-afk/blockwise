"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Palette, PencilLine, RotateCcw, RotateCw, Save, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import type { AdTemplate, Placement, ImageSlotLayer, LayoutLayer, Rect, ColourRole } from "../../../../packages/ad-template-contract/src/types";
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
   * "Library…" source in the Content tab, alongside direct upload.
   */
  libraryAssets?: Array<{ id?: string; url: string; label: string }>;
  /** Brand Pack primary logo URL for the Meta preview avatar (null → initials). */
  brandLogoUrl?: string | null;
  initialDocument?: AdDocumentParsed;
  initialRevision?: number;
  adName?: string;
}

type InspectorTab = "content" | "copy" | "colours";
const INSPECTOR_TABS: Array<{ value: InspectorTab; label: string; icon: typeof PencilLine }> = [
  { value: "content", label: "Creative", icon: PencilLine },
  { value: "copy", label: "Ad copy", icon: Sparkles },
  { value: "colours", label: "Colours", icon: Palette },
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
  const [proposal, setProposal] = useState<{ onImage: Record<string, string>; copy: MetaCopy; source: string } | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [pendingImageUploads, setPendingImageUploads] = useState(0);
  const [saveConflict, setSaveConflict] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
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
      state.metaCopy.primaryText.length > 125 ? "Primary text is over its 125-character limit." : "",
      state.metaCopy.headline.length > 40 ? "Headline is over its 40-character limit." : "",
      state.metaCopy.description.length > 30 ? "Description is over its 30-character limit." : "",
      state.metaCopy.cta.length > 25 ? "Call to action is over its 25-character limit." : "",
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
      setInspectorTab("content");
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
    if (!next || next === persistedName.current) return;
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
      const body = await response.json() as { onImage?: Record<string, string>; copy?: MetaCopy; source?: string; error?: string };
      if (!response.ok || !body.copy) throw new Error(body.error ?? "Copy proposal failed.");
      applyGeneratedCopy(body.onImage ?? {}, body.copy);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy proposal failed.");
    } finally {
      setProposalBusy(false);
    }
  }, [adId, workspaceId, proposalBrief, state.metaCopy, setError, applyGeneratedCopy]);

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
    updateCrop={updateCrop}
    setError={setError}
    cropTarget={cropTarget}
    setCropTarget={setCropTarget}
    proposalBrief={proposalBrief}
    setProposalBrief={setProposalBrief}
    proposalBusy={proposalBusy}
    proposal={proposal}
    proposeCopy={proposeCopy}
    name={name}
    setName={setName}
    persistName={persistName}
  />;
}

function RedesignedEditor({ pack, templateId, state, activeLayout, brandColours, brandBusinessName, brandLogoUrl, libraryAssets, canSave, canUndo, canRedo, saveConflict, pendingImageUploads, inspectorTab, setInspectorTab, mobileInspectorOpen, setMobileInspectorOpen, handleSave, handlePublish, handleKeyDown, undo, redo, setActivePlacement, selectLayer, handleColourModeChange, handleCustomColourChange, handleTemplateCopyChange, handleBusinessNameChange, handleLibraryPick, handleImageChange, openCrop, openCropForInput, updateTextValue, updateMetaCopy, updateCrop, setError, cropTarget, setCropTarget, proposalBrief, setProposalBrief, proposal, proposalBusy, proposeCopy, name, setName, persistName }: {
  pack: AdTemplate; templateId: string; state: EditorState; activeLayout: AdTemplate["feedLayout"]; brandColours: BrandPackColours | null; brandBusinessName: string; brandLogoUrl: string | null; libraryAssets?: Array<{ id: string; url: string; label: string }>; canSave: boolean; canUndo: boolean; canRedo: boolean; saveConflict: boolean; pendingImageUploads: number;
  inspectorTab: InspectorTab; setInspectorTab: (value: InspectorTab) => void; mobileInspectorOpen: boolean; setMobileInspectorOpen: (value: boolean) => void; handleSave: () => Promise<boolean>; handlePublish: () => Promise<void>; handleKeyDown: (event: KeyboardEvent) => void; undo: () => void; redo: () => void; setActivePlacement: (value: Placement) => void; selectLayer: (value: string | null) => void;
  handleColourModeChange: (mode: ColourMode) => void; handleCustomColourChange: (role: ColourRole, hex: string) => void; handleTemplateCopyChange: (enabled: boolean) => void; handleBusinessNameChange: (value: string) => void; handleLibraryPick: (key: string, sourceAssetId: string) => Promise<void>; handleImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; openCrop: (slot: ImageSlotLayer) => void; openCropForInput: (key: string) => void; updateTextValue: (key: string, value: string) => void; updateMetaCopy: (field: keyof MetaCopy, value: string) => void; updateCrop: (key: string, placement: Placement, crop: Rect) => void; setError: (value: string | null) => void;
  cropTarget: { slot: ImageSlotLayer; placement: Placement } | null; setCropTarget: (value: { slot: ImageSlotLayer; placement: Placement } | null) => void; proposalBrief: string; setProposalBrief: (value: string) => void; proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null; proposalBusy: boolean; proposeCopy: () => Promise<void>;
  name: string; setName: (value: string) => void; persistName: () => Promise<void>;
}) {
  const defaultImageValues = Object.fromEntries(pack.imageInputs.flatMap(input => input.defaultAssetKey
    ? [[input.key, `/api/adstudio/templates/${encodeURIComponent(templateId)}/assets/${encodeURIComponent(input.defaultAssetKey)}`] as const]
    : []));
  const customerImageValues = Object.fromEntries(state.imageValues.flatMap(value => {
    const image = value.previewUrl ?? value.dataUrl;
    return image ? [[value.inputKey, image] as const] : [];
  }));
  const previewImages = { ...defaultImageValues, ...customerImageValues };
  const previewCopy = previewTextValues(pack, state.textValues);
  const [previewMode, setPreviewMode] = useState<"design" | "meta" | "split">("design");
  const [zoom, setZoom] = useState<"fit" | 1 | 1.25 | 0.8>("fit");
  const metaPreviewBase = {
    templateId,
    colours: state.resolvedColourMap,
    textValues: previewCopy,
    imageValues: previewImages,
    copy: state.metaCopy,
    businessName: state.brandBusinessName.trim() || brandBusinessName,
    logoUrl: brandLogoUrl,
  } as const;
  const metaPreview = state.activePlacement === "feed" ? (
    <FeedPreview
      {...metaPreviewBase}
      layout={pack.feedLayout}
      cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops.feed]))}
      className="max-h-full"
    />
  ) : (
    <StoryPreview
      {...metaPreviewBase}
      layout={pack.storyLayout}
      cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops.story]))}
      className="max-h-full"
    />
  );
  const inspector = <InspectorContent tab={inspectorTab} pack={pack} state={state} defaultImageValues={defaultImageValues} brandColours={brandColours} brandBusinessName={brandBusinessName} libraryAssets={libraryAssets} onTextChange={updateTextValue} onImageChange={handleImageChange} onCropClick={openCropForInput} onMetaChange={updateMetaCopy} onColourModeChange={handleColourModeChange} onCustomColourChange={handleCustomColourChange} onTemplateCopyChange={handleTemplateCopyChange} onBusinessNameChange={handleBusinessNameChange} onLibraryPick={handleLibraryPick} proposalBrief={proposalBrief} proposal={proposal} proposalBusy={proposalBusy} onBriefChange={setProposalBrief} onPropose={proposeCopy} />;
  const saveStatus = pendingImageUploads > 0 ? "Uploading…" : state.isSaving ? "Saving…" : state.isDirty ? "Unsaved changes" : state.lastSavedRevision !== null ? "Saved" : "Not saved yet";
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground" onKeyDown={handleKeyDown} tabIndex={0} role="region" aria-label="Ad Studio editor">
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 md:h-16 md:flex-nowrap md:justify-between md:px-5 md:py-0">
      <Button variant="ghost" size="icon" aria-label="Back to all ads" className="min-h-11 min-w-11 rounded-full" onClick={() => { if (!state.isDirty || window.confirm("You have unsaved changes. Leave this ad?")) window.location.href = "/ad-studio/ads"; }}><ArrowLeft className="size-4" /></Button><input aria-label="Ad name" maxLength={120} value={name} onChange={event => setName(event.target.value)} onBlur={() => { if (!name.trim()) setName(persistedName.current); else void persistName(); }} onKeyDown={event => { if (event.key === "Enter") { event.currentTarget.blur(); } }} className="min-w-0 max-w-[220px] flex-1 truncate border-0 bg-transparent px-1 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <Tabs value={state.activePlacement} onValueChange={value => setActivePlacement(value as Placement)} className="min-w-0 flex-1"><TabsList aria-label="Ad format" className="max-w-full overflow-x-auto bg-muted/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><TabsTrigger value="feed" className="min-h-11 px-3 text-xs md:px-4 md:text-sm">Feed</TabsTrigger><TabsTrigger value="story" className="min-h-11 px-3 text-xs md:px-4 md:text-sm">Story</TabsTrigger></TabsList></Tabs>
      <span className="order-last w-full truncate text-right text-[11px] text-muted-foreground sm:order-none sm:w-auto sm:text-xs" role="status" aria-live="polite">{saveStatus}</span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2"><Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo" className="min-h-11 min-w-11 rounded-full"><RotateCcw /></Button><Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo" className="min-h-11 min-w-11 rounded-full"><RotateCw /></Button><Button onClick={handleSave} disabled={!canSave || state.isSaving || pendingImageUploads > 0} className="min-h-11 rounded-full px-4">{state.isSaving ? "Saving…" : "Save"}<Save className="ml-1.5 size-4" /></Button><Button onClick={handlePublish} disabled={!canSave || state.isSaving || pendingImageUploads > 0} variant="outline" className="min-h-11 rounded-full px-4">Review & publish</Button></div>
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
      <section aria-label="Ad preview" className="order-first flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-[#15171c] p-3 md:p-6 xl:order-none">
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card p-1" role="radiogroup" aria-label="Preview mode">
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
        {previewMode !== "meta" && <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1" aria-label="Canvas zoom"><button type="button" className="min-h-9 rounded-full px-3 text-xs font-semibold hover:bg-muted" onClick={() => setZoom("fit")}>Fit</button><button type="button" className="min-h-9 rounded-full px-3 text-xs font-semibold hover:bg-muted" onClick={() => setZoom(1)}>100%</button><button type="button" className="min-h-9 min-w-9 rounded-full hover:bg-muted" aria-label="Zoom out" onClick={() => setZoom(0.8)}><ZoomOut className="mx-auto size-4" /></button><button type="button" className="min-h-9 min-w-9 rounded-full hover:bg-muted" aria-label="Zoom in" onClick={() => setZoom(1.25)}><ZoomIn className="mx-auto size-4" /></button></div>}
        {previewMode === "design" ? (
          <div className="relative flex min-h-0 w-full max-w-[94%] flex-1 items-center justify-center"><div className="relative min-h-0 min-w-0 overflow-hidden rounded-(--r-card) bg-white shadow-float" style={{ aspectRatio: `${PLACEMENT_DIMENSIONS[state.activePlacement].width} / ${PLACEMENT_DIMENSIONS[state.activePlacement].height}`, height: zoom === "fit" ? "min(78vh, calc(100% - 1rem), 860px)" : `${zoom * 78}vh`, maxHeight: "100%", maxWidth: "100%", width: "auto" }}><LayeredCanvas templateId={templateId} layout={activeLayout} colours={state.resolvedColourMap} imageValues={previewImages} textValues={previewCopy} cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops[state.activePlacement]]))} selectedLayerId={state.selectedLayerId} onSelect={selectLayer} onCropImage={openCrop} className="h-full w-full" /></div></div>
        ) : previewMode === "meta" ? (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">{metaPreview}</div>
        ) : <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 overflow-auto md:flex-row"><div className="flex min-h-0 min-w-0 max-w-full flex-1 items-center justify-center"><LayeredCanvas templateId={templateId} layout={activeLayout} colours={state.resolvedColourMap} imageValues={previewImages} textValues={previewCopy} cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops[state.activePlacement]]))} selectedLayerId={state.selectedLayerId} onSelect={selectLayer} onCropImage={openCrop} className="max-h-full max-w-full" /></div><div className="flex min-h-0 min-w-0 max-w-full flex-1 items-center justify-center overflow-hidden">{metaPreview}</div></div>}
      </section>
      <aside aria-label="Editor inspector" className="hidden w-[22rem] shrink-0 overflow-y-auto border-l border-border bg-card xl:block"><InspectorTabs value={inspectorTab} onChange={setInspectorTab} />{inspector}</aside>
    </div>
    <nav className="z-20 grid shrink-0 grid-cols-3 border-t border-border bg-card p-1.5 xl:hidden" aria-label="Editor tools">{INSPECTOR_TABS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={inspectorTab === value && mobileInspectorOpen} onClick={() => { setInspectorTab(value); setMobileInspectorOpen(true); }} className={cn("flex min-h-11 items-center justify-center gap-1 rounded-full px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", inspectorTab === value && mobileInspectorOpen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{<Icon className="size-4" />}{label}</button>)}</nav>
    <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}><SheetContent side="bottom" className="max-h-[82dvh] overflow-y-auto rounded-t-(--r-card) p-0 xl:hidden"><SheetHeader><SheetTitle>{INSPECTOR_TABS.find(tab => tab.value === inspectorTab)?.label}</SheetTitle><SheetDescription>Make one change at a time; your preview updates as you work.</SheetDescription></SheetHeader>{inspector}</SheetContent></Sheet>
    {cropTarget && <CropDialogHost cropTarget={cropTarget} state={state} pack={pack} onApply={updateCrop} onClose={() => setCropTarget(null)} />}
    {state.error && <Alert variant="destructive" role="alert" className="m-3"><AlertTitle>Check this before continuing</AlertTitle><AlertDescription className="flex items-center justify-between gap-3"><span>{state.error}</span><Button variant="outline" size="sm" onClick={() => saveConflict ? window.location.reload() : setError(null)} className="min-h-11 shrink-0">{saveConflict ? "Reload latest" : "Dismiss"}</Button></AlertDescription></Alert>}
  </div>;
}

function InspectorTabs({ value, onChange }: { value: InspectorTab; onChange: (value: InspectorTab) => void }) {
  return <Tabs value={value} onValueChange={next => onChange(next as InspectorTab)} className="border-b border-border p-3"><TabsList aria-label="Editor sections" className="grid h-auto w-full grid-cols-3 gap-1 bg-muted/50 p-1">{INSPECTOR_TABS.map(({ value: tab, label, icon: Icon }) => <TabsTrigger key={tab} value={tab} className="min-h-11 justify-center gap-2 px-2 text-xs"><Icon className="size-4" />{label}</TabsTrigger>)}</TabsList></Tabs>;
}

function InspectorContent({ tab, pack, state, defaultImageValues, brandColours, brandBusinessName, libraryAssets, onTextChange, onImageChange, onCropClick, onMetaChange, onColourModeChange, onCustomColourChange, onTemplateCopyChange, onBusinessNameChange, onLibraryPick, proposalBrief, proposal, proposalBusy, onBriefChange, onPropose }: { tab: InspectorTab; pack: AdTemplate; state: EditorState; defaultImageValues: Record<string, string>; brandColours: BrandPackColours | null; brandBusinessName: string; libraryAssets?: Array<{ id: string; url: string; label: string }>; onTextChange: (key: string, value: string) => void; onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; onCropClick: (key: string) => void; onMetaChange: (field: keyof MetaCopy, value: string) => void; onColourModeChange: (mode: ColourMode) => void; onCustomColourChange: (role: ColourRole, hex: string) => void; onTemplateCopyChange: (enabled: boolean) => void; onBusinessNameChange: (value: string) => void; onLibraryPick: (key: string, sourceAssetId: string) => Promise<void>; proposalBrief: string; proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null; proposalBusy: boolean; onBriefChange: (value: string) => void; onPropose: () => Promise<void> }) {
  if (tab === "copy") return <div><MetaCopyPanel values={state.metaCopy} onChange={onMetaChange} /><ProposalPanel brief={proposalBrief} busy={proposalBusy} onBriefChange={onBriefChange} onPropose={onPropose} /></div>;
  if (tab === "colours") return <aside aria-label="Colours" className="space-y-4 border-t border-border p-4"><div><h3 className="text-sm font-semibold">Colours</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose the colours that feel right for this ad.</p></div><ColourToggle mode={state.colourMode} brandPackAvailable={!!brandColours} resolvedColourMap={state.resolvedColourMap} onModeChange={onColourModeChange} onCustomColourChange={onCustomColourChange} /></aside>;
  return <InputsPanel textInputs={pack.textInputs} imageInputs={pack.imageInputs} textValues={state.textValues} imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.previewUrl ?? iv.dataUrl]))} defaultImageValues={defaultImageValues} onTextChange={onTextChange} onImageChange={onImageChange} onCropClick={onCropClick} templateCopyApplied={state.templateCopyApplied} templateCopyAvailable={hasTemplateCopy(pack)} onTemplateCopyChange={onTemplateCopyChange} businessName={state.brandBusinessName} businessNameDefault={brandBusinessName} onBusinessNameChange={onBusinessNameChange} libraryAssets={libraryAssets} onLibraryPick={onLibraryPick} />;
}

function ProposalPanel({
  className,
  brief,
  busy,
  onBriefChange,
  onPropose,
}: {
  className?: string;
  brief: string;
  busy: boolean;
  onBriefChange: (value: string) => void;
  onPropose: () => void;
}) {
  return (
    <section aria-label="Copy suggestions" className={cn("mt-6 border-t border-border pt-4", className)}>
      <div>
        <h3 className="mb-2 px-2 text-sm font-semibold text-foreground">AI brief</h3>
        <div className="mt-3">
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Generate a first draft for the creative and Meta fields. The result lands in the editable fields as one undoable change.</p>
      <label htmlFor="copy-suggestion-brief" className="mb-1 block text-sm font-medium text-foreground">What should the ad say?</label>
      <textarea id="copy-suggestion-brief" value={brief} onChange={event => onBriefChange(event.target.value)} rows={4} placeholder="Describe the property, offer or audience…" className="min-h-24 w-full rounded-(--r-card) border border-input bg-muted/30 px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
      <button type="button" onClick={onPropose} disabled={busy} className="mt-2 min-h-11 h-auto w-full justify-start rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Generating…" : "Generate copy"}</button>
        </div>
      </div>
    </section>
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
