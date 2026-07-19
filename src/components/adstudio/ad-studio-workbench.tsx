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
  Palette,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioOfferTemplate,
  AdStudioTemplate,
  FirstAdInput,
} from "@/lib/adstudio";
import { builtInAdStudioTemplates } from "@/lib/adstudio";
import { cloneQaWarnings } from "@/lib/adstudio/clone-qa-warnings.ts";

import { requestCreativeEdit } from "./canvas/creative-edit-client";
import { FORMAT_META, MetaChromePreview, PreviewControls, VariantStrip } from "./preview";
import type { PreviewFormat, SelectedElement } from "./preview";
import { STYLES } from "./styles";
import { initialOfferLabelForPack, labelForSelectedTemplate } from "./template-offer-state";
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

type NavItem = { id: import("./use-ad-studio").StudioSection | "samples"; label: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "samples", label: "Templates", icon: LayoutGrid },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "text", label: "Text", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
  { id: "brand", label: "Brand Pack", icon: Palette },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const MOBILE_NAV: Array<{ id: import("./use-ad-studio").MobileTab | "samples"; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "samples", label: "Create", icon: Plus },
  { id: "media", label: "Media", icon: ImageIcon },
  { id: "text", label: "Text", icon: FileText },
  { id: "publish", label: "Review", icon: Send },
];

const PREVIEW_TO_AD_FORMAT: Record<PreviewFormat, AdStudioFormat> = {
  story: "9:16",
  feed: "4:5",
};

const MOBILE_WORKBENCH_QUERY = "(max-width: 900px)";

function PreviewFit({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!enabled) return;
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) return;

    const fit = () => {
      const contentWidth = content.offsetWidth;
      const contentHeight = content.offsetHeight;
      if (!contentWidth || !contentHeight) return;

      const nextScale = Math.min(1, frame.clientWidth / contentWidth, frame.clientHeight / contentHeight);
      setScale((current) => Math.abs(current - nextScale) < 0.001 ? current : nextScale);
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    observer.observe(content);
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  return (
    <div ref={frameRef} className="studio-preview-fit">
      <div
        ref={contentRef}
        className="studio-preview-fit-content"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

const InPlaceAdEditor = dynamic(
  () => import("./canvas/in-place-ad-editor").then((mod) => mod.InPlaceAdEditor),
  { ssr: false, loading: () => <div className="studio-editor-loading">Loading editor...</div> },
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
  return initialOfferLabelForPack(pack, offers);
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

/** A reference-clone creative: a single flat image with copy baked into pixels. */
function isCloneCreative(creative: AdStudioCreative): boolean {
  return (
    creative.canvas.objects.length === 1 &&
    creative.canvas.objects[0]?.objectId === "template_clone_image"
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

function creativeLibraryPreview(creative: AdStudioCreative): string | null {
  if (isCloneCreative(creative)) return primaryImageFromCreative(creative)?.src ?? null;
  if (!creative.previewSvg) return null;
  return creative.previewSvg.startsWith("data:image/")
    ? creative.previewSvg
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(creative.previewSvg)}`;
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
    creatives: input.pack.creatives,
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
  const [pack, setPack] = useState(initialPack);
  const searchParams = useSearchParams();
  const visibleBuiltInTemplates = useMemo(() => builtInAdStudioTemplates(), []);
  const [activeSampleId, setActiveSampleId] = useState<string | undefined>(undefined);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("feed");
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("canvas");
  const [campaignGoal, setCampaignGoal] = useState(() => initialCampaignGoal(initialPack));
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabel(initialPack, offers));
  const [market, setMarket] = useState(() => initialMarket(initialPack));
  const [propertyType, setPropertyType] = useState("Houses");
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestinationUrl(initialPack, brandKit));

  // Campaign defaults are editable (Settings/Publish panels) and autosave like copy.
  function updateMarket(value: string) {
    setMarket(value);
    studio.setSaveState("saving");
  }
  function updatePropertyType(value: string) {
    setPropertyType(value);
    studio.setSaveState("saving");
  }
  function updateDestinationUrl(value: string) {
    setDestinationUrl(value);
    studio.setSaveState("saving");
  }
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<Array<{ src: string; label: string; type: string; ratio: string }>>([]);
  const [pendingMediaReplacement, setPendingMediaReplacement] = useState<{ src: string; label: string } | null>(null);
  const [replacingMedia, setReplacingMedia] = useState(false);
  const [samplePickerOpen, setSamplePickerOpen] = useState(false);
  const [samplePickerInitialId, setSamplePickerInitialId] = useState<string | undefined>(undefined);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [brandPromptOpen, setBrandPromptOpen] = useState(false);
  const [dismissedCloneWarningKeys, setDismissedCloneWarningKeys] = useState<Set<string>>(() => new Set());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((options?: { silent?: boolean }) => Promise<boolean>) | null>(null);
  const flushDraftBeaconRef = useRef<(() => boolean) | null>(null);
  const saveStateRef = useRef<"saved" | "saving" | "error">("saved");
  const linkedSamplePromptedRef = useRef(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const studio = useAdStudio();
  const { brand, initials } = useBrandKit(brandKit);
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
  const adTemplates = visibleBuiltInTemplates;

  useEffect(() => {
    const query = window.matchMedia(MOBILE_WORKBENCH_QUERY);
    const syncViewport = () => setIsMobileViewport(query.matches);
    syncViewport();
    query.addEventListener("change", syncViewport);
    return () => query.removeEventListener("change", syncViewport);
  }, []);

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

  async function handleUploadImage(file: File | null | undefined) {
    let uploaded: { src: string; label: string } | undefined;
    try {
      uploaded = await replaceImage(file, { commit: false });
    } catch {
      return; // replaceImage already surfaced the failure to the user
    }
    if (!uploaded) return;
    setPendingMediaReplacement(uploaded);
    setSelectedElement("image");
    studio.setSection("media");
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
  // The Media tab shows the customer's own assets (uploads + workspace/brand-kit
  // images); demo imagery only on the sample workspace. Keep this collection
  // referentially stable so unrelated workbench progress updates cannot reset
  // consumers such as the in-progress New Ad form.
  const mediaAssets = useMemo(
    () =>
      dedupeAssetsBySrc([
        ...uploadedAssets,
        ...(workspaceMediaAssets.length > 0 ? workspaceMediaAssets : isSample ? MEDIA_ASSETS : []),
      ]),
    [isSample, uploadedAssets, workspaceMediaAssets],
  );

  const generatedAds = useMemo(
    () =>
      pack.creatives.flatMap((creative) => {
        const src = creativeLibraryPreview(creative);
        if (!src) return [];
        const variantIndex = pack.variants.findIndex((variant) => variant.variantId === creative.variantId);
        return [{
          creativeId: creative.creativeId,
          src,
          label: variantIndex >= 0 ? `Ad ${variantIndex + 1}` : "Generated ad",
          formatLabel: creative.format === "9:16" ? "Story" : "Feed",
        }];
      }),
    [pack.creatives, pack.variants],
  );

  function selectMediaImage(src: string) {
    const asset = mediaAssets.find((item) => item.src === src);
    if (!asset || src === primaryImage) {
      setPendingMediaReplacement(null);
      return;
    }
    setPendingMediaReplacement({ src, label: asset.label });
    setSelectedElement("image");
    studio.setSection("media");
  }

  function selectGeneratedAd(creativeId: string) {
    const creative = pack.creatives.find((item) => item.creativeId === creativeId);
    if (!creative) return;
    const variantIndex = pack.variants.findIndex((variant) => variant.variantId === creative.variantId);
    if (variantIndex >= 0) selectVariant(variantIndex);
    setPreviewFormat(creative.format === "9:16" ? "story" : "feed");
    const image = primaryImageFromCreative(creative);
    if (image) {
      setPrimaryImage(image.src);
      setPrimaryImageName(image.label);
    }
    setSelectedElement("canvas");
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

  function openSamplePicker(initialSampleId?: string) {
    setSelectedElement("canvas");
    setSamplePickerInitialId(initialSampleId);
    setSamplePickerOpen(true);
  }

  // API routes used in campaign actions:
  //   POST /api/adstudio/campaigns - Create from the selected template
  //   PATCH /api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft - save draft
  //   POST /api/adstudio/export-packages/${currentPack.campaign.campaignId}/download - Export creatives
  //   platforms: ["meta"]
  // Campaign readiness checklist lives in the publish panel.
  const { generateFirstAd, saveDraft, flushDraftBeacon, exportCreatives, retryExportFormat, exportStatus } = useCampaignActions({
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
    showToast: studio.showToast,
  });

  useEffect(() => {
    saveDraftRef.current = saveDraft;
    flushDraftBeaconRef.current = flushDraftBeacon;
    saveStateRef.current = studio.saveState;
  }, [saveDraft, flushDraftBeacon, studio.saveState]);

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
    // sendBeacon survives page teardown; async fetch from beforeunload does not.
    function flushPendingDraft() {
      if (saveStateRef.current !== "saving") return;
      if (flushDraftBeaconRef.current?.()) return;
      void saveDraftRef.current?.({ silent: true });
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

  useEffect(() => {
    const templateKey = searchParams.get("template");
    if (!templateKey || linkedSamplePromptedRef.current) return;

    const linkedTemplate = adTemplates.find((template) => template.id === templateKey);
    if (!linkedTemplate) return;

    linkedSamplePromptedRef.current = true;
    openSamplePicker(linkedTemplate.id);
  }, [adTemplates, searchParams]);

  useEffect(() => {
    if (!searchParams.get("newAd") || linkedSamplePromptedRef.current) return;
    linkedSamplePromptedRef.current = true;
    openSamplePicker();
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
  const cloneWarningKey = currentCreative?.canvas.cloneQa
    ? `${currentCreative.creativeId}:${currentCreative.canvas.cloneQa.checkedAt}`
    : "";
  const cloneWarnings = useMemo(
    () => cloneQaWarnings(currentCreative?.canvas.cloneQa),
    [currentCreative?.canvas.cloneQa],
  );
  const showCloneWarnings = cloneWarningKey.length > 0 && cloneWarnings.length > 0 && !dismissedCloneWarningKeys.has(cloneWarningKey);

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
      // Use the cloned ad's own angle field as its label.
        angleLabel: variant.angle || "Cloned sample",
        image: variantImage?.src ?? (isSample && MEDIA_ASSETS.some((item) => item.src === primaryImage) ? MEDIA_ASSETS[index % MEDIA_ASSETS.length].src : primaryImage),
      };
    });
  }, [getVariantPrimaryImage, initialPack.variants, pack.variants, primaryImage, selectedVariantIndex]);

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

  // Keep editor identity stable so in-progress edits survive surrounding renders.
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

  // The finished ad shows the moment its renders persist; the advisory QA pass
  // (editor regions + copy warnings) attaches to the persisted creatives a few
  // seconds later. Poll the campaign until the verdicts land, merging ONLY the
  // missing cloneQa so concurrent local state is never clobbered.
  const editorPreparing = pack.creatives.some(
    (creative) => isCloneCreative(creative) && !creative.canvas.cloneQa,
  );
  const editorPreparingCampaignId = editorPreparing ? pack.campaign.campaignId : null;
  useEffect(() => {
    if (!editorPreparingCampaignId) return;
    let cancelled = false;
    let attempts = 0;
    let timer = 0;

    const poll = async () => {
      if (cancelled || attempts >= 40) return;
      attempts += 1;
      try {
        const response = await fetch(
          `/api/adstudio/campaigns/${encodeURIComponent(editorPreparingCampaignId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => null)) as
          | { campaignPack?: AdStudioCampaignPack | null }
          | null;
        const freshCreatives = payload?.campaignPack?.creatives ?? [];
        const qaByCreative = new Map(
          freshCreatives.flatMap((creative) =>
            creative.canvas.cloneQa ? [[creative.creativeId, creative.canvas.cloneQa] as const] : [],
          ),
        );
        if (!cancelled && qaByCreative.size > 0) {
          setPack((current) => ({
            ...current,
            creatives: current.creatives.map((creative) => {
              const qa = qaByCreative.get(creative.creativeId);
              return qa && !creative.canvas.cloneQa
                ? { ...creative, canvas: { ...creative.canvas, cloneQa: qa } }
                : creative;
            }),
          }));
        }
      } catch {
        // Transient poll failure - the next tick retries.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 3000);
    };

    timer = window.setTimeout(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [editorPreparingCampaignId]);

  async function confirmMediaReplacement() {
    if (!pendingMediaReplacement) return;
    if (!currentCreative || !isCloneCreative(currentCreative)) {
      studio.showToast("Generate an ad before replacing its image.");
      return;
    }
    const imageRegion = currentCreative.canvas.cloneQa?.regions.find((region) => region.kind === "image");
    if (!imageRegion) {
      studio.showToast("This ad does not have an editable image region.");
      return;
    }

    setReplacingMedia(true);
    studio.setBusy(true);
    studio.setBusyMessage("Generating a new ad with your image");
    try {
      const nextCreative = await requestCreativeEdit({
        creative: currentCreative,
        mutation: { fieldKey: imageRegion.key, newImage: pendingMediaReplacement.src },
        mutationId: crypto.randomUUID(),
      });
      updateCreative(nextCreative);
      setPrimaryImage(pendingMediaReplacement.src);
      setPrimaryImageName(pendingMediaReplacement.label);
      setPendingMediaReplacement(null);
      studio.showToast("New ad generated");
    } catch (error) {
      studio.showToast(error instanceof Error ? error.message : "The new ad could not be generated. Try again.");
    } finally {
      setReplacingMedia(false);
      studio.setBusy(false);
    }
  }

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

  async function handleGenerateFirstAd(input: FirstAdInput) {
    await generateFirstAd(input);
    setActiveSampleId(input.templateId);
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
        onUploadImage={handleUploadImage}
        onUploadRejected={studio.showToast}
        onSelectImage={selectMediaImage}
        selectedImageSrc={pendingMediaReplacement?.src}
        replacing={replacingMedia}
        onClearSelection={() => setPendingMediaReplacement(null)}
        onConfirmReplace={confirmMediaReplacement}
        mediaAssets={mediaAssets}
        generatedAds={generatedAds}
        activeGeneratedAdId={currentCreative?.creativeId}
        onSelectGeneratedAd={selectGeneratedAd}
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
        cloneCreative={currentCreative ? isCloneCreative(currentCreative) : false}
      />
    );
  }

  function renderEmptyPreview() {
    return (
      <div className="studio-empty">
        <div className="studio-empty-ic"><LayoutGrid aria-hidden size={22} /></div>
        <strong>No ad created yet</strong>
        <p>Choose a template, add its requested images and text, then clone it.</p>
        <button className="studio-btn accent" type="button" onClick={() => openSamplePicker()}>
          Choose a template
        </button>
      </div>
    );
  }

  function renderCreativeEditor() {
    if (!currentCreative) return renderEmptyPreview();

    // AI-designed clone: one flat image with the copy baked into the pixels.
    // The layer editor would silently no-op on it, so edit in place instead —
    // hit-targets from the QA regions drive the targeted edit endpoint.
    // The editor sits inside real Meta chrome (page header, live primary
    // text above the creative, headline/description strip, real CTA enum label)
    // so the stage shows the ad exactly as Meta renders it.
    if (isCloneCreative(currentCreative)) {
      return (
        <div className="studio-clone-editor-wrap">
          <PreviewFit enabled={!isMobileViewport}>
            <MetaChromePreview
              brandKit={brandKit}
              destinationUrl={destinationUrl}
              copy={copy}
              format={previewFormat}
              onSelectText={() => goToSection("text")}
            >
              <InPlaceAdEditor
                creative={currentCreative}
                onCreativeChange={updateCreative}
                showToast={studio.showToast}
                preparing={editorPreparing}
              />
            </MetaChromePreview>
          </PreviewFit>
          {currentCreative.canvas.cloneQa?.regions.length ? (
            <p className="studio-metachrome-edit-hint">Select text or an image on the ad, or open Edit elements.</p>
          ) : editorPreparing ? (
            <p className="studio-metachrome-edit-hint">Your ad is ready to preview - editing unlocks in a moment.</p>
          ) : null}
          {showCloneWarnings && (
            <div className="studio-clone-warning-strip" role="status" aria-live="polite">
              <CircleAlert aria-hidden size={16} />
              <div>
                {cloneWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <button
                type="button"
                aria-label="Dismiss text warnings"
                onClick={() => {
                  if (!cloneWarningKey) return;
                  setDismissedCloneWarningKeys((current) => {
                    const next = new Set(current);
                    next.add(cloneWarningKey);
                    return next;
                  });
                }}
              >
                <X aria-hidden size={14} />
              </button>
            </div>
          )}
        </div>
      );
    }

    return renderEmptyPreview();
  }

  function renderHomePanel() {
    const startingPointDone = Boolean(activeSampleId || pack.campaign.templateKey || pack.variants.length > 0);
    const mediaDone = Boolean(primaryImage);
    const copyItems = readinessItems.filter((item) => ["Ad copy", "Call to action"].includes(item.label));
    const copyDone = copyItems.length > 0 && copyItems.every((item) => item.state === "done");
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
        detail: startingPointDone ? "Your ad is ready." : "Choose the template you want to use.",
        done: startingPointDone,
        action: "Templates",
        onClick: () => openSamplePicker(),
      },
      {
        title: "Add media",
        detail: mediaDone ? "A photo is attached." : "Choose a template, then add every requested image.",
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
    const mobileSteps = [
      {
        title: "Choose a template",
        detail: startingPointDone ? "Your starting design is ready." : "Pick the ad you want to make your own.",
        action: startingPointDone ? "Change template" : "Choose template",
        done: startingPointDone,
        onClick: () => openSamplePicker(),
      },
      {
        title: "Add your media",
        detail: mediaDone ? "Your property image is attached." : "Add the property image requested by the template.",
        action: mediaDone ? "Change media" : "Add media",
        done: mediaDone,
        onClick: () => goToSection("media"),
      },
      {
        title: "Check the wording",
        detail: copyDone ? "Your headline and call to action are ready." : "Review the headline and call to action.",
        action: copyDone ? "Edit text" : "Check text",
        done: copyDone,
        onClick: () => goToSection("text"),
      },
      {
        title: "Review and publish",
        detail: publishReady ? "Your ad is ready to export." : "Resolve the final checks before launch.",
        action: "Review ad",
        done: publishReady,
        onClick: () => goToSection("publish"),
      },
    ];
    const completedMobileSteps = mobileSteps.filter((step) => step.done).length;
    const nextMobileStep = mobileSteps.find((step) => !step.done) ?? mobileSteps[mobileSteps.length - 1]!;
    const tools = [
      {
        title: "Template gallery",
        detail: "Choose the finished ad template to use with your own images and exact text.",
        icon: LayoutGrid,
        action: "Browse",
        onClick: () => openSamplePicker(),
      },
      {
        title: "Media",
        detail: "Upload, replace, and reuse approved property photos.",
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
        <section className="studio-mobile-home-focus" aria-labelledby="studio-mobile-home-title">
          <div className="studio-mobile-home-kicker">
            <span>Ad Studio</span>
            <span>{completedMobileSteps} of {mobileSteps.length} ready</span>
          </div>

          <div className="studio-mobile-home-hero">
            <div className="studio-mobile-home-media" aria-hidden={!primaryImage}>
              {primaryImage ? <img src={primaryImage} alt={`${campaignName} ad preview`} /> : <span>{initials}</span>}
            </div>
            <div className="studio-mobile-home-shade" />
            <div className="studio-mobile-home-copy">
              <p>{startingPointDone ? "Continue your ad" : "Start with one proven design"}</p>
              <h1 id="studio-mobile-home-title">{startingPointDone ? campaignName : "Create your first ad"}</h1>
              <span>{nextMobileStep.title}. {nextMobileStep.detail}</span>
              <button type="button" onClick={nextMobileStep.onClick}>
                {nextMobileStep.action}
                <ArrowRight aria-hidden size={18} />
              </button>
            </div>
          </div>

          {brandIsDraft && (
            <Link href="/ad-studio/brand" className="studio-mobile-brand-note">
              <CircleAlert aria-hidden size={17} />
              <span><b>Confirm your brand before publishing.</b> You can keep creating now.</span>
              <ArrowRight aria-hidden size={16} />
            </Link>
          )}

          <details className="studio-mobile-home-progress">
            <summary>
              <span>View all steps</span>
              <span>{completedMobileSteps}/{mobileSteps.length}</span>
            </summary>
            <div>
              {mobileSteps.map((step) => (
                <button key={step.title} type="button" onClick={step.onClick}>
                  <span className={step.done ? "done" : "todo"}>
                    {step.done ? <Check aria-hidden size={14} /> : <ArrowRight aria-hidden size={14} />}
                  </span>
                  <span>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </details>
        </section>

        <header className="studio-home-head">
          <div>
            <span>Ad Studio</span>
            <h1>Home</h1>
          </div>
          <button className="studio-home-create" type="button" onClick={() => openSamplePicker()}>
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
            <button type="button" onClick={() => primaryImage ? goToSection("media") : openSamplePicker()}>
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
          onChangeDestinationUrl={updateDestinationUrl}
          onExport={exportCreatives}
          onDelete={deleteCampaign}
          brandApproved={!brandIsDraft}
          exportStatus={exportStatus}
          onRetryExportFormat={(format) => void retryExportFormat(format)}
        />
      );
    }
    if (studio.section === "brand") {
      return <BrandPanel brand={brand} brandKit={brandKit} />;
    }
    if (studio.section === "settings") {
      return (
        <SettingsPanel
          market={market}
          propertyType={propertyType}
          onChangeMarket={updateMarket}
          onChangePropertyType={updatePropertyType}
        />
      );
    }
    return (
      <div className="studio-empty">
        <div className="studio-empty-ic"><Home aria-hidden size={22} /></div>
        <strong>Choose where to work</strong>
        <p>Open Templates, Media, Text, Publish, Brand Pack or Settings from the left rail.</p>
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
            if (item.id === "brand") {
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
                className={item.id === "samples" ? samplePickerOpen ? "active" : "" : studio.section === item.id ? "active" : ""}
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === "samples") {
                    openSamplePicker();
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
                {!isMobileViewport ? renderCreativeEditor() : null}
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
                  openSamplePicker();
                }}
                pending={generation}
                onRetryPending={() => {
                  setGeneration(null);
                  openSamplePicker();
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
              />
            </section>
          </>
        )}
      </div>

      <div className="studio-mobile-body">
        {brandIsDraft && studio.mobileTab !== "home" && (
          <Link href="/ad-studio/brand" className="studio-draft-brand-chip" style={{ marginTop: 14 }}>
            <CircleAlert aria-hidden size={15} />
            <span><b>Draft brand in use.</b> Confirm your brand before publishing.</span>
          </Link>
        )}

        {(studio.mobileTab === "media" || studio.mobileTab === "text") && (
          <div className="studio-mobile-format-tabs">
            {(["story", "feed"] as PreviewFormat[]).map((item) => (
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
              {renderCreativeEditor()}
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
              onChangeDestinationUrl={updateDestinationUrl}
              onExport={exportCreatives}
              onDelete={deleteCampaign}
              brandApproved={!brandIsDraft}
              exportStatus={exportStatus}
              onRetryExportFormat={(format) => void retryExportFormat(format)}
            />
          </div>
        )}

        {studio.mobileTab === "brand" && (
          <div className="studio-mobile-panel">
            <BrandPanel brand={brand} brandKit={brandKit} />
          </div>
        )}

        {studio.mobileTab === "settings" && (
          <div className="studio-mobile-panel">
            <SettingsPanel
              market={market}
              propertyType={propertyType}
              onChangeMarket={updateMarket}
              onChangePropertyType={updatePropertyType}
            />
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
                openSamplePicker();
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

      {studio.saveState !== "saved" && (
        <div className="studio-mobile-status" data-state={studio.saveState} role="status" aria-live="polite">
          {studio.statusText}
        </div>
      )}

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
              className={item.id === "samples" ? samplePickerOpen ? "active" : "" : studio.mobileTab === item.id ? "active" : ""}
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "samples") {
                  openSamplePicker();
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
        open={samplePickerOpen}
        onClose={() => {
          setSamplePickerOpen(false);
          setSamplePickerInitialId(undefined);
        }}
        brandKit={brandKit}
        workspaceId={workspaceId}
        templates={adTemplates}
        mediaAssets={mediaAssets}
        onGenerate={handleGenerateFirstAd}
        initialTemplateId={samplePickerInitialId}
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
