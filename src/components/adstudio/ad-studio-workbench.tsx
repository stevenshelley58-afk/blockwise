"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  Home,
  Images,
  LayoutGrid,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  SwatchBook,
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
  AdStudioTargetLocation,
  AdStudioTemplate,
  FirstAdInput,
} from "@/lib/adstudio";
import type { AdStudioMediaLibraryAsset } from "@/lib/adstudio/assets";
import { builtInAdStudioTemplates } from "@/lib/adstudio";
import { isCloneCreative, primaryImageSource } from "@/lib/adstudio/creative-preview";
import type { LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

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

import { MediaPanel } from "./panels/media-panel";
import { PanelHeader } from "./inspector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

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
  initialMediaAssets?: AdStudioMediaLibraryAsset[];
  initialMediaCursor?: string | null;
};

type NavItem =
  | { id: import("./use-ad-studio").StudioSection | "samples"; label: string; icon: LucideIcon; href?: undefined }
  | { id: "library"; label: string; icon: LucideIcon; href: string };

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "samples", label: "Create", icon: Plus },
  { id: "library", label: "Library", icon: Images, href: "/ad-studio/library" },
  { id: "edit", label: "Edit", icon: FileText },
  { id: "publish", label: "Publish", icon: Send },
  { id: "brand", label: "Brand Pack", icon: SwatchBook },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const MOBILE_NAV_IDS = new Set<NavItem["id"]>(["home", "samples", "library", "edit", "publish"]);
const MOBILE_NAV = NAV_ITEMS.filter((item) => MOBILE_NAV_IDS.has(item.id));

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
const BrandPanel = dynamic(
  () => import("./panels/brand-panel").then((mod) => mod.BrandPanel),
  { ssr: false },
);
const PublishSetupPanel = dynamic(
  () => import("./panels/publish-panel").then((mod) => mod.PublishSetupPanel),
  { ssr: false },
);
const SettingsPanel = dynamic(
  () => import("./panels/settings-panel").then((mod) => mod.SettingsPanel),
  { ssr: false },
);
const NewAdDialog = dynamic(
  () => import("./new-ad-dialog").then((mod) => mod.NewAdDialog),
  { ssr: false },
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
  const src = primaryImageSource(creative);
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
  initialMediaAssets = [],
  initialMediaCursor = null,
}: AdStudioWorkbenchProps) {
  const [pack, setPack] = useState(initialPack);
  const canManageCampaign = pack.creatives.length > 0;
  const searchParams = useSearchParams();
  const openPublishOnLoad = searchParams.get("publish") === "1";
  const visibleBuiltInTemplates = useMemo(() => builtInAdStudioTemplates(), []);
  const [activeSampleId, setActiveSampleId] = useState<string | undefined>(undefined);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>("feed");
  const [selectedElement, setSelectedElement] = useState<SelectedElement>("canvas");
  const [selectedCanvasRegionKey, setSelectedCanvasRegionKey] = useState<string | null>(null);
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
  function updateCampaignTargeting(locations: AdStudioTargetLocation[], includeSurroundingSuburbs: boolean | undefined) {
    setPack((current) => ({
      ...current,
      campaign: {
        ...current.campaign,
        market: {
          ...current.campaign.market,
          targetSuburbs: locations,
          includeSurroundingSuburbs,
        },
      },
    }));
    studio.setSaveState("saving");
  }
  function updateLeadForm(leadForm: { headline: string; questions: string[]; thankYouScreen: { title: string; body: string } }) {
    setPack((current) => ({
      ...current,
      copyPacks: current.copyPacks.map((copy) => ({
        ...copy,
        meta: { ...copy.meta, leadForm: { ...copy.meta.leadForm, ...leadForm } },
      })),
    }));
    studio.setSaveState("saving");
  }
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [uploadedAssets, setUploadedAssets] = useState<
    Array<{ src: string; fullSrc: string; label: string; type: string; ratio: string }>
  >([]);
  const [loadedMediaAssets, setLoadedMediaAssets] = useState(initialMediaAssets);
  const [nextMediaCursor, setNextMediaCursor] = useState(initialMediaCursor);
  const [loadingMoreMedia, setLoadingMoreMedia] = useState(false);
  // `src` identifies the selected tile in the grid; `fullSrc` is what the
  // re-generation actually consumes (see LibraryAssetModel).
  const [pendingMediaReplacement, setPendingMediaReplacement] = useState<
    { src: string; fullSrc: string; label: string } | null
  >(null);
  const [replacingMedia, setReplacingMedia] = useState(false);
  const [samplePickerOpen, setSamplePickerOpen] = useState(false);
  const [samplePickerInitialId, setSamplePickerInitialId] = useState<string | undefined>(undefined);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [brandPromptOpen, setBrandPromptOpen] = useState(false);
  const [replaceSheetOpen, setReplaceSheetOpen] = useState(false);
  const [publishCreativeSource, setPublishCreativeSource] = useState<"current" | "library">("current");
  const [dismissedCloneWarningKeys, setDismissedCloneWarningKeys] = useState<Set<string>>(() => new Set());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((options?: { silent?: boolean }) => Promise<boolean>) | null>(null);
  const flushDraftBeaconRef = useRef<(() => boolean) | null>(null);
  const saveStateRef = useRef<"saved" | "saving" | "error">("saved");
  const linkedSamplePromptedRef = useRef(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  const studio = useAdStudio(openPublishOnLoad ? "publish" : "home");
  const { brand, initials } = useBrandKit(brandKit);
  // B2: an unapproved extracted kit can generate and edit, but is flagged as a
  // draft everywhere and keeps publish blocked until it is confirmed.
  const brandIsDraft = !isSample && brandKit.reviewStatus !== "approved";
  const {
    copy,
    setCopy,
    updateCopy,
    generating,
    patchCopyField,
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
      openMediaSheet();
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
            // An upload's src is already the durable media-proxy source.
            : [{ src: asset.src, fullSrc: asset.src, label: asset.label, type: "Uploaded", ratio: "Just now" }, ...prev],
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
    // A fresh upload is already the durable media-proxy source.
    setPendingMediaReplacement({ ...uploaded, fullSrc: uploaded.src });
    openMediaSheet();
  }

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
        ...loadedMediaAssets,
        ...(isSample ? MEDIA_ASSETS : []),
      ]),
    [isSample, loadedMediaAssets, uploadedAssets],
  );

  async function loadMoreMediaAssets() {
    if (!nextMediaCursor || loadingMoreMedia) return;
    setLoadingMoreMedia(true);
    try {
      const params = new URLSearchParams({
        wave: "library",
        kind: "assets",
        limit: "24",
        cursor: nextMediaCursor,
      });
      const response = await fetch(`/api/adstudio/bootstrap?${params}`, { cache: "no-store" });
      const page = (await response.json().catch(() => null)) as
        | { items?: LibraryAssetModel[]; nextCursor?: string | null; error?: string }
        | null;
      if (!response.ok) throw new Error(page?.error ?? "Could not load more images.");
      const nextAssets = (page?.items ?? []).map((asset) => ({ ...asset, ratio: "Image" as const }));
      setLoadedMediaAssets((current) => dedupeAssetsBySrc([...current, ...nextAssets]));
      setNextMediaCursor(page?.nextCursor ?? null);
    } catch (error) {
      studio.showToast(error instanceof Error ? error.message : "Could not load more images.");
    } finally {
      setLoadingMoreMedia(false);
    }
  }

  function selectMediaImage(src: string) {
    const asset = mediaAssets.find((item) => item.src === src);
    if (!asset || src === primaryImage || asset.fullSrc === primaryImage) {
      setPendingMediaReplacement(null);
      return;
    }
    setPendingMediaReplacement({ src, fullSrc: asset.fullSrc, label: asset.label });
    openMediaSheet();
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

  function openMediaSheet() {
    setSelectedElement("image");
    setReplaceSheetOpen(true);
  }

  function goToSection(section: import("./use-ad-studio").StudioSection) {
    if (section === "media") {
      openMediaSheet();
      return;
    }
    setSelectedElement("canvas");
    setSelectedCanvasRegionKey(null);
    if (section !== "publish") setPublishCreativeSource("current");
    studio.setSection(section);
    studio.setMobileTab(section as import("./use-ad-studio").MobileTab);
  }

  function openSamplePicker(initialSampleId?: string) {
    setSelectedElement("canvas");
    setPublishCreativeSource("library");
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
    setSelectedElement("canvas");
    setSelectedCanvasRegionKey(null);
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

  // The finished ad shows the moment its renders persist; region detection
  // (editor regions + text values) attaches a few seconds later. Realtime wakes
  // this client when the creative changes; merge ONLY missing cloneQa so
  // concurrent local edits are never clobbered.
  const editorPreparing = pack.creatives.some(
    (creative) => isCloneCreative(creative) && !creative.canvas.cloneQa,
  );
  const editorPreparingCampaignId = editorPreparing ? pack.campaign.campaignId : null;
  useEffect(() => {
    if (!editorPreparingCampaignId) return;
    const supabase = createSupabaseBrowserClient();
    const abortController = new AbortController();
    let cancelled = false;
    let refreshing = false;
    let refreshQueued = false;

    const refresh = async () => {
      if (cancelled) return;
      if (refreshing) {
        refreshQueued = true;
        return;
      }
      refreshing = true;
      try {
        const response = await fetch(
          `/api/adstudio/campaigns/${encodeURIComponent(editorPreparingCampaignId)}`,
          { cache: "no-store", signal: abortController.signal },
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
        // A later Realtime event or the low-frequency fallback can retry.
      } finally {
        refreshing = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void refresh();
        }
      }
    };

    const channel = supabase
      .channel(`adstudio-editor-${editorPreparingCampaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "adstudio_creatives",
          filter: `campaign_id=eq.${editorPreparingCampaignId}`,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const fallbackTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30_000);
    void refresh();

    return () => {
      cancelled = true;
      abortController.abort();
      window.clearInterval(fallbackTimer);
      void supabase.removeChannel(channel);
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
      const result = await requestCreativeEdit({
        creative: currentCreative,
        mutation: { fieldKey: imageRegion.key, newImage: pendingMediaReplacement.fullSrc },
        mutationId: crypto.randomUUID(),
      });
      updateCreative(result.creative);
      setPrimaryImage(pendingMediaReplacement.fullSrc);
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
      openMediaSheet();
      openFilePicker();
      return;
    }
    const field = copyFieldForSelectedElement(selectedElement);
    if (!field) return;
    await patchCopyField(field, patchActionForSelectedElement(selectedElement), copyContext, primaryImage);
  }

  async function handleGenerateFirstAd(input: FirstAdInput) {
    await generateFirstAd(input);
    setPublishCreativeSource("current");
    setActiveSampleId(input.templateId);
    setSelectedElement("canvas");
    setSelectedCanvasRegionKey(null);
    studio.setSection("edit");
    studio.setMobileTab("edit");
  }

  function renderTextLayerPanel(field: "primaryText" | "headline" | "description" | "cta") {
    const label = field === "primaryText" ? "Primary text" : field === "cta" ? "CTA" : field[0].toUpperCase() + field.slice(1);
    const overLimit = copy[field].length > COPY_LIMITS[field];
    const actions = field === "cta" ? ["Sharper", "More direct"] : ["Sharper", "More local", "More premium", "Less hype"];
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={() => setSelectedElement("canvas")}
        >
          <ArrowLeft aria-hidden />
          All editable areas
        </Button>
        <PanelHeader title={label} detail="Edit this part of the Meta ad copy. Your finished ad updates as you type." />
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
        hasMoreAssets={Boolean(nextMediaCursor)}
        loadingMoreAssets={loadingMoreMedia}
        onLoadMoreAssets={loadMoreMediaAssets}
      />
    );
  }

  function selectMetaCopyField(field: "primaryText" | "headline" | "description" | "cta") {
    setSelectedCanvasRegionKey(null);
    setSelectedElement(field);
    studio.setSection("edit");
    studio.setMobileTab("edit");
  }

  function selectCanvasRegion(key: string) {
    setSelectedElement("canvas");
    setSelectedCanvasRegionKey(key);
  }

  function renderEditOverview() {
    const editableRegions = currentCreative?.canvas.cloneQa?.regions ?? [];
    const textRegions = editableRegions.filter((region) => region.kind === "text");
    const imageRegions = editableRegions.filter((region) => region.kind === "image");
    const copyItems = [
      { field: "primaryText" as const, label: "Primary text", value: copy.primaryText },
      { field: "headline" as const, label: "Headline", value: copy.headline },
      { field: "description" as const, label: "Description", value: copy.description },
      { field: "cta" as const, label: "Call to action", value: copy.cta },
    ];

    return (
      <div className="grid gap-6">
        <PanelHeader title="Edit" detail="Select anything on the finished ad, or choose an editable area below." />

        <section className="grid gap-2" aria-labelledby="studio-on-ad-heading">
          <div className="flex items-center justify-between gap-3">
            <h3 id="studio-on-ad-heading" className="m-0 text-sm font-bold text-foreground">On the image</h3>
            {editorPreparing ? <Badge variant="secondary">Preparing</Badge> : null}
          </div>
          {editableRegions.length > 0 ? (
            <div className="grid gap-1.5">
              {[...textRegions, ...imageRegions].map((region) => (
                <button
                  key={`${region.kind}:${region.key}`}
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 rounded-(--r-card) border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => selectCanvasRegion(region.key)}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                    {region.kind === "text" ? <FileText aria-hidden className="size-4" /> : <Images aria-hidden className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm capitalize">{region.key.replace(/_/g, " ")}</strong>
                    <small className="block text-xs text-muted-foreground">
                      {region.kind === "text" ? "Text on the image" : "Image area"}
                    </small>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-(--r-card) border border-dashed border-border bg-muted/40 p-4">
              <strong className="block text-sm">The finished ad is ready.</strong>
              <p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">
                {editorPreparing ? "Editable image areas are being attached now." : "This ad has no editable image areas."}
              </p>
            </div>
          )}
        </section>

        <section className="grid gap-2" aria-labelledby="studio-ad-copy-heading">
          <h3 id="studio-ad-copy-heading" className="m-0 text-sm font-bold text-foreground">Ad copy</h3>
          <div className="grid gap-1.5">
            {copyItems.map((item) => (
              <button
                key={item.field}
                type="button"
                className="flex min-h-12 w-full items-center gap-3 rounded-(--r-card) border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => selectMetaCopyField(item.field)}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-xs text-muted-foreground">{item.label}</strong>
                  <span className="block truncate text-sm font-medium text-foreground">{item.value || "Not set"}</span>
                </span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderEditPanel() {
    const textField = copyFieldForSelectedElement(selectedElement);
    if (textField) return renderTextLayerPanel(textField);
    return renderEditOverview();
  }

  function renderEmptyPreview() {
    return (
      <div className="studio-empty">
        <div className="studio-empty-ic"><LayoutGrid aria-hidden size={22} /></div>
        <strong>No ad yet.</strong>
        <Button type="button" onClick={() => openSamplePicker()}>
          Create an ad
        </Button>
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
              selectedElement={selectedElement}
              onSelectText={selectMetaCopyField}
            >
              <InPlaceAdEditor
                creative={currentCreative}
                onCreativeChange={updateCreative}
                showToast={studio.showToast}
                selectedRegionKey={selectedCanvasRegionKey}
                onRegionSelectionChange={(key) => {
                  setSelectedCanvasRegionKey(key);
                  if (key) setSelectedElement("canvas");
                }}
              />
            </MetaChromePreview>
          </PreviewFit>
          {currentCreative.canvas.cloneQa?.regions.length ? (
            <p className="studio-metachrome-edit-hint">Select text or an image on the ad, or open Edit elements.</p>
          ) : editorPreparing ? (
            <p className="studio-metachrome-edit-hint">Your ad is ready to preview - editing unlocks in a moment.</p>
          ) : null}

        </div>
      );
    }

    return renderEmptyPreview();
  }

  function renderHomePanel() {
    const startingPointDone = Boolean(activeSampleId || pack.campaign.templateKey || pack.variants.length > 0);
    const mediaDone = Boolean(primaryImage);
    const publishReady = !brandIsDraft && readinessItems.every((item) => item.state === "done");

    const steps = [
      { label: "Brand", done: !brandIsDraft, onClick: () => goToSection("brand") },
      { label: "Design", done: startingPointDone, onClick: () => openSamplePicker() },
      { label: "Media", done: mediaDone, onClick: () => openMediaSheet() },
      { label: "Publish", done: publishReady, onClick: () => goToSection("publish") },
    ];
    const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1]!;

    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 py-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-5 text-center">
            <div className="aspect-[4/5] w-full max-w-[220px] overflow-hidden rounded-(--r-card) border border-border bg-(--surface-subtle)">
              {primaryImage ? (
                <img src={primaryImage} alt={`${campaignName} ad preview`} className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-3xl font-extrabold text-(--accent)">{initials}</div>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{startingPointDone ? campaignName : "Create your first ad"}</h1>
            <Button size="lg" onClick={() => (startingPointDone ? nextStep.onClick() : openSamplePicker())}>
              {startingPointDone ? "Continue" : "Create an ad"}
              <ArrowRight aria-hidden />
            </Button>
          </CardContent>
        </Card>

        <ol className="flex items-center gap-2" aria-label="Ad progress">
          {steps.map((step, index) => (
            <li key={step.label} className="flex-1">
              <button
                type="button"
                onClick={step.onClick}
                aria-label={step.done ? `${step.label} complete` : `Step ${index + 1}: ${step.label}`}
                className="flex w-full items-center gap-2 rounded-(--r-card) px-2 py-1.5 text-left transition-colors hover:bg-(--surface-subtle)"
              >
                <Badge variant={step.done ? "default" : "secondary"} className="size-6 shrink-0 p-0">
                  {step.done ? <Check aria-hidden className="size-3.5" /> : index + 1}
                </Badge>
                <span className="text-sm font-medium">{step.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  function renderPanel() {
    if (studio.section === "edit") return renderEditPanel();
    if (studio.section === "publish") {
      // M1: wire real props; H9: pass deleteCampaign
      return (
        <PublishSetupPanel
          campaignId={pack.campaign.campaignId}
          campaignPack={pack}
          creativeSource={publishCreativeSource}
          initialStep={openPublishOnLoad || publishCreativeSource === "library" ? 1 : 0}
          destinationUrl={destinationUrl}
          onChangeDestinationUrl={updateDestinationUrl}
          onChangeTargeting={updateCampaignTargeting}
          onChangeLeadForm={updateLeadForm}
          onExport={exportCreatives}
          onDelete={canManageCampaign ? deleteCampaign : undefined}
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
        <p>Open Create, Library, Edit, Publish, Brand Pack or Settings from the left rail.</p>
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
        minimal={studio.section === "publish"}
        showMore={studio.showMore}
        setShowMore={studio.setShowMore}
        onSave={saveDraft}
        onDelete={canManageCampaign ? deleteCampaign : undefined}
        onOpenBrand={() => goToSection("brand")}
        onOpenSettings={() => goToSection("settings")}
        campaignId={pack.campaign.campaignId}
        showToast={studio.showToast}
      />

      <div className="studio-desktop-body" data-section={studio.section}>
        {studio.section !== "publish" && <aside className="studio-rail" aria-label="Ad Studio sections">
          <span className="studio-rail-label">Create ad</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            if (item.id === "library") {
              return (
                <Link key={item.id} href={item.href}>
                  <Icon aria-hidden size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            }

            let railState: "done" | "warn" | "todo" | null = null;
            if (item.id === "brand") {
              railState = brandKit.reviewStatus === "approved" ? "done" : "warn";
            } else if (item.id === "publish") {
              const allDone = readinessItems.every((ri) => ri.state === "done");
              railState = allDone ? "done" : readinessItems.some((ri) => ri.state === "warn") ? "warn" : "todo";
            } else if (item.id === "edit") {
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
                {railState === "todo" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--line-heavy)", marginLeft: "auto", flexShrink: 0 }} />}
              </button>
            );
          })}
        </aside>}

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
        ) : studio.section === "publish" ? (
          <section className="studio-publish-shell" aria-label="Publish campaign">
            {!isMobileViewport ? renderPanel() : null}
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
                  setSelectedCanvasRegionKey(null);
                  studio.setSection("edit");
                }}
                onReplaceImage={(index) => {
                  selectVariant(index);
                  openMediaSheet();
                  openFilePicker();
                }}
              />
            </section>
          </>
        )}
      </div>

      <div className="studio-mobile-body" data-section={studio.mobileTab}>
        {brandIsDraft && studio.mobileTab !== "home" && studio.mobileTab !== "publish" && (
          <Link href="/ad-studio/brand" className="studio-draft-brand-chip" style={{ marginTop: 14 }}>
            <CircleAlert aria-hidden size={15} />
            <span><b>Draft brand in use.</b> Confirm your brand before publishing.</span>
          </Link>
        )}

        {(studio.mobileTab === "edit") && (
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

        {(studio.mobileTab === "edit") && (
          <>
            <div className="studio-mobile-preview-wrap">
              {renderCreativeEditor()}
            </div>
            <div
              className="studio-mobile-panel"
              data-selected-copy={copyFieldForSelectedElement(selectedElement) ? "true" : undefined}
            >
              {renderPanel()}
            </div>
          </>
        )}

        {studio.mobileTab === "publish" && isMobileViewport && (
          <div className="studio-mobile-panel studio-mobile-publish-panel">
            <PublishSetupPanel
              campaignId={pack.campaign.campaignId}
              campaignPack={pack}
              creativeSource={publishCreativeSource}
              initialStep={openPublishOnLoad || publishCreativeSource === "library" ? 1 : 0}
              destinationUrl={destinationUrl}
              onChangeDestinationUrl={updateDestinationUrl}
              onChangeTargeting={updateCampaignTargeting}
              onChangeLeadForm={updateLeadForm}
              onExport={exportCreatives}
              onDelete={canManageCampaign ? deleteCampaign : undefined}
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

        {(studio.mobileTab === "edit") && (
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

      <nav className="studio-mobile-bottom" aria-label="Ad Studio mobile navigation">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          if (item.id === "library") {
            return (
              <Link key={item.id} href={item.href}>
                <Icon aria-hidden size={22} />
                <span>{item.label}</span>
              </Link>
            );
          }
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
                goToSection(item.id);
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
        hasMoreMediaAssets={Boolean(nextMediaCursor)}
        loadingMoreMediaAssets={loadingMoreMedia}
        onLoadMoreMediaAssets={loadMoreMediaAssets}
        onGenerate={handleGenerateFirstAd}
        initialTemplateId={samplePickerInitialId}
      />

      <Dialog open={brandPromptOpen} onOpenChange={(open) => { if (!open) skipBrandPrompt(); }}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set your brand before launch?</DialogTitle>
            <DialogDescription>
              Add logo, colours and contact details now, or skip and keep building. Publishing stays blocked until the brand is confirmed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={skipBrandPrompt}>Skip for now</Button>
            <Button asChild type="button">
              <Link href="/ad-studio/brand">Set brand</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {studio.toast && <div className="studio-toast">{studio.toast}</div>}

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete campaign?</DialogTitle>
            <DialogDescription>Are you sure? This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" type="button" onClick={confirmDeleteCampaign}>Delete campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={replaceSheetOpen} onOpenChange={setReplaceSheetOpen}>
        <SheetContent side="right" className="gap-0 overflow-hidden sm:max-w-md">
          <SheetHeader className="border-b border-border p-4">
            <SheetTitle>Replace image</SheetTitle>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{renderMediaPanel()}</div>
          <SheetFooter className="border-t border-border p-4">
            <Link href="/ad-studio/library" className="text-sm font-semibold text-primary hover:underline">
              Open library →
            </Link>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  );
}
