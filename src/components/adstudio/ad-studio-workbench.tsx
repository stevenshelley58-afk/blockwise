"use client";

import Link from "next/link";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCreative,
  AdStudioOfferTemplate,
} from "@/lib/adstudio";
import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";

import { ANGLES } from "./angles";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";
import { FirstRunExplainer } from "./first-run-explainer";
import { NewAdDialog } from "./new-ad-dialog";
import { FORMAT_META } from "./preview";
import type { PreviewFormat, SelectedElement } from "./preview";
import { STYLES } from "./styles";
import { TopBar } from "./topbar";
import { useAdStudio } from "./use-ad-studio";
import { useBrandKit } from "./use-brand-kit";
import { useCampaignActions } from "./use-campaign-actions";
import type { GenerationProgress } from "./use-campaign-actions";
import { useCopy } from "./use-copy";
import { useReadiness } from "./use-readiness";
import { useWorkbenchAutosave } from "./use-workbench-autosave";
import { useWorkbenchMedia } from "./use-workbench-media";
import { useWorkbenchVariants } from "./use-workbench-variants";
import {
  PREVIEW_TO_AD_FORMAT,
  copyFieldForSelectedElement,
  initialCampaignGoal,
  initialDestinationUrl,
  initialMarket,
  initialOfferLabel,
  patchActionForSelectedElement,
} from "./workbench-helpers";
import { WorkbenchMobileBody } from "./workbench-mobile";
import { WorkbenchCampaignPanel, WorkbenchSectionPanel } from "./workbench-panels";
import type { CopyPanelGroupProps, MediaPanelGroupProps, PublishPanelGroupProps } from "./workbench-panels";
import { WorkbenchPreviewColumn } from "./workbench-preview-column";
import { MOBILE_NAV, WorkbenchRail } from "./workbench-rail";

type AdStudioWorkbenchProps = {
  workspaceId: string;
  brandKit: AdStudioBrandKit;
  campaignPack: AdStudioCampaignPack;
  offers: AdStudioOfferTemplate[];
  performance: {
    leads: number;
    costPerLeadAud: number;
    bookedAppraisals: number;
    bestFormat: string;
    recommendations: string[];
  };
  firstRun?: boolean;
  isSample?: boolean;
};

export function AdStudioWorkbench({
  workspaceId,
  brandKit,
  campaignPack: initialPack,
  offers,
  firstRun = false,
  isSample = false,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(initialPack);
  const [newAdOpen, setNewAdOpen] = useState(false);
  const [newAdTemplateId, setNewAdTemplateId] = useState<string | undefined>(undefined);
  const [newAdStep, setNewAdStep] = useState<"source" | "template">("source");
  const [mobileAdDetailsOpen, setMobileAdDetailsOpen] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("feed");
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("headline");
  const [campaignGoal, setCampaignGoal] = useState(() => initialCampaignGoal(initialPack));
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabel(initialPack, offers));
  const [market, setMarket] = useState(() => initialMarket(initialPack));
  const [propertyType, setPropertyType] = useState("Houses");
  const [leadDestination, setLeadDestination] = useState("Landing page");
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestinationUrl(initialPack, brandKit));
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  // Run-once guard for the first-open New Ad prompt; never read during render.
  const promptedForFirstAdRef = useRef(false);

  const studio = useAdStudio();
  const { brand, initials, domain } = useBrandKit(brandKit);
  // B2: an unapproved extracted kit can generate and edit, but is flagged as a
  // draft everywhere and keeps publish blocked until it is confirmed.
  const brandIsDraft = !isSample && brandKit.reviewStatus !== "approved";
  const {
    copy, setCopy, updateCopy, copyMode, setCopyMode, brief, setBrief, generating, feedback, alternates,
    generateCopy, applyCopyAssist, patchCopyField, applyAlternate,
  } = useCopy(initialPack, studio.setSaveState, studio.showToast, setSelectedElement);

  const copyContext = {
    goal: campaignGoal,
    offer: offerLabel,
    market,
    propertyType,
    businessName: brand,
    // Brand kit governs wording style; sent verbatim with every generation.
    voice: brandKit.tone.voice,
    preferredPhrases: brandKit.tone.preferredPhrases,
    neverSay: brandKit.tone.avoid,
  };

  function openNewAd(templateId?: string, step: "source" | "template" = "source") {
    setNewAdTemplateId(templateId);
    setNewAdStep(step);
    setNewAdOpen(true);
  }

  function closeNewAdDialog() {
    setNewAdOpen(false);
    setNewAdTemplateId(undefined);
  }

  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];
  const format = FORMAT_META[previewFormat];
  const campaignName = pack.campaign.name || "Ad draft";
  const selectedVariant = pack.variants[selectedVariantIndex] ?? pack.variants[0];
  const editorFormat = PREVIEW_TO_AD_FORMAT[previewFormat];
  const currentCreative = useMemo(() => {
    const variantId = selectedVariant?.variantId;
    return (
      pack.creatives.find((creative) => creative.variantId === variantId && creative.format === editorFormat) ??
      pack.creatives.find((creative) => creative.format === editorFormat) ??
      pack.creatives[0] ??
      null
    );
  }, [editorFormat, pack.creatives, selectedVariant?.variantId]);

  const {
    primaryImage, setPrimaryImage, primaryImageName, setPrimaryImageName, fileInputRef, openFilePicker,
    handleUploadImage, mediaAssets, selectMediaImage, generateBackgroundImage, generatingBackground,
  } = useWorkbenchMedia({
    workspaceId, brandKit, isSample, firstRun, initialPack, pack, currentCreative,
    copy, generating, copyContext, generateCopy, market, propertyType, setSelectedElement,
    setSection: studio.setSection,
    setBusy: studio.setBusy,
    setBusyMessage: studio.setBusyMessage,
    setSaveState: studio.setSaveState,
    showToast: studio.showToast,
  });

  const { readinessItems } = useReadiness({ campaignGoal, offerLabel, market, propertyType, destinationUrl, primaryImage, copy, pack });

  // API routes used in campaign actions:
  //   POST /api/adstudio/campaigns - Generate variants
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft - save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download - Export creatives
  //   platforms: ["meta"]
  // Campaign readiness checklist lives in the publish panel.
  const { generateFirstAd, generateVariantsForAngle, saveDraft, exportCreatives, retryExportFormat, exportStatus } = useCampaignActions({
    pack, brandKit, offers, market, copy, primaryImage, offerLabel,
    campaignGoal,   // M4: pass goal so generation includes it
    destinationUrl, selectedVariantIndex,
    setPack, setSelectedVariantIndex, setCopy, setPrimaryImage, setOfferLabel, setGeneration, setSelectedAngleId,
    setSaveState: studio.setSaveState,
    setSaveError: studio.setSaveError,
    setBusy: studio.setBusy,
    setBusyMessage: studio.setBusyMessage,
    setSection: studio.setSection,
    showToast: studio.showToast,
  });

  useWorkbenchAutosave({ saveDraft, saveState: studio.saveState, campaignGoal, copy, destinationUrl, market, offerLabel, pack, primaryImage, selectedVariantIndex });

  const { variants, selectVariant } = useWorkbenchVariants({
    pack, initialPack, isSample, editorFormat, selectedAngle,
    selectedVariantId: selectedVariant?.variantId, selectedVariantIndex,
    copy, offerLabel, primaryImage,
    setPack, setSelectedVariantIndex, setCopy, setPrimaryImage, setPrimaryImageName, saveDraft,
  });

  // H9: delete campaign with confirmation; lives in publish panel (ownership boundary)
  async function deleteCampaign() {
    setConfirmDeleteOpen(true);
  }

  async function confirmDeleteCampaign() {
    setConfirmDeleteOpen(false);
    const res = await fetch(`/api/adstudio/campaigns/${pack.campaign.campaignId}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/ad-studio";
    } else {
      studio.showToast("Could not delete campaign");
    }
  }

  // First open with no ad yet: show the New Ad popup (templates / reuse / radar).
  useEffect(() => {
    if (promptedForFirstAdRef.current) return;
    promptedForFirstAdRef.current = true;
    if (pack.variants.length === 0) {
      setNewAdStep("source");
      setNewAdOpen(true);
    }
  }, [pack.variants.length]);

  // Stable identity: the Fabric editor receives this; a new identity per render
  // would force the canvas to remount and lose in-progress edits.
  const { setSaveState } = studio;
  const updateCreative = useCallback((nextCreative: AdStudioCreative) => {
    setPack((current) => ({
      ...current,
      creatives: current.creatives.map((creative) =>
        creative.creativeId === nextCreative.creativeId ? nextCreative : creative,
      ),
    }));
    setSaveState("saving");
  }, [setSaveState]);

  const { setSection } = studio;
  const handleCanvasElementSelect = useCallback((element: SelectedElement) => {
    setSelectedElement(element);
    setSection(element === "image" ? "media" : "copy");
  }, [setSection]);

  async function patchSelectedLayer() {
    if (selectedElement === "image") {
      studio.setSection("media");
      openFilePicker();
      return;
    }
    const field = copyFieldForSelectedElement(selectedElement);
    if (!field) return;
    await patchCopyField(field, patchActionForSelectedElement(selectedElement), copyContext, primaryImage);
  }

  // Retry adds another generated ad idea from the current defaults.
  function retryPendingGeneration() {
    setGeneration(null);
    generateVariantsForAngle(selectedAngle, campaignGoal);
  }

  function dismissPendingGeneration() {
    setGeneration(null);
  }

  // Shared panel props: the same panels render in the desktop inspector and the mobile tabs.
  const mediaPanelProps: MediaPanelGroupProps = {
    primaryImage, primaryImageName, openFilePicker, mediaAssets, generatingBackground,
    onUploadImage: handleUploadImage,
    onUploadRejected: studio.showToast,
    onSelectImage: selectMediaImage,
    onGenerateBackground: () => void generateBackgroundImage(),
  };
  const copyPanelProps: CopyPanelGroupProps = {
    copy, updateCopy, copyMode, setCopyMode, brief, setBrief, generating, feedback, alternates,
    context: copyContext,
    onGenerate: (kind, context) => void generateCopy(kind, context, primaryImage),
    onAssist: (action, context) => void applyCopyAssist(action, context, primaryImage),
    onApplyAlternate: applyAlternate,
  };
  const publishPanelProps: PublishPanelGroupProps = {
    campaignId: pack.campaign.campaignId,
    campaignPack: pack,
    destinationUrl,
    onExport: exportCreatives,
    onDelete: deleteCampaign,
    brandApproved: !brandIsDraft,
    exportStatus,
    onRetryExportFormat: (format) => void retryExportFormat(format),
  };

  function renderCampaignPanel(options?: { mobileSheet?: boolean }) {
    return (
      <WorkbenchCampaignPanel
        {...{ campaignGoal, setCampaignGoal, offerLabel, setOfferLabel, market, setMarket, propertyType, setPropertyType, leadDestination, setLeadDestination, destinationUrl, setDestinationUrl }}
        offers={offers}
        variantCount={pack.variants.length}
        mobileSheet={options?.mobileSheet}
        onCloseMobileSheet={() => setMobileAdDetailsOpen(false)}
        onOpenNewAd={() => openNewAd()}
        onOpenTemplatesSection={() => studio.setSection("templates")}
      />
    );
  }

  return (
    <main className="studio-screen" aria-label="Ad Studio workspace">
      <style>{STYLES}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          void handleUploadImage(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      <TopBar
        campaignName={campaignName}
        showMore={studio.showMore}
        setShowMore={studio.setShowMore}
        onSave={saveDraft}
        onDelete={deleteCampaign}
        campaignId={pack.campaign.campaignId}
        showToast={studio.showToast}
      />

      <div className="studio-desktop-body">
        <WorkbenchRail
          section={studio.section}
          setSection={studio.setSection}
          brandApproved={brandKit.reviewStatus === "approved"}
          readinessItems={readinessItems}
          onOpenTemplates={() => openNewAd(undefined, "template")}
        />

        <section className="studio-left-panel" aria-label={`${studio.section} setup`}>
          {brandIsDraft && (
            <Link href="/ad-studio/brand" className="studio-draft-brand-chip">
              <CircleAlert aria-hidden size={15} />
              <span><b>Draft brand in use.</b> You can create ads now - confirm your brand before publishing.</span>
            </Link>
          )}
          {(studio.section === "media" || studio.section === "copy") && (
            <button className="studio-link-btn" type="button" onClick={() => studio.setSection("campaign")}>
              <ArrowLeft aria-hidden size={15} />
              Back to Ad settings
            </button>
          )}
          {firstRun && !newAdOpen ? <FirstRunExplainer /> : null}
          <WorkbenchSectionPanel
            section={studio.section}
            brand={brand}
            brandKit={brandKit}
            onUseTemplate={(id) => openNewAd(id)}
            onStartBlank={() => openNewAd("")}
            media={mediaPanelProps}
            copyPanel={copyPanelProps}
            publish={publishPanelProps}
            campaignPanel={renderCampaignPanel()}
          />
        </section>

        <WorkbenchPreviewColumn
          previewFormat={previewFormat}
          setPreviewFormat={setPreviewFormat}
          brandKit={brandKit}
          brand={brand}
          domain={domain}
          initials={initials}
          copy={copy}
          currentCreative={currentCreative}
          primaryImage={primaryImage}
          selectedElement={selectedElement}
          busy={studio.busy}
          busyMessage={studio.busyMessage}
          onCopyChange={updateCopy}
          onCreativeChange={updateCreative}
          onImageChange={setPrimaryImage}
          onPatchSelectedLayer={patchSelectedLayer}
          onRequestImageReplace={openFilePicker}
          onElementSelect={handleCanvasElementSelect}
          variants={variants}
          selectedVariantIndex={selectedVariantIndex}
          onSelectVariant={selectVariant}
          onAddVariant={() => openNewAd()}
          pending={generation}
          onRetryPending={retryPendingGeneration}
          onDismissPending={dismissPendingGeneration}
          onEditCopy={(index) => {
            selectVariant(index);
            studio.setSection("copy");
          }}
          onReplaceImage={(index) => {
            selectVariant(index);
            studio.setSection("media");
            openFilePicker();
          }}
          onRegenerate={(index) => {
            const variant = pack.variants[index];
            const angle = variant ? (ANGLES.find((a) => a.id === variant.angle) ?? selectedAngle) : selectedAngle;
            void generateVariantsForAngle(angle);
          }}
        />
      </div>

      <WorkbenchMobileBody
        {...{
          studio, brandIsDraft, campaignName, mobileAdDetailsOpen, setMobileAdDetailsOpen, renderCampaignPanel,
          previewFormat, setPreviewFormat, brand, domain, initials, copy, selectedElement, setSelectedElement,
          primaryImage, primaryImageName, openFilePicker, handleUploadImage, selectMediaImage, mediaAssets,
          generateBackgroundImage, generatingBackground, copyPanelProps, publishPanelProps,
          variants, selectedVariantIndex, selectVariant, generation, retryPendingGeneration, dismissPendingGeneration,
        }}
      />

      <footer className="studio-statusbar">
        {/* L5: data-state attribute lets CSS color the save chip; existing .error class also applies */}
        <span className={studio.saveState === "error" ? "error" : ""} data-state={studio.saveState}>{studio.statusText}</span>
        <span>{format.label} | {format.size}</span>
        <span>Creative preview</span>
      </footer>

      <nav className="studio-mobile-bottom" aria-label="Ad Studio mobile navigation">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button className={studio.mobileTab === item.id ? "active" : ""} key={item.id} type="button" onClick={() => studio.setMobileTab(item.id)}>
              <Icon aria-hidden size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <NewAdDialog
        open={newAdOpen}
        onClose={closeNewAdDialog}
        brandKit={brandKit}
        workspaceId={workspaceId}
        templates={AD_STUDIO_TEMPLATES}
        onGenerate={generateFirstAd}
        initialTemplateId={newAdTemplateId}
        initialStep={newAdStep}
      />

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}

      {confirmDeleteOpen && <ConfirmDeleteDialog onCancel={() => setConfirmDeleteOpen(false)} onConfirm={confirmDeleteCampaign} />}
    </main>
  );
}
