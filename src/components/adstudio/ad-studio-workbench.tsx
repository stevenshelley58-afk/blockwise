"use client";

import dynamic from "next/dynamic";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Image as ImageIcon,
  LayoutGrid,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Target,
  Type,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioOfferTemplate,
  FirstAdInput,
} from "@/lib/adstudio";
import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";
import { syncCreativeWithCopyAndImage } from "@/lib/adstudio/creative-design-json.ts";

import { ANGLES } from "./angles";
import { AdPreview, FORMAT_META, PreviewControls, VariantStrip } from "./preview";
import type { PreviewFormat, PreviewMode, SelectedElement } from "./preview";
import { STYLES } from "./styles";
import { TopBar } from "./topbar";
import { useAdStudio } from "./use-ad-studio";
import { useBrandKit } from "./use-brand-kit";
import { useCampaignActions } from "./use-campaign-actions";
import type { CopyState } from "./use-copy";
import { seedCopy, toMetaCta, useCopy } from "./use-copy";
import { MEDIA_ASSETS, useMedia } from "./use-media";
import { useReadiness } from "./use-readiness";

import { BrandPanel } from "./panels/brand-panel";
import { CampaignPanel } from "./panels/campaign-panel";
import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { SettingsPanel } from "./panels/settings-panel";
import { TemplatesPanel } from "./panels/templates-panel";
import { NewAdDialog } from "./new-ad-dialog";
import { FirstRunExplainer } from "./first-run-explainer";

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

type NavItem = { id: import("./use-ad-studio").StudioSection; label: string; icon: LucideIcon };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Create",
    items: [
      { id: "campaign", label: "Ad", icon: Target },
      { id: "templates", label: "Templates", icon: LayoutGrid },
      { id: "brand", label: "Brand", icon: ShieldCheck },
      { id: "media", label: "Media", icon: ImageIcon },
      { id: "copy", label: "Copy", icon: Type },
      { id: "publish", label: "Publish", icon: Send },
    ],
  },
  {
    label: "Workspace",
    items: [{ id: "settings", label: "Settings", icon: Settings2 }],
  },
];

const MOBILE_NAV: Array<{ id: "campaign" | "media" | "copy" | "publish"; label: string; icon: LucideIcon }> = [
  { id: "campaign", label: "Ad", icon: Target },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "copy", label: "Copy", icon: Type },
  { id: "publish", label: "Publish", icon: Send },
];

const PREVIEW_TO_AD_FORMAT: Record<PreviewFormat, AdStudioFormat> = {
  story: "9:16",
  feed: "4:5",
  square: "1:1",
  landscape: "1.91:1",
};

const FabricAdEditor = dynamic(
  () => import("./canvas/fabric-ad-editor").then((mod) => mod.FabricAdEditor),
  { ssr: false, loading: () => <div className="studio-fabric-loading">Loading editor...</div> },
);

const GOAL_LABELS: Record<string, string> = {
  seller_leads: "Generate vendor leads",
  appraisal_bookings: "Get appraisal leads",
  buyer_leads: "Buyer demand check",
  market_update_leads: "Drive market report downloads",
  downsizer_leads: "Generate vendor leads",
  investor_leads: "Generate vendor leads",
  open_home_followup: "Promote open home",
  listing_nurture: "Promote recent sale",
};

function initialCampaignGoal(pack: AdStudioCampaignPack): string {
  return GOAL_LABELS[pack.campaign.goal] ?? "Get appraisal leads";
}

function initialOfferLabel(pack: AdStudioCampaignPack, offers: AdStudioOfferTemplate[]): string {
  const variant = pack.variants[0];
  if (variant?.offer) return variant.offer;
  return offers.find((offer) => offer.offerId === pack.campaign.offerId)?.name ?? "Free appraisal";
}

function initialMarket(pack: AdStudioCampaignPack): string {
  const suburb = pack.campaign.market.suburb || "";
  const state = pack.campaign.market.state || "";
  return [suburb, state].filter(Boolean).join(", ") || "Perth, WA";
}

function initialDestinationUrl(pack: AdStudioCampaignPack, brandKit: AdStudioBrandKit): string {
  const copyPack = pack.copyPacks[0];
  return (
    copyPack?.googleSearch.finalUrl ||
    copyPack?.googlePmax.finalUrl ||
    copyPack?.googleDemandGen.finalUrl ||
    brandKit.source.url ||
    ""
  );
}

function labelForImageSrc(src: string): string {
  const asset = MEDIA_ASSETS.find((item) => item.src === src);
  if (asset) return asset.label;
  return src.startsWith("/api/adstudio/media?") || src.startsWith("data:image/") ? "Uploaded image" : "Creative image";
}

function primaryImageFromCreative(creative: AdStudioCreative | null | undefined): { src: string; label: string } | null {
  const imageObject = creative?.canvas.objects.find((object) => object.role === "primary_image");
  const src = imageObject?.content || imageObject?.assetId;
  return src ? { src, label: labelForImageSrc(src) } : null;
}

function primaryImageForVariant(
  pack: AdStudioCampaignPack,
  variantId: string | undefined,
  format?: AdStudioFormat,
): { src: string; label: string } | null {
  if (!variantId) return null;
  const creative =
    (format ? pack.creatives.find((item) => item.variantId === variantId && item.format === format) : null) ??
    pack.creatives.find((item) => item.variantId === variantId && item.format === "9:16") ??
    pack.creatives.find((item) => item.variantId === variantId);
  return primaryImageFromCreative(creative);
}

function commitVariantEdits(input: {
  pack: AdStudioCampaignPack;
  variantId: string | undefined;
  copy: CopyState;
  offerLabel: string;
  primaryImage: string;
}): AdStudioCampaignPack {
  if (!input.variantId) return input.pack;
  return {
    ...input.pack,
    variants: input.pack.variants.map((variant) =>
      variant.variantId === input.variantId
        ? { ...variant, headline: input.copy.headline, offer: input.offerLabel, cta: input.copy.cta }
        : variant,
    ),
    copyPacks: input.pack.copyPacks.map((copyPack) => {
      if (copyPack.variantId !== input.variantId) return copyPack;
      return {
        ...copyPack,
        meta: {
          ...copyPack.meta,
          primaryText: [input.copy.primaryText, ...copyPack.meta.primaryText.slice(1)],
          headlines: [input.copy.headline, ...copyPack.meta.headlines.slice(1)],
          descriptions: [input.copy.description, ...copyPack.meta.descriptions.slice(1)],
          cta: toMetaCta(input.copy.cta),
        },
        landingPage: {
          ...copyPack.landingPage,
          headline: input.copy.headline,
          subheadline: input.copy.description,
          cta: input.copy.cta,
        },
      };
    }),
    creatives: input.pack.creatives.map((creative) =>
      creative.variantId === input.variantId ? syncCreativeWithCopyAndImage(creative, input.copy, input.primaryImage) : creative,
    ),
  };
}

function copyFieldForSelectedElement(element: SelectedElement): "primaryText" | "headline" | "description" | "cta" | null {
  if (element === "primaryText") return "primaryText";
  if (element === "headline") return "headline";
  if (element === "description") return "description";
  if (element === "cta") return "cta";
  return null;
}

function patchActionForSelectedElement(element: SelectedElement): string {
  if (element === "headline") return "More direct";
  if (element === "description") return "Less hype";
  if (element === "cta") return "Sharper";
  return "Sharper";
}

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
  const [promptedForFirstAd, setPromptedForFirstAd] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("feed");
  const previewMode: PreviewMode = "platform";
  const zoom = previewFormat === "feed" ? 58 : 68;
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("headline");
  const [campaignGoal, setCampaignGoal] = useState(() => initialCampaignGoal(initialPack));
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabel(initialPack, offers));
  const [market, setMarket] = useState(() => initialMarket(initialPack));
  const [propertyType, setPropertyType] = useState("Houses");
  const [leadDestination, setLeadDestination] = useState("Landing page");
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestinationUrl(initialPack, brandKit));
  const [generatingBackground, setGeneratingBackground] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ src: string; label: string; type: string; ratio: string }>>([]);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((options?: { silent?: boolean }) => Promise<boolean>) | null>(null);
  const saveStateRef = useRef<"saved" | "saving" | "error">("saved");

  const studio = useAdStudio();
  const { brand, initials, domain } = useBrandKit(brandKit);
  const {
    copy,
    setCopy,
    updateCopy,
    copyMode,
    setCopyMode,
    brief,
    setBrief,
    generating,
    feedback,
    alternates,
    generateCopy,
    applyCopyAssist,
    patchCopyField,
    applyAlternate,
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

  const initialMedia = useMemo(
    () => primaryImageForVariant(initialPack, initialPack.variants[0]?.variantId, PREVIEW_TO_AD_FORMAT.story),
    [initialPack],
  );
  const { primaryImage, setPrimaryImage, primaryImageName, setPrimaryImageName, fileInputRef, replaceImage, openFilePicker } = useMedia(
    studio.showToast,
    () => {
      setSelectedElement("image");
      studio.setSection("media");
    },
    {
      initialImage: initialMedia,
      workspaceId,
      brandKitId: brandKit.brandKitId,
      isSample,
      onUploaded: (asset) =>
        setUploadedAssets((prev) =>
          prev.some((item) => item.src === asset.src)
            ? prev
            : [{ src: asset.src, label: asset.label, type: "Uploaded", ratio: "Just now" }, ...prev],
        ),
    },
  );

  // Magic moment: the first time a new user adds a photo to an untouched ad, write
  // copy grounded in that photo straight away, so uploading visibly produces an ad
  // instead of just a toast. Gated to first-run + copy still untouched + once per
  // session, so it can never overwrite copy someone has already written or generated.
  const seededCopyRef = useRef(copy);
  const autoDesignedRef = useRef(false);
  async function handleUploadImage(file: File | null | undefined) {
    let uploaded: { src: string; label: string } | undefined;
    try {
      uploaded = await replaceImage(file);
    } catch {
      return; // replaceImage already surfaced the failure to the user
    }
    if (!uploaded) return;
    const copyUntouched =
      copy.primaryText === seededCopyRef.current.primaryText &&
      copy.headline === seededCopyRef.current.headline &&
      copy.description === seededCopyRef.current.description &&
      copy.cta === seededCopyRef.current.cta;
    // Fire on a fresh, untouched ad (first run or no variants yet); never clobber written copy.
    const isNewAd = firstRun || pack.variants.length === 0;
    if (autoDesignedRef.current || generating || !isNewAd || !copyUntouched) return;
    autoDesignedRef.current = true;
    studio.setSection("copy");
    studio.setBusy(true);
    studio.setBusyMessage("Designing your ad from your photo...");
    try {
      await generateCopy("ai", copyContext, uploaded.src);
    } finally {
      studio.setBusy(false);
    }
  }

  const workspaceMediaAssets = useMemo(
    () =>
      [
        ...brandKit.assets.listingImages.map((src, index) => ({
          src,
          label: `Workspace image ${index + 1}`,
          type: "Workspace asset",
          ratio: "Image",
        })),
        ...brandKit.assets.officeImages.map((src, index) => ({
          src,
          label: `Office image ${index + 1}`,
          type: "Brand asset",
          ratio: "Image",
        })),
        ...brandKit.assets.headshots.map((src, index) => ({
          src,
          label: `Agent image ${index + 1}`,
          type: "Brand asset",
          ratio: "Image",
        })),
      ],
    [brandKit.assets.headshots, brandKit.assets.listingImages, brandKit.assets.officeImages],
  );
  // Uploads land at the front of the library so the image you just added is
  // visible and reselectable right away, not only after a reload.
  // Demo/sample imagery is only shown when viewing the sample workspace; real
  // users see only their own uploaded and workspace assets.
  const demoAssets = isSample ? MEDIA_ASSETS : [];
  const mediaAssets = [...uploadedAssets, ...(workspaceMediaAssets.length > 0 ? workspaceMediaAssets : demoAssets)];

  function selectMediaImage(src: string) {
    const asset = mediaAssets.find((item) => item.src === src);
    setPrimaryImage(src);
    setPrimaryImageName(asset?.label ?? "Uploaded image");
    setSelectedElement("image");
    studio.setSaveState("saving");
    studio.showToast("Image selected");
  }

  const { readinessItems } = useReadiness({
    campaignGoal,
    offerLabel,
    market,
    propertyType,
    destinationUrl,
    primaryImage,
    copy,
    pack,
  });

  // API routes used in campaign actions:
  //   POST /api/adstudio/campaigns - Generate variants
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft - save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download - Export creatives
  //   platforms: ["meta"]
  // Campaign readiness checklist lives in the publish panel.
  const { generateFirstAd, generateVariantsForAngle, saveDraft, exportCreatives } = useCampaignActions({
    pack,
    brandKit,
    offers,
    market,
    copy,
    primaryImage,
    offerLabel,
    campaignGoal,   // M4: pass goal so generation includes it
    destinationUrl,
    selectedVariantIndex,
    setPack,
    setSelectedVariantIndex,
    setCopy,
    setPrimaryImage,
    setOfferLabel,
    setSaveState: studio.setSaveState,
    setSaveError: studio.setSaveError,
    setBusy: studio.setBusy,
    setBusyMessage: studio.setBusyMessage,
    setSection: studio.setSection,
    setSelectedAngleId,
    showToast: studio.showToast,
  });

  useEffect(() => {
    saveDraftRef.current = saveDraft;
    saveStateRef.current = studio.saveState;
  }, [saveDraft, studio.saveState]);

  useEffect(() => {
    if (studio.saveState !== "saving") return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const timer = setTimeout(() => {
      void saveDraft({ silent: true });
    }, 900);
    autoSaveTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [
    campaignGoal,
    copy,
    destinationUrl,
    market,
    offerLabel,
    pack,
    primaryImage,
    saveDraft,
    selectedVariantIndex,
    studio.saveState,
  ]);

  useEffect(() => {
    function flushPendingDraft() {
      if (saveStateRef.current === "saving") {
        void saveDraftRef.current?.({ silent: true });
      }
    }

    window.addEventListener("pagehide", flushPendingDraft);
    window.addEventListener("beforeunload", flushPendingDraft);
    return () => {
      flushPendingDraft();
      window.removeEventListener("pagehide", flushPendingDraft);
      window.removeEventListener("beforeunload", flushPendingDraft);
    };
  }, []);

  // H9: delete campaign with confirmation; lives in publish panel (ownership boundary)
  async function deleteCampaign() {
    if (!window.confirm("Delete this campaign? This cannot be undone.")) return;
    const res = await fetch(`/api/adstudio/campaigns/${pack.campaign.campaignId}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/ad-studio";
    } else {
      studio.showToast("Could not delete campaign");
    }
  }

  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];

  // First open with no ad yet: show the New Ad popup (templates / reuse / radar).
  useEffect(() => {
    if (promptedForFirstAd) return;
    setPromptedForFirstAd(true);
    if (pack.variants.length === 0) {
      setNewAdStep("source");
      setNewAdOpen(true);
    }
  }, [pack.variants.length, promptedForFirstAd]);

  // M6: derive per-section completion state from readiness items for rail indicators
  // Computed inline at render time; no extra memo needed (readinessItems is already memoised)
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

  const getVariantPrimaryImage = useCallback((variantId: string | undefined, sourcePack: AdStudioCampaignPack = pack) => {
    return primaryImageForVariant(sourcePack, variantId, editorFormat);
  }, [editorFormat, pack]);

  const variants = useMemo(() => {
    const source = pack.variants.length > 0 ? pack.variants : initialPack.variants;
    return source.slice(0, 4).map((variant, index) => {
        const variantImage = getVariantPrimaryImage(variant.variantId);
      return {
        ...variant,
        displayName: `Ad ${index + 1}`,
      // M5: use the variant's own angle field as the label, not an index-offset into ANGLES
        angleLabel: variant.angle || selectedAngle.variantLabel,
        image: variantImage?.src ?? (isSample && MEDIA_ASSETS.some((item) => item.src === primaryImage) ? MEDIA_ASSETS[index % MEDIA_ASSETS.length].src : primaryImage),
      };
    });
  }, [getVariantPrimaryImage, initialPack.variants, pack.variants, primaryImage, selectedAngle.variantLabel, selectedVariantIndex]);

  function selectVariant(index: number) {
    const nextPack = commitVariantEdits({
      pack,
      variantId: selectedVariant?.variantId,
      copy,
      offerLabel,
      primaryImage,
    });
    const asset = isSample ? MEDIA_ASSETS[index % MEDIA_ASSETS.length] : null;
    const variant = nextPack.variants[index] ?? initialPack.variants[index];
    const variantImage = getVariantPrimaryImage(variant?.variantId, nextPack);
    const currentIsLibraryAsset = isSample && MEDIA_ASSETS.some((item) => item.src === primaryImage);
    void saveDraft({
      silent: true,
      packOverride: nextPack,
      variantIdOverride: selectedVariant?.variantId,
      copyOverride: copy,
      primaryImageOverride: primaryImage,
      offerLabelOverride: offerLabel,
    });
    setPack(nextPack);
    setSelectedVariantIndex(index);
    setCopy(seedCopy(nextPack, index));
    if (variantImage) {
      setPrimaryImage(variantImage.src);
      setPrimaryImageName(variantImage.label);
    } else if (currentIsLibraryAsset && asset) {
      setPrimaryImage(asset.src);
      setPrimaryImageName(asset.label);
    }
  }

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

  async function generateBackgroundImage() {
    if (!currentCreative || generatingBackground) return;
    setGeneratingBackground(true);
    studio.setBusy(true);
    studio.setBusyMessage("Generating background");
    try {
      const response = await fetch("/api/adstudio/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: [copy.headline, copy.description, market, propertyType, "real estate advertising background"]
            .filter(Boolean)
            .join(" | "),
          aspectRatio: currentCreative.format,
          stylePreset: "premium_editorial_real_estate",
          brandKitId: brandKit.brandKitId,
          brand: {
            palette: [brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent].filter(Boolean),
            styleTags: brandKit.visualStyle.styleTags,
            imageTreatment: brandKit.visualStyle.imageTreatment,
          },
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!response.ok || !json.image) throw new Error(json.error || "Could not generate background.");
      setPrimaryImage(json.image);
      setPrimaryImageName("Generated background");
      setSelectedElement("image");
      studio.setSaveState("saving");
      studio.showToast("Background generated");
    } catch (error) {
      studio.showToast(error instanceof Error ? error.message : "Could not generate background");
    } finally {
      setGeneratingBackground(false);
      studio.setBusy(false);
    }
  }

  // Adds another generated ad idea from the current defaults.
  function addVariant() {
    generateVariantsForAngle(selectedAngle, campaignGoal);
  }

  async function handleGenerateFirstAd(input: FirstAdInput) {
    await generateFirstAd(input);
  }

  function renderCampaignPanel(options?: { mobileSheet?: boolean }) {
    return (
      <CampaignPanel
        campaignGoal={campaignGoal}
        setCampaignGoal={setCampaignGoal}
        offerLabel={offerLabel}
        setOfferLabel={setOfferLabel}
        market={market}
        setMarket={setMarket}
        propertyType={propertyType}
        setPropertyType={setPropertyType}
        leadDestination={leadDestination}
        setLeadDestination={setLeadDestination}
        destinationUrl={destinationUrl}
        setDestinationUrl={setDestinationUrl}
        offers={offers}
        variantCount={pack.variants.length}
        onCreateAd={() => {
          if (options?.mobileSheet) setMobileAdDetailsOpen(false);
          openNewAd();
        }}
        onBrowseTemplates={() => {
          if (options?.mobileSheet) {
            setMobileAdDetailsOpen(false);
            openNewAd();
          } else {
            studio.setSection("templates");
          }
        }}
        templates={AD_STUDIO_TEMPLATES}
      />
    );
  }

  function renderPanel() {
    if (studio.section === "templates") {
      return (
        <TemplatesPanel
          templates={AD_STUDIO_TEMPLATES}
          onUseTemplate={(id) => openNewAd(id)}
          onStartBlank={() => openNewAd("")}
        />
      );
    }
    if (studio.section === "brand") {
      return <BrandPanel brand={brand} brandKit={brandKit} />;
    }
    if (studio.section === "media") {
      // 1a: wire onSelectImage so library tiles actually update the primary image
      return (
        <MediaPanel
          primaryImage={primaryImage}
          primaryImageName={primaryImageName}
          openFilePicker={openFilePicker}
          onUploadImage={handleUploadImage}
          onUploadRejected={studio.showToast}
          onSelectImage={selectMediaImage}
          mediaAssets={mediaAssets}
          onGenerateBackground={() => void generateBackgroundImage()}
          generatingBackground={generatingBackground}
        />
      );
    }
    if (studio.section === "copy") {
      return (
        <CopyPanel
          copy={copy}
          updateCopy={updateCopy}
          copyMode={copyMode}
          setCopyMode={setCopyMode}
          brief={brief}
          setBrief={setBrief}
          generating={generating}
          feedback={feedback}
          alternates={alternates}
          context={copyContext}
          onGenerate={(kind, context) => void generateCopy(kind, context, primaryImage)}
          onAssist={(action, context) => void applyCopyAssist(action, context, primaryImage)}
          onApplyAlternate={applyAlternate}
        />
      );
    }
    if (studio.section === "publish") {
      // M1: wire real props; H9: pass deleteCampaign
      return (
        <PublishSetupPanel
          campaignId={pack.campaign.campaignId}
          campaignPack={pack}
          destinationUrl={destinationUrl}
          onExport={exportCreatives}
          onDelete={deleteCampaign}
        />
      );
    }
    if (studio.section === "settings") {
      return <SettingsPanel />;
    }
    return renderCampaignPanel();
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
        <aside className="studio-rail" aria-label="Ad Studio sections">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} style={{ display: "grid", gap: 2 }}>
              <span className="studio-rail-label">{group.label}</span>
              {group.items.map((item) => {
                const Icon = item.icon;

                // M6: map readiness items to section, derive dot state
                const sectionItems: Record<string, string[]> = {
                  campaign: ["Goal & offer", "Location", "Property type"],
                  media: ["Primary media"],
                  copy: ["Ad copy", "Call to action"],
                  brand: [],   // special-cased below
                  publish: [], // all items
                };
                let railState: "done" | "warn" | "todo" | null = null;
                if (item.id === "brand") {
                  railState = brandKit.reviewStatus === "approved" ? "done" : "warn";
                } else if (item.id === "publish") {
                  const allDone = readinessItems.every((ri) => ri.state === "done");
                  railState = allDone ? "done" : readinessItems.some((ri) => ri.state === "warn") ? "warn" : "todo";
                } else {
                  const labels = sectionItems[item.id] ?? [];
                  if (labels.length > 0) {
                    const relevant = readinessItems.filter((ri) => labels.includes(ri.label));
                    if (relevant.length > 0) {
                      if (relevant.every((ri) => ri.state === "done")) railState = "done";
                      else if (relevant.some((ri) => ri.state === "warn")) railState = "warn";
                      else railState = "todo";
                    }
                  }
                }

                return (
                  <button
                    className={studio.section === item.id ? "active" : ""}
                    key={item.id}
                    type="button"
                    onClick={() => (item.id === "templates" ? openNewAd(undefined, "template") : studio.setSection(item.id))}
                  >
                    <Icon aria-hidden size={18} />
                    <span>{item.label}</span>
                    {railState === "done" && <Check aria-hidden size={13} style={{ color: "#006d38", marginLeft: "auto", flexShrink: 0 }} />}
                    {railState === "warn" && <CircleAlert aria-hidden size={13} style={{ color: "#8a5a00", marginLeft: "auto", flexShrink: 0 }} />}
                    {railState === "todo" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#dfe6f0", marginLeft: "auto", flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="studio-left-panel" aria-label={`${studio.section} setup`}>
          {firstRun && !newAdOpen ? <FirstRunExplainer /> : null}
          {renderPanel()}
        </section>

        <section className="studio-preview-column" aria-label="Ad preview">
          <PreviewControls
            previewFormat={previewFormat}
            setPreviewFormat={setPreviewFormat}
          />

          <div className="studio-stage">
            {currentCreative ? (
              <FabricAdEditor
                brandKit={brandKit}
                copy={copy}
                creative={currentCreative}
                imageSrc={primaryImage}
                selectedElement={selectedElement}
                onCopyChange={updateCopy}
                onCreativeChange={updateCreative}
                onImageChange={setPrimaryImage}
                onPatchSelectedLayer={patchSelectedLayer}
                onRequestImageReplace={openFilePicker}
                onSelectedElementChange={handleCanvasElementSelect}
              />
            ) : (
              <AdPreview
                brand={brand}
                domain={domain}
                initials={initials}
                copy={copy}
                image={primaryImage}
                format={previewFormat}
                mode={previewMode}
                zoom={zoom}
                selectedElement={selectedElement}
                setSelectedElement={(element) => {
                  setSelectedElement(element);
                  studio.setSection(element === "image" ? "media" : "copy");
                }}
              />
            )}
            {studio.busy && (
              <div className="studio-busy">
                <div className="studio-busy-card">
                  <RefreshCw aria-hidden size={22} />
                  <strong>{studio.busyMessage}</strong>
                  <span>No changes were made until generation completes.</span>
                </div>
              </div>
            )}
          </div>

          <VariantStrip
            variants={variants}
            selectedVariantIndex={selectedVariantIndex}
            onSelect={selectVariant}
            onAdd={() => openNewAd()}
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
        </section>
      </div>

      <div className="studio-mobile-body">
        <div className="studio-mobile-campaign">
          <button
            className="studio-mobile-campaign-btn"
            type="button"
            aria-controls="studio-mobile-ad-details"
            aria-expanded={mobileAdDetailsOpen}
            onClick={() => setMobileAdDetailsOpen(true)}
          >
            <Target aria-hidden size={18} />
            {campaignName}
            <ChevronDown aria-hidden size={16} />
          </button>
        </div>

        {mobileAdDetailsOpen && (
          <div
            className="studio-mobile-sheet-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setMobileAdDetailsOpen(false);
            }}
          >
            <section
              id="studio-mobile-ad-details"
              className="studio-mobile-sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Ad details"
            >
              <header className="studio-mobile-sheet-head">
                <div>
                  <strong>Ad details</strong>
                  <span>{campaignName}</span>
                </div>
                <button type="button" aria-label="Close ad details" onClick={() => setMobileAdDetailsOpen(false)}>
                  <X aria-hidden size={18} />
                </button>
              </header>
              <div className="studio-mobile-sheet-body">{renderCampaignPanel({ mobileSheet: true })}</div>
            </section>
          </div>
        )}

        <div className="studio-mobile-format-tabs">
          {(["story", "feed", "square"] as PreviewFormat[]).map((item) => (
            <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
              {FORMAT_META[item].label}
            </button>
          ))}
        </div>

        {studio.mobileTab === "campaign" && (
          <div className="studio-mobile-preview-wrap">
            <AdPreview
              brand={brand}
              domain={domain}
              initials={initials}
              copy={copy}
              image={primaryImage}
              format={previewFormat}
              mode="platform"
              zoom={100}
              selectedElement={selectedElement}
              setSelectedElement={(element) => {
                setSelectedElement(element);
                studio.setMobileTab(element === "image" ? "media" : "copy");
              }}
            />
          </div>
        )}

        {studio.mobileTab === "media" && (
          <div className="studio-mobile-panel">
            <MediaPanel
              primaryImage={primaryImage}
              primaryImageName={primaryImageName}
              openFilePicker={openFilePicker}
              onUploadImage={handleUploadImage}
              onUploadRejected={studio.showToast}
              onSelectImage={selectMediaImage}
              mediaAssets={mediaAssets}
              onGenerateBackground={() => void generateBackgroundImage()}
              generatingBackground={generatingBackground}
            />
          </div>
        )}

        {studio.mobileTab === "copy" && (
          <div className="studio-mobile-panel">
            <CopyPanel
              copy={copy}
              updateCopy={updateCopy}
              copyMode={copyMode}
              setCopyMode={setCopyMode}
              brief={brief}
              setBrief={setBrief}
              generating={generating}
              feedback={feedback}
              alternates={alternates}
              context={copyContext}
              onGenerate={(kind, context) => void generateCopy(kind, context, primaryImage)}
              onAssist={(action, context) => void applyCopyAssist(action, context, primaryImage)}
              onApplyAlternate={applyAlternate}
            />
          </div>
        )}

        {studio.mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishSetupPanel
              campaignId={pack.campaign.campaignId}
              campaignPack={pack}
              destinationUrl={destinationUrl}
              onExport={exportCreatives}
              onDelete={deleteCampaign}
            />
          </div>
        )}

        <div className="studio-mobile-variants">
          <VariantStrip variants={variants} selectedVariantIndex={selectedVariantIndex} onSelect={selectVariant} compact />
        </div>
      </div>

      {studio.busy && (
        <div className="studio-mobile-busy">
          <RefreshCw aria-hidden size={20} />
          <strong>{studio.busyMessage}</strong>
        </div>
      )}

      <div className="studio-mobile-status" data-state={studio.saveState}>
        {studio.statusText}
      </div>

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
        onGenerate={handleGenerateFirstAd}
        initialTemplateId={newAdTemplateId}
        initialStep={newAdStep}
      />

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}
    </main>
  );
}
