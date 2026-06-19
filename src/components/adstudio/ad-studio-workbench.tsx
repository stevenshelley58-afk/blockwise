"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
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
  AdStudioTemplate,
  FirstAdInput,
} from "@/lib/adstudio";
import { AD_STUDIO_TEMPLATES } from "@/lib/adstudio";
import { repairCreativeTextLayout, syncCreativeWithCopyAndImage } from "@/lib/adstudio/creative-design-json.ts";

import { ANGLES } from "./angles";
import { AdPreview, FORMAT_META, PreviewControls, VariantStrip } from "./preview";
import type { PreviewFormat, SelectedElement } from "./preview";
import { STYLES } from "./styles";
import { TopBar } from "./topbar";
import { useAdStudio } from "./use-ad-studio";
import { useBrandKit } from "./use-brand-kit";
import { useCampaignActions } from "./use-campaign-actions";
import type { GenerationProgress } from "./use-campaign-actions";
import type { CopyState } from "./use-copy";
import { COPY_LIMITS, seedCopy, toMetaCta, useCopy } from "./use-copy";
import { MEDIA_ASSETS, useMedia } from "./use-media";
import { useReadiness } from "./use-readiness";

import { BrandPanel } from "./panels/brand-panel";
import { CopyPanel } from "./panels/copy-panel";
import { MediaPanel } from "./panels/media-panel";
import { PublishSetupPanel } from "./panels/publish-panel";
import { SettingsPanel } from "./panels/settings-panel";
import { PanelHeader } from "./inspector";
import { NewAdDialog } from "./new-ad-dialog";

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
  showBrandSetupPrompt?: boolean;
};

type TemplateStartStep = "source" | "template" | "reuse" | "radar";
type NavItem = { id: import("./use-ad-studio").StudioSection | "templates"; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "text", label: "Text", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const MOBILE_NAV: Array<{ id: import("./use-ad-studio").MobileTab | "templates"; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "templates", label: "Templates", icon: LayoutGrid },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "text", label: "Text", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
  { id: "settings", label: "Settings", icon: Settings2 },
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

function dedupeAssetsBySrc<T extends { src: string }>(assets: T[]): T[] {
  const seen = new Set<string>();
  return assets.filter((asset) => (seen.has(asset.src) ? false : seen.add(asset.src)));
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

function applyImageToVariantFormats(input: {
  pack: AdStudioCampaignPack;
  variantId: string | undefined;
  copy: CopyState;
  formats: AdStudioFormat[];
  image: string;
}): AdStudioCampaignPack {
  if (!input.variantId || input.formats.length === 0 || !input.image) return input.pack;
  const formats = new Set(input.formats);
  return {
    ...input.pack,
    creatives: input.pack.creatives.map((creative) => {
      if (creative.variantId !== input.variantId) return creative;
      return formats.has(creative.format) ? syncCreativeWithCopyAndImage(creative, input.copy, input.image) : creative;
    }),
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
  showBrandSetupPrompt = false,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(() => ({
    ...initialPack,
    creatives: initialPack.creatives.map(repairCreativeTextLayout),
  }));
  const searchParams = useSearchParams();
  const [templateLibrary, setTemplateLibrary] = useState<AdStudioTemplate[]>(AD_STUDIO_TEMPLATES);
  const [activeTemplateKey, setActiveTemplateKey] = useState<string | undefined>(undefined);
  const [promptedForFirstAd, setPromptedForFirstAd] = useState(false);
  const [selectedAngleId, setSelectedAngleId] = useState("free_appraisal");
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("feed");
  const zoom = previewFormat === "feed" ? 58 : 68;
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("canvas");
  const [campaignGoal, setCampaignGoal] = useState(() => initialCampaignGoal(initialPack));
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabel(initialPack, offers));
  const [market, setMarket] = useState(() => initialMarket(initialPack));
  const [propertyType, setPropertyType] = useState("Houses");
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestinationUrl(initialPack, brandKit));
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ src: string; label: string; type: string; ratio: string }>>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templatePickerInitialStep, setTemplatePickerInitialStep] = useState<TemplateStartStep>("source");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [brandPromptOpen, setBrandPromptOpen] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((options?: { silent?: boolean }) => Promise<boolean>) | null>(null);
  const saveStateRef = useRef<"saved" | "saving" | "error">("saved");
  const radarPromptedRef = useRef(false);

  const studio = useAdStudio();
  const { brand, initials, domain } = useBrandKit(brandKit);
  // B2: an unapproved extracted kit can generate and edit, but is flagged as a
  // draft everywhere and keeps publish blocked until it is confirmed.
  const brandIsDraft = !isSample && brandKit.reviewStatus !== "approved";
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

  function selectTemplate(templateId?: string) {
    const template = templateId ? adTemplates.find((item) => item.id === templateId) : undefined;
    const key = template?.templateKey ?? template?.id ?? templateId;
    setActiveTemplateKey(key);
    if (template) {
      setCampaignGoal(GOAL_LABELS[template.goal] ?? campaignGoal);
      const offer = offers.find((item) => item.offerId === template.offerId);
      if (offer) setOfferLabel(offer.name);
    }
    setTemplatePickerOpen(false);
    setSelectedElement("image");
    studio.setSection("media");
    studio.setMobileTab("media");
    studio.showToast(template ? `${template.name} selected. Add a property photo.` : "Blank ad selected. Add a property photo.");
  }

  function selectedTemplateForGeneration(): AdStudioTemplate | undefined {
    if (!activeTemplateKey) return undefined;
    return adTemplates.find((template) => template.id === activeTemplateKey || template.templateKey === activeTemplateKey);
  }

  function descriptionForTemplate(template: AdStudioTemplate | undefined): string {
    if (template?.sampleCopy?.headline && template.sampleCopy.primaryText) {
      return `${template.sampleCopy.headline}. ${template.sampleCopy.primaryText}`.slice(0, 500);
    }
    if (template?.promptHint) return template.promptHint.slice(0, 500);
    return `Create a ${offerLabel} ad for ${market}.`.slice(0, 500);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadTemplateLibrary() {
      try {
        const response = await fetch(`/api/adstudio/template-library?workspaceId=${encodeURIComponent(workspaceId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as { templates?: AdStudioTemplate[] };
        if (!response.ok || !Array.isArray(payload.templates) || payload.templates.length === 0) return;
        if (!cancelled) setTemplateLibrary(payload.templates);
      } catch {
        if (!cancelled) setTemplateLibrary(AD_STUDIO_TEMPLATES);
      }
    }

    void loadTemplateLibrary();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

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
    const shouldGenerateFromUpload = (firstRun || pack.variants.length === 0) && !autoDesignedRef.current;
    if (shouldGenerateFromUpload) {
      const template = selectedTemplateForGeneration();
      autoDesignedRef.current = true;
      try {
        await handleGenerateFirstAd({
          mode: template ? "template" : "custom",
          source: template ? "template_library" : "blank",
          templateId: template?.id,
          templateKey: template?.templateKey ?? template?.id,
          imageBriefId: template?.imageBriefId,
          description: descriptionForTemplate(template),
          imageDataUrl: uploaded.src,
          formats: ["9:16", "4:5", "1:1"],
        });
      } catch {
        autoDesignedRef.current = false;
      }
      return;
    }
    if (pack.variants.length > 0 && selectedVariant?.variantId) {
      const updatedPack = applyImageToVariantFormats({
        pack,
        variantId: selectedVariant.variantId,
        copy,
        formats: currentVariantFormats,
        image: uploaded.src,
      });
      setPack(updatedPack);
      studio.setSaveState("saving");
    }
    const copyUntouched =
      copy.primaryText === seededCopyRef.current.primaryText &&
      copy.headline === seededCopyRef.current.headline &&
      copy.description === seededCopyRef.current.description &&
      copy.cta === seededCopyRef.current.cta;
    // Fire on a fresh, untouched ad (first run or no variants yet); never clobber written copy.
    const isNewAd = firstRun || pack.variants.length === 0;
    if (autoDesignedRef.current || generating || !isNewAd || !copyUntouched) return;
    autoDesignedRef.current = true;
    studio.setSection("text");
    setSelectedElement("headline");
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
  // The Media tab shows the customer's own assets (uploads + workspace/brand-kit
  // images); demo imagery only on the sample workspace. Dedupe by src.
  const mediaAssets = dedupeAssetsBySrc([
    ...uploadedAssets,
    ...(workspaceMediaAssets.length > 0 ? workspaceMediaAssets : demoAssets),
  ]);

  function selectMediaImage(src: string) {
    const asset = mediaAssets.find((item) => item.src === src);
    setPrimaryImage(src);
    setPrimaryImageName(asset?.label ?? "Uploaded image");
    setSelectedElement("image");
    studio.setSection("media");
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

  function goToSection(section: import("./use-ad-studio").StudioSection) {
    setSelectedElement("canvas");
    studio.setSection(section);
    studio.setMobileTab(section as import("./use-ad-studio").MobileTab);
  }

  function openTemplatePicker(initialStep: TemplateStartStep = "source") {
    setSelectedElement("canvas");
    setTemplatePickerInitialStep(initialStep);
    setTemplatePickerOpen(true);
  }

  // API routes used in campaign actions:
  //   POST /api/adstudio/campaigns - Generate variants
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft - save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download - Export creatives
  //   platforms: ["meta"]
  // Campaign readiness checklist lives in the publish panel.
  const { generateFirstAd, generateVariantsForAngle, saveDraft, exportCreatives, retryExportFormat, exportStatus } = useCampaignActions({
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
    setGeneration,
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

  const selectedAngle = ANGLES.find((angle) => angle.id === selectedAngleId) ?? ANGLES[0];
  const adTemplates = templateLibrary.length > 0 ? templateLibrary : AD_STUDIO_TEMPLATES;

  // First open with no ad yet: keep the embedded Create ad panel visible. The
  // modal only opens from an explicit source choice.
  useEffect(() => {
    if (promptedForFirstAd) return;
    setPromptedForFirstAd(true);
  }, [pack.variants.length, promptedForFirstAd]);

  useEffect(() => {
    if (searchParams.get("newAd") !== "radar" || radarPromptedRef.current) return;
    radarPromptedRef.current = true;
    openTemplatePicker("radar");
    studio.showToast("Choose a template, then add your own photo.");
  }, [searchParams]);

  useEffect(() => {
    if (!showBrandSetupPrompt || brandKit.reviewStatus === "approved") {
      setBrandPromptOpen(false);
      return;
    }
    const key = `blockwise:adstudio:brand-setup-skipped:${workspaceId}`;
    if (window.localStorage.getItem(key) === "1") return;
    setBrandPromptOpen(true);
  }, [brandKit.reviewStatus, showBrandSetupPrompt, workspaceId]);

  function skipBrandPrompt() {
    window.localStorage.setItem(`blockwise:adstudio:brand-setup-skipped:${workspaceId}`, "1");
    setBrandPromptOpen(false);
  }

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
  const currentVariantFormats = useMemo(
    () =>
      Array.from(
        new Set(
          pack.creatives
            .filter((creative) => creative.variantId === selectedVariant?.variantId)
            .map((creative) => creative.format),
        ),
      ),
    [pack.creatives, selectedVariant?.variantId],
  );

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
    if (element === "image") {
      setSection("media");
      return;
    }
    const textField = copyFieldForSelectedElement(element);
    if (textField) setSection("text");
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

  // Adds another generated ad idea from the current defaults.
  function addVariant() {
    generateVariantsForAngle(selectedAngle, campaignGoal);
  }

  function regenerateVariantPack(index: number) {
    const confirmed = window.confirm(
      "Regenerate this ad pack?\n\nThis uses one ad credit and replaces all generated ads in this pack, not just this tile.",
    );

    if (!confirmed) return;

    const variant = pack.variants[index];
    const angle = variant ? (ANGLES.find((a) => a.id === variant.angle) ?? selectedAngle) : selectedAngle;
    void generateVariantsForAngle(angle);
  }

  async function handleGenerateFirstAd(input: FirstAdInput) {
    await generateFirstAd(input);
    setActiveTemplateKey(input.templateKey ?? input.templateId);
    setSelectedElement("image");
    studio.setSection("media");
    studio.setMobileTab("media");
  }

  function renderTextLayerPanel(field: "primaryText" | "headline" | "description" | "cta") {
    const label = field === "primaryText" ? "Primary text" : field === "cta" ? "CTA" : field[0].toUpperCase() + field.slice(1);
    const overLimit = copy[field].length > COPY_LIMITS[field];
    const actions = field === "cta" ? ["Sharper", "More direct"] : ["Sharper", "More local", "More premium", "Less hype"];
    return (
      <>
        <PanelHeader title="Text layer" detail="Edit the selected canvas text, or rewrite just this layer." />
        <label className="studio-selected-text-field">
          <span>
            {label}
            <small data-over={overLimit || undefined}>{copy[field].length} / {COPY_LIMITS[field]}</small>
          </span>
          <textarea
            rows={field === "primaryText" ? 4 : 3}
            value={copy[field]}
            onChange={(event) => updateCopy(field, event.target.value)}
          />
          {overLimit && <small className="studio-field-error">Over the Meta limit - shorten this.</small>}
        </label>
        <button
          className="studio-btn accent block"
          type="button"
          disabled={generating}
          onClick={() => void patchCopyField(field, patchActionForSelectedElement(selectedElement), copyContext, primaryImage)}
        >
          {generating ? "Rewriting..." : "Rewrite selected text"}
        </button>
        <div className="studio-assist-row" aria-label="Text rewrite options">
          {actions.map((action) => (
            <button key={action} type="button" disabled={generating} onClick={() => void patchCopyField(field, action, copyContext, primaryImage)}>
              {action}
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderMediaPanel() {
    return (
      <MediaPanel
        primaryImage={primaryImage}
        primaryImageName={primaryImageName}
        openFilePicker={openFilePicker}
        onUploadImage={handleUploadImage}
        onUploadRejected={studio.showToast}
        onSelectImage={selectMediaImage}
        mediaAssets={mediaAssets}
      />
    );
  }

  function renderTextPanel() {
    const textField = copyFieldForSelectedElement(selectedElement);
    if (textField) return renderTextLayerPanel(textField);
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

  function renderHomePanel() {
    const startingPointDone = Boolean(activeTemplateKey || pack.campaign.templateKey || pack.variants.length > 0);
    const mediaDone = Boolean(primaryImage);
    const publishReady = !brandIsDraft && readinessItems.every((item) => item.state === "done");
    const steps = [
      {
        title: brandIsDraft ? "Set your brand" : "Brand ready",
        detail: brandIsDraft ? "Confirm logo, colours and contact details before launch." : `${brand} is ready for ads.`,
        done: !brandIsDraft,
        action: "Settings",
        onClick: () => goToSection("settings"),
      },
      {
        title: "Choose a starting point",
        detail: startingPointDone ? "Your ad has a working layout." : "Use a template or start blank.",
        done: startingPointDone,
        action: "Templates",
        onClick: () => openTemplatePicker(),
      },
      {
        title: "Add and fit media",
        detail: mediaDone ? "A photo is attached. Auto fit is available in Media." : "Upload a property photo and fit every ad size.",
        done: mediaDone,
        action: "Media",
        onClick: () => goToSection("media"),
      },
      {
        title: "Launch",
        detail: publishReady ? "Ready to export or send for review." : "Check copy, media, brand and destination.",
        done: publishReady,
        action: "Publish",
        onClick: () => goToSection("publish"),
      },
    ];
    const completedSteps = steps.filter((step) => step.done).length;
    const tools = [
      {
        title: "Template library",
        detail: "Pick a proven starting layout, then change the media and text.",
        icon: LayoutGrid,
        action: "Browse",
        onClick: () => openTemplatePicker(),
      },
      {
        title: "Media and auto fit",
        detail: "Upload, replace, extend, and fit the property photo across all sizes.",
        icon: Sparkles,
        action: "Open",
        onClick: () => goToSection("media"),
      },
      {
        title: "Ad text",
        detail: "Click text on the canvas or rewrite selected copy.",
        icon: FileText,
        action: "Edit",
        onClick: () => goToSection("text"),
      },
      {
        title: "Launch",
        detail: "Review readiness, export creatives, and send the campaign forward.",
        icon: Send,
        action: "Review",
        onClick: () => goToSection("publish"),
      },
    ];

    return (
      <div className="studio-home-panel">
        <header className="studio-home-head">
          <div>
            <span>Ad Studio</span>
            <h1>Home</h1>
          </div>
          <button className="studio-home-create" type="button" onClick={() => openTemplatePicker()}>
            <Plus aria-hidden size={19} />
            Create new
          </button>
        </header>

        <section className="studio-home-hero" aria-labelledby="studio-home-start-title">
          <div className="studio-home-start">
            <h2 id="studio-home-start-title">
              Getting started <span>{completedSteps} / {steps.length} completed</span>
            </h2>
            <div className="studio-home-steps">
              {steps.map((step, index) => (
                <button key={step.title} type="button" onClick={step.onClick}>
                  <span className={step.done ? "done" : "todo"}>
                    {step.done ? <Check aria-hidden size={14} /> : index + 1}
                  </span>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                  <em>{step.action}</em>
                </button>
              ))}
            </div>
          </div>

          <aside className="studio-home-preview" aria-label="Current ad">
            <div className="studio-home-preview-media">
              {primaryImage ? <img src={primaryImage} alt="" /> : <span>{initials}</span>}
            </div>
            <strong>{campaignName}</strong>
            <small>{format.label} editor is ready for image and text changes.</small>
            <button type="button" onClick={() => primaryImage ? goToSection("media") : openTemplatePicker()}>
              Continue editing
              <ArrowRight aria-hidden size={16} />
            </button>
          </aside>
        </section>

        <section className="studio-home-tools" aria-labelledby="studio-home-tools-title">
          <h2 id="studio-home-tools-title">Tools</h2>
          <div>
            {tools.map((tool) => {
              const Icon = tool.icon;
              return (
                <button key={tool.title} type="button" onClick={tool.onClick}>
                  <span><Icon aria-hidden size={20} /></span>
                  <strong>{tool.title}</strong>
                  <small>{tool.detail}</small>
                  <em>{tool.action} <ArrowRight aria-hidden size={14} /></em>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderPanel() {
    if (studio.section === "media") return renderMediaPanel();
    if (studio.section === "text") return renderTextPanel();
    if (studio.section === "publish") {
      // M1: wire real props; H9: pass deleteCampaign
      return (
        <PublishSetupPanel
          campaignId={pack.campaign.campaignId}
          campaignPack={pack}
          destinationUrl={destinationUrl}
          onExport={exportCreatives}
          onDelete={deleteCampaign}
          brandApproved={!brandIsDraft}
          exportStatus={exportStatus}
          onRetryExportFormat={(format) => void retryExportFormat(format)}
        />
      );
    }
    if (studio.section === "settings") {
      return (
        <>
          <BrandPanel brand={brand} brandKit={brandKit} />
          <SettingsPanel />
        </>
      );
    }
    return (
      <div className="studio-empty">
        <div className="studio-empty-ic"><Home aria-hidden size={22} /></div>
        <strong>Choose where to work</strong>
        <p>Open Templates, Media, Text, Publish or Settings from the left rail.</p>
      </div>
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
        <aside className="studio-rail" aria-label="Ad Studio sections">
          <span className="studio-rail-label">Create ad</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            let railState: "done" | "warn" | "todo" | null = null;
            if (item.id === "settings") {
              railState = brandKit.reviewStatus === "approved" ? "done" : "warn";
            } else if (item.id === "publish") {
              const allDone = readinessItems.every((ri) => ri.state === "done");
              railState = allDone ? "done" : readinessItems.some((ri) => ri.state === "warn") ? "warn" : "todo";
            } else if (item.id === "media") {
              const relevant = readinessItems.filter((ri) => ri.label === "Primary media");
              if (relevant.length > 0) railState = relevant.every((ri) => ri.state === "done") ? "done" : "warn";
            } else if (item.id === "text") {
              const labels = ["Ad copy", "Call to action"];
              const relevant = readinessItems.filter((ri) => labels.includes(ri.label));
              if (relevant.length > 0) {
                if (relevant.every((ri) => ri.state === "done")) railState = "done";
                else if (relevant.some((ri) => ri.state === "warn")) railState = "warn";
                else railState = "todo";
              }
            }

            return (
              <button
                className={item.id === "templates" ? templatePickerOpen ? "active" : "" : studio.section === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === "templates") {
                    openTemplatePicker();
                    return;
                  }
                  goToSection(item.id);
                }}
              >
                <Icon aria-hidden size={18} />
                <span>{item.label}</span>
                {railState === "done" && <Check aria-hidden size={13} style={{ color: "#006d38", marginLeft: "auto", flexShrink: 0 }} />}
                {railState === "warn" && <CircleAlert aria-hidden size={13} style={{ color: "#8a5a00", marginLeft: "auto", flexShrink: 0 }} />}
                {railState === "todo" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#dfe6f0", marginLeft: "auto", flexShrink: 0 }} />}
              </button>
            );
          })}
        </aside>

        {studio.section === "home" ? (
          <section className="studio-home-shell" aria-label="Ad Studio home">
            {brandIsDraft && (
              <Link href="/ad-studio/brand" className="studio-draft-brand-chip">
                <CircleAlert aria-hidden size={15} />
                <span><b>Draft brand in use.</b> You can create ads now - confirm your brand before publishing.</span>
              </Link>
            )}
            {renderHomePanel()}
          </section>
        ) : (
          <>
            <section className="studio-left-panel" aria-label={`${studio.section} setup`}>
              {brandIsDraft && (
                <Link href="/ad-studio/brand" className="studio-draft-brand-chip">
                  <CircleAlert aria-hidden size={15} />
                  <span><b>Draft brand in use.</b> You can create ads now - confirm your brand before publishing.</span>
                </Link>
              )}
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
                    zoom={zoom}
                    selectedElement={selectedElement}
                    setSelectedElement={(element) => {
                      setSelectedElement(element);
                      const nextSection = element === "image" ? "media" : copyFieldForSelectedElement(element) ? "text" : null;
                      if (nextSection) studio.setSection(nextSection);
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
                onAdd={() => {
                  openTemplatePicker();
                }}
                pending={generation}
                onRetryPending={() => {
                  setGeneration(null);
                  addVariant();
                }}
                onDismissPending={() => setGeneration(null)}
                onEditCopy={(index) => {
                  selectVariant(index);
                  setSelectedElement("headline");
                  studio.setSection("text");
                }}
                onReplaceImage={(index) => {
                  selectVariant(index);
                  setSelectedElement("image");
                  studio.setSection("media");
                  openFilePicker();
                }}
                onRegenerate={regenerateVariantPack}
              />
            </section>
          </>
        )}
      </div>

      <div className="studio-mobile-body">
        {brandIsDraft && (
          <Link href="/ad-studio/brand" className="studio-draft-brand-chip" style={{ marginTop: 14 }}>
            <CircleAlert aria-hidden size={15} />
            <span><b>Draft brand in use.</b> Confirm your brand before publishing.</span>
          </Link>
        )}

        {(studio.mobileTab === "media" || studio.mobileTab === "text") && (
          <div className="studio-mobile-format-tabs">
            {(["story", "feed", "square"] as PreviewFormat[]).map((item) => (
              <button className={previewFormat === item ? "active" : ""} key={item} type="button" onClick={() => setPreviewFormat(item)}>
                {FORMAT_META[item].label}
              </button>
            ))}
          </div>
        )}

        {studio.mobileTab === "home" && (
          <div className="studio-mobile-panel">{renderHomePanel()}</div>
        )}

        {(studio.mobileTab === "media" || studio.mobileTab === "text") && (
          <>
            <div className="studio-mobile-preview-wrap">
              <AdPreview
                brand={brand}
                domain={domain}
                initials={initials}
                copy={copy}
                image={primaryImage}
                format={previewFormat}
                zoom={100}
                selectedElement={selectedElement}
                setSelectedElement={(element) => {
                  setSelectedElement(element);
                  const nextSection = element === "image" ? "media" : copyFieldForSelectedElement(element) ? "text" : null;
                  if (nextSection) {
                    studio.setSection(nextSection);
                    studio.setMobileTab(nextSection);
                  }
                }}
              />
            </div>
            <div className="studio-mobile-panel">{renderPanel()}</div>
          </>
        )}

        {studio.mobileTab === "publish" && (
          <div className="studio-mobile-panel">
            <PublishSetupPanel
              campaignId={pack.campaign.campaignId}
              campaignPack={pack}
              destinationUrl={destinationUrl}
              onExport={exportCreatives}
              onDelete={deleteCampaign}
              brandApproved={!brandIsDraft}
              exportStatus={exportStatus}
              onRetryExportFormat={(format) => void retryExportFormat(format)}
            />
          </div>
        )}

        {studio.mobileTab === "settings" && (
          <div className="studio-mobile-panel">
            <BrandPanel brand={brand} brandKit={brandKit} />
            <SettingsPanel />
          </div>
        )}

        {(studio.mobileTab === "media" || studio.mobileTab === "text" || studio.mobileTab === "publish") && (
          <div className="studio-mobile-variants">
            <VariantStrip
              variants={variants}
              selectedVariantIndex={selectedVariantIndex}
              onSelect={selectVariant}
              pending={generation}
              onRetryPending={() => {
                setGeneration(null);
                addVariant();
              }}
              onDismissPending={() => setGeneration(null)}
              compact
            />
          </div>
        )}
      </div>

      {studio.busy && (
        <div className="studio-mobile-busy">
          <RefreshCw aria-hidden size={20} />
          <strong>{studio.busyMessage}</strong>
        </div>
      )}

      {generation && !generation.error && (
        <div className="studio-mobile-busy">
          <RefreshCw aria-hidden size={20} />
          <strong>{generation.phase}</strong>
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
            <button
              className={item.id === "templates" ? templatePickerOpen ? "active" : "" : studio.mobileTab === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "templates") {
                  openTemplatePicker();
                  return;
                }
                setSelectedElement("canvas");
                studio.setSection(item.id);
                studio.setMobileTab(item.id);
              }}
            >
              <Icon aria-hidden size={22} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <NewAdDialog
        open={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        brandKit={brandKit}
        workspaceId={workspaceId}
        templates={adTemplates}
        onGenerate={handleGenerateFirstAd}
        initialStep={templatePickerInitialStep}
      />

      {brandPromptOpen && (
        <div
          className="studio-brand-prompt-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="studio-brand-prompt-title"
        >
          <section className="studio-brand-prompt">
            <button type="button" aria-label="Close brand prompt" onClick={skipBrandPrompt}>
              <X aria-hidden size={18} />
            </button>
            <Settings2 aria-hidden size={22} />
            <h2 id="studio-brand-prompt-title">Set your brand before launch?</h2>
            <p>
              Add logo, colours and contact details now, or skip and keep building. Publishing stays blocked until the brand is confirmed.
            </p>
            <div>
              <Link className="studio-btn accent" href="/ad-studio/brand">Set brand</Link>
              <button className="studio-btn secondary" type="button" onClick={skipBrandPrompt}>Skip for now</button>
            </div>
          </section>
        </div>
      )}

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}

      {confirmDeleteOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 24 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
        >
          <div style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: "28px 32px", maxWidth: 420, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <h2 id="confirm-delete-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Delete campaign?</h2>
            <p style={{ margin: "0 0 24px", color: "var(--text-2, #666)" }}>Are you sure? This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="button secondary" type="button" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
              <button className="button" type="button" onClick={confirmDeleteCampaign} style={{ background: "var(--destructive, #dc2626)", color: "#fff", borderColor: "transparent" }}>Delete campaign</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
