"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Palette, PencilLine, RotateCcw, RotateCw, Save, Sparkles } from "lucide-react";
import type { AdTemplate, Placement, ImageSlotLayer, LayoutLayer, Rect } from "../../../../packages/ad-template-contract/src/types";
import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import { buildAdDocument, brandPackColoursToRoleMap, editorTextInputs, previewTextValues, resolveColourMap, useEditorState, type BrandPackColours, type EditorState, type MetaCopy } from "./use-editor-state";
import { ColourToggle } from "./colour-toggle";
import { CropDialog } from "./crop-dialog";
import { InputsPanel } from "./inputs-panel";
import { LayeredCanvas } from "./layered-canvas";
import { MetaCopyPanel } from "./meta-copy-panel";
import { MetaPlacementPreview, type MetaPreviewBrand } from "./meta-placement-preview";
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
   * the colour toggle is then disabled and the template palette stays.
   */
  brandColours?: BrandPackColours | null;
  /** Page identity shown in the live Meta placement preview. */
  brandPreview?: MetaPreviewBrand | null;
  initialDocument?: AdDocumentParsed;
  initialRevision?: number;
}

type InspectorTab = "content" | "copy" | "appearance";
const INSPECTOR_TABS: Array<{ value: InspectorTab; label: string; icon: typeof PencilLine }> = [
  { value: "content", label: "Content", icon: PencilLine },
  { value: "copy", label: "Copy", icon: Sparkles },
  { value: "appearance", label: "Appearance", icon: Palette },
];

export function EditorShell({ pack, adId, workspaceId, canSave = true, brandColours = null, brandPreview = null, initialDocument, initialRevision }: EditorShellProps) {
  const router = useRouter();
  const {
    state,
    activeLayout,
    canUndo,
    canRedo,
    setActivePlacement,
    selectLayer,
    updateTextValue,
    applyTemplateText,
    applyTemplateMetaCopy,
    applyCompleteCopy,
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
  const [saveConflict, setSaveConflict] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("content");
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
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
      const slot = activeLayout.layers.find((l: LayoutLayer): l is ImageSlotLayer => l.type === "image_slot" && l.inputKey === key);
      if (slot) openCrop(slot);
    },
    [activeLayout, openCrop],
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
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
      const next = { onImage: body.onImage ?? {}, copy: body.copy, source: body.source ?? "ai" };
      applyCompleteCopy(next.onImage, next.copy);
      setProposal(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy proposal failed.");
    } finally {
      setProposalBusy(false);
    }
  }, [adId, workspaceId, proposalBrief, state.metaCopy, setError, applyCompleteCopy]);

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
    router.push(
      `/ad-studio/templates/${encodeURIComponent(pack.templateId)}/publish?adId=${encodeURIComponent(adId)}`,
    );
  }, [state.isDirty, state.lastSavedRevision, handleSave, router, pack.templateId, adId]);

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

  return <RedesignedEditor
    pack={pack}
    state={state}
    activeLayout={activeLayout}
    templateId={pack.templateId}
    brandColours={brandColours}
    brandPreview={brandPreview}
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
    handleColourToggle={handleColourToggle}
    handleImageChange={handleImageChange}
    openCrop={openCrop}
    openCropForInput={openCropForInput}
    updateTextValue={updateTextValue}
    applyTemplateText={applyTemplateText}
    applyTemplateMetaCopy={applyTemplateMetaCopy}
    updateMetaCopy={updateMetaCopy}
    updateCrop={updateCrop}
    setError={setError}
    cropTarget={cropTarget}
    setCropTarget={setCropTarget}
    proposalBrief={proposalBrief}
    setProposalBrief={setProposalBrief}
    proposal={proposal}
    proposalBusy={proposalBusy}
    proposeCopy={proposeCopy}
  />;
}

function RedesignedEditor({ pack, templateId, state, activeLayout, brandColours, brandPreview, canSave, canUndo, canRedo, saveConflict, pendingImageUploads, inspectorTab, setInspectorTab, mobileInspectorOpen, setMobileInspectorOpen, handleSave, handlePublish, handleKeyDown, undo, redo, setActivePlacement, selectLayer, handleColourToggle, handleImageChange, openCrop, openCropForInput, updateTextValue, applyTemplateText, applyTemplateMetaCopy, updateMetaCopy, updateCrop, setError, cropTarget, setCropTarget, proposalBrief, setProposalBrief, proposal, proposalBusy, proposeCopy }: {
  pack: AdTemplate; templateId: string; state: EditorState; activeLayout: AdTemplate["feedLayout"]; brandColours: BrandPackColours | null; brandPreview: MetaPreviewBrand | null; canSave: boolean; canUndo: boolean; canRedo: boolean; saveConflict: boolean; pendingImageUploads: number;
  inspectorTab: InspectorTab; setInspectorTab: (value: InspectorTab) => void; mobileInspectorOpen: boolean; setMobileInspectorOpen: (value: boolean) => void; handleSave: () => Promise<boolean>; handlePublish: () => Promise<void>; handleKeyDown: (event: KeyboardEvent) => void; undo: () => void; redo: () => void; setActivePlacement: (value: Placement) => void; selectLayer: (value: string | null) => void;
  handleColourToggle: (value: boolean) => void; handleImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; openCrop: (slot: ImageSlotLayer) => void; openCropForInput: (key: string) => void; updateTextValue: (key: string, value: string) => void; applyTemplateText: () => void; applyTemplateMetaCopy: () => void; updateMetaCopy: (field: keyof MetaCopy, value: string) => void; updateCrop: (key: string, placement: Placement, crop: Rect) => void; setError: (value: string | null) => void;
  cropTarget: { slot: ImageSlotLayer; placement: Placement } | null; setCropTarget: (value: { slot: ImageSlotLayer; placement: Placement } | null) => void; proposalBrief: string; setProposalBrief: (value: string) => void; proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null; proposalBusy: boolean; proposeCopy: () => Promise<void>;
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
  const inspector = <InspectorContent tab={inspectorTab} pack={pack} state={state} defaultImageValues={defaultImageValues} brandColours={brandColours} onTextChange={updateTextValue} onUseTemplateText={applyTemplateText} onUseTemplateCopy={applyTemplateMetaCopy} onImageChange={handleImageChange} onCropClick={openCropForInput} onMetaChange={updateMetaCopy} onColourToggle={handleColourToggle} proposalBrief={proposalBrief} proposal={proposal} proposalBusy={proposalBusy} onBriefChange={setProposalBrief} onPropose={proposeCopy} />;
  const resolvedBrandPreview = brandPreview ?? { businessName: "Your business", displayDomain: "yourwebsite.com", logoUrl: null };
  const saveStatus = pendingImageUploads > 0 ? "Uploading…" : state.isSaving ? "Saving…" : state.isDirty ? "Unsaved changes" : state.lastSavedRevision !== null ? "Saved" : "Not saved yet";
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground" onKeyDown={handleKeyDown} tabIndex={0} role="region" aria-label="Ad Studio editor">
    <header className="grid shrink-0 grid-cols-1 gap-2 border-b border-border bg-card px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-5">
      <Tabs value={state.activePlacement} onValueChange={value => setActivePlacement(value as Placement)} className="min-w-0"><TabsList aria-label="Facebook ad placement" className="grid h-auto w-full grid-cols-2 bg-muted/60 sm:flex sm:w-auto"><TabsTrigger value="feed" className="min-h-11 min-w-0 px-2 text-xs sm:px-3 md:px-4 md:text-sm">Facebook Feed<span className="hidden lg:inline"> · 1080 × 1350</span></TabsTrigger><TabsTrigger value="story" className="min-h-11 min-w-0 px-2 text-xs sm:px-3 md:px-4 md:text-sm">Facebook Story<span className="hidden lg:inline"> · 1080 × 1920</span></TabsTrigger></TabsList></Tabs>
      <span className="order-3 w-full truncate text-right text-[11px] text-muted-foreground sm:col-span-2 sm:text-xs md:order-none md:col-span-1 md:w-auto" role="status" aria-live="polite">{saveStatus}</span>
      <div className="order-2 grid min-w-0 grid-cols-[2.75rem_2.75rem_minmax(0,0.8fr)_minmax(0,1.25fr)] items-center gap-1.5 sm:flex sm:justify-end md:order-none md:gap-2"><Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo" className="min-h-11 min-w-11 rounded-full"><RotateCcw /></Button><Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo" className="min-h-11 min-w-11 rounded-full"><RotateCw /></Button><Button onClick={handleSave} disabled={!canSave || state.isSaving || pendingImageUploads > 0} className="min-h-11 min-w-0 rounded-full px-2.5 sm:px-4"><span className="truncate">{state.isSaving ? "Saving…" : "Save"}</span><Save className="ml-1.5 size-4 shrink-0" /></Button><Button onClick={handlePublish} disabled={!canSave || state.isSaving || pendingImageUploads > 0} variant="outline" aria-label="Review and publish" className="min-h-11 min-w-0 rounded-full px-2.5 sm:px-4"><span className="sm:hidden">Review</span><span className="hidden sm:inline">Review & publish</span></Button></div>
    </header>
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
      <section aria-label="Ad preview" className="order-first min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#eef1f5] p-3 md:p-5 xl:order-none">
        <div className={cn("mx-auto flex min-h-full w-full max-w-[760px] justify-center", state.activePlacement === "story" ? "h-full items-center" : "items-start py-1")}>
          <MetaPlacementPreview
            placement={state.activePlacement}
            brand={resolvedBrandPreview}
            copy={state.metaCopy}
            creative={<LayeredCanvas templateId={templateId} layout={activeLayout} colours={state.resolvedColourMap} imageValues={previewImages} textValues={previewCopy} cropOverrides={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.crops[state.activePlacement]]))} selectedLayerId={state.selectedLayerId} onSelect={selectLayer} onCropImage={openCrop} className="h-full w-full" />}
          />
        </div>
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

function InspectorContent({ tab, pack, state, defaultImageValues, brandColours, onTextChange, onUseTemplateText, onUseTemplateCopy, onImageChange, onCropClick, onMetaChange, onColourToggle, proposalBrief, proposal, proposalBusy, onBriefChange, onPropose }: { tab: InspectorTab; pack: AdTemplate; state: EditorState; defaultImageValues: Record<string, string>; brandColours: BrandPackColours | null; onTextChange: (key: string, value: string) => void; onUseTemplateText: () => void; onUseTemplateCopy: () => void; onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => Promise<void>; onCropClick: (key: string) => void; onMetaChange: (field: keyof MetaCopy, value: string) => void; onColourToggle: (value: boolean) => void; proposalBrief: string; proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null; proposalBusy: boolean; onBriefChange: (value: string) => void; onPropose: () => Promise<void> }) {
  if (tab === "copy") return <div><MetaCopyPanel values={state.metaCopy} onChange={onMetaChange} onUseTemplateCopy={onUseTemplateCopy} /><ProposalPanel brief={proposalBrief} proposal={proposal} busy={proposalBusy} textInputCount={editorTextInputs(pack).length} onBriefChange={onBriefChange} onPropose={onPropose} /></div>;
  if (tab === "appearance") return <aside aria-label="Appearance" className="space-y-4 border-t border-border p-4"><div><h3 className="text-sm font-semibold">Appearance</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose the colours that feel right for this ad.</p></div><ColourToggle useBrandPack={state.colourMode === "brand_pack"} brandPackAvailable={!!brandColours} resolvedColourMap={state.resolvedColourMap} onToggle={onColourToggle} /></aside>;
  return <InputsPanel textInputs={pack.textInputs} imageInputs={pack.imageInputs} textValues={state.textValues} imageValues={Object.fromEntries(state.imageValues.map(iv => [iv.inputKey, iv.previewUrl ?? iv.dataUrl]))} defaultImageValues={defaultImageValues} onTextChange={onTextChange} onUseTemplateText={onUseTemplateText} onImageChange={onImageChange} onCropClick={onCropClick} />;
}

function ProposalPanel({
  className,
  brief,
  proposal,
  busy,
  textInputCount,
  onBriefChange,
  onPropose,
}: {
  className?: string;
  brief: string;
  proposal: { onImage: Record<string, string>; copy: MetaCopy; source: string } | null;
  busy: boolean;
  textInputCount: number;
  onBriefChange: (value: string) => void;
  onPropose: () => void;
}) {
  return (
    <section aria-label="AI copy" className={cn("border-t border-border p-4", className)}>
      <div className="rounded-(--r-card) border border-primary/20 bg-primary/[0.04] p-3.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles aria-hidden className="size-4 text-primary" />
          Write every field with AI
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Uses this brief, the selected template and your Brand Pack. One click updates all {textInputCount} design fields plus primary text, headline, description and CTA.
        </p>
        <label htmlFor="copy-suggestion-brief" className="mt-3 mb-1 block text-sm font-medium text-foreground">Ad brief</label>
        <textarea id="copy-suggestion-brief" value={brief} onChange={event => onBriefChange(event.target.value)} rows={5} placeholder="Example: Promote the Saturday open home at 18 Smith Street to young families. Mention the renovated kitchen and free suburb guide." className="min-h-28 w-full resize-y rounded-(--r-card) border border-input bg-background px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" />
        <Button type="button" onClick={onPropose} disabled={busy || !brief.trim()} className="mt-3 min-h-11 w-full rounded-full">
          <Sparkles aria-hidden className="size-4" />
          {busy ? "Writing complete ad…" : "Generate all copy"}
        </Button>
      {proposal ? (
        <p role="status" className="mt-3 rounded-(--r-card) bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          Updated {Object.keys(proposal.onImage).length + 4} fields. Review the live Meta preview and edit anything you want.
        </p>
      ) : null}
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
