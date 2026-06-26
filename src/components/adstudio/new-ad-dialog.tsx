"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Copy, Image as ImageIcon, Plus, Radar, Sparkles, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import { resolveTemplateMediaSlots, type AdStudioBrandKit, type AdStudioTemplate, type FirstAdInput, type TemplateMediaSlot } from "@/lib/adstudio";
import { templatePreviewDataUrl } from "@/lib/adstudio/template-preview.ts";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";

type StartStep = "source" | "template" | "reuse" | "radar";
type Step = "source" | "brief";
type ExploreTab = "templates" | "myads" | "research";
type TemplateFilter = "all" | "new" | "listings" | "appraisals" | "market" | "sold";
type MediaSourceMode = "details" | "library" | "generate";
type ImageLibraryAsset = {
  src: string;
  label: string;
  type?: string;
  ratio?: string;
  role?: string;
};
type GeneratedImageOption = {
  image: string;
  model?: string;
  provider?: string;
  index?: number;
};

const TEMPLATE_FILTERS: ReadonlyArray<{ id: TemplateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "listings", label: "Listings" },
  { id: "appraisals", label: "Appraisals" },
  { id: "market", label: "Market updates" },
  { id: "sold", label: "Sold & nurture" },
];

type TrialStatus = {
  isTrial: boolean;
  includedAdPacks: number;
};

type ReuseAd = {
  id: string;
  name: string;
  goal: string | null;
  status: string | null;
  createdAt: string | null;
};

type RadarAd = {
  savedId: string;
  observedAdId: string;
  cta: string;
  adType: string;
  primaryIntent: string;
  hooks: string[];
};

type RadarInspiration = RadarAd;

type NewAdDialogProps = {
  open: boolean;
  onClose: () => void;
  brandKit: AdStudioBrandKit;
  workspaceId: string;
  templates: AdStudioTemplate[];
  mediaAssets?: ImageLibraryAsset[];
  onGenerate: (input: FirstAdInput) => Promise<void>;
  /** Pre-select a template (e.g. launched from a template card). */
  initialTemplateId?: string;
  /** Where the dialog opens: which tab of the explore view. */
  initialStep?: StartStep;
};

function templateCategory(goal: string | null | undefined): "listings" | "appraisals" | "market" | "sold" {
  switch (goal) {
    case "appraisal_bookings":
    case "downsizer_leads":
    case "investor_leads":
      return "appraisals";
    case "market_update_leads":
      return "market";
    case "open_home_followup":
    case "listing_nurture":
      return "sold";
    default:
      return "listings";
  }
}

function isNewTemplate(template: AdStudioTemplate): boolean {
  return template.source === "operator" || template.source === "radar" || typeof template.evidenceScore === "number";
}

function templatePreviewSrc(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  return templatePreviewDataUrl(template, brandKit);
}

function templateHasGalleryPreview(template: AdStudioTemplate, brandKit: AdStudioBrandKit): boolean {
  const src = templatePreviewSrc(template, brandKit);
  return src.startsWith("/adstudio-samples/") || src.includes("/template-cards/");
}

function templateSampleDescription(template: AdStudioTemplate): string {
  if (!template.sampleCopy) return template.promptHint;
  return `${template.sampleCopy.headline} - ${template.sampleCopy.primaryText}`;
}

function tabForStep(step: StartStep): ExploreTab {
  if (step === "reuse") return "myads";
  if (step === "radar") return "research";
  return "templates";
}

export function NewAdDialog({
  open,
  onClose,
  brandKit,
  workspaceId,
  templates,
  mediaAssets = [],
  onGenerate,
  initialTemplateId,
  initialStep = "source",
}: NewAdDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [tab, setTab] = useState<ExploreTab>("templates");
  const [filter, setFilter] = useState<TemplateFilter>("all");
  // undefined = nothing chosen yet; "" = blank (create your own)
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [imageSlotDataUrls, setImageSlotDataUrls] = useState<Record<string, string>>({});
  const [imageSlotNames, setImageSlotNames] = useState<Record<string, string>>({});
  const [mediaSourceMode, setMediaSourceMode] = useState<MediaSourceMode>("details");
  const [activeMediaSlotId, setActiveMediaSlotId] = useState<string | null>(null);
  const [dialogMediaAssets, setDialogMediaAssets] = useState<ImageLibraryAsset[]>([]);
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [generatorReference, setGeneratorReference] = useState<ImageLibraryAsset | null>(null);
  const [generatedImageOptions, setGeneratedImageOptions] = useState<GeneratedImageOption[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  const [radarInspiration, setRadarInspiration] = useState<RadarInspiration | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [trialCreditNote, setTrialCreditNote] = useState("Uses one ad pack. No Meta account is needed until publish.");

  const [reuseAds, setReuseAds] = useState<ReuseAd[] | null>(null);
  const [reuseError, setReuseError] = useState("");
  const [radarAds, setRadarAds] = useState<RadarAd[] | null>(null);
  const [radarError, setRadarError] = useState("");
  const preloadKeyRef = useRef("");
  const isBlank = templateId === "";
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const uploadSlots = resolveTemplateMediaSlots({ template: selectedTemplate, brandKit });
  const resolvedImageSlotDataUrls = resolvedSlotDataUrls(uploadSlots, imageSlotDataUrls);
  const primarySlotId = uploadSlots[0]?.id ?? "primary_photo";
  const activeUploadSlot = uploadSlots.find((slot) => slot.id === activeMediaSlotId) ?? uploadSlots[0];
  const activeSlotIndex = Math.max(0, uploadSlots.findIndex((slot) => slot.id === activeUploadSlot?.id));
  const libraryAssetsForActiveSlot = imageLibraryAssetsForSlot(dialogMediaAssets, activeUploadSlot);
  const imageDataUrl = resolvedImageSlotDataUrls[primarySlotId] ?? firstRecordValue(resolvedImageSlotDataUrls) ?? "";
  const imageDataUrls = uploadSlots.map((slot) => resolvedImageSlotDataUrls[slot.id]).filter((src): src is string => Boolean(src));
  const missingRequiredImageSlots = uploadSlots.filter((slot) => slot.required && !resolvedImageSlotDataUrls[slot.id]);
  const requiredImageSlotCount = uploadSlots.filter((slot) => slot.required).length;
  const filledRequiredImageSlotCount = requiredImageSlotCount - missingRequiredImageSlots.length;
  const slotPreviewFormat = uploadSlots[0]?.previewFormat ?? "4:5";
  const previewSlots = uploadSlots.filter((slot) => slot.previewFormat === slotPreviewFormat);
  const slotRequirementNote = slotRequirementSummary(uploadSlots, isBlank);

  const closeCurrentView = useCallback(() => {
    if (step === "brief" && mediaSourceMode !== "details") {
      setMediaSourceMode("details");
      setError("");
      return;
    }
    onClose();
  }, [mediaSourceMode, onClose, step]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (initialTemplateId !== undefined) {
      setTemplateId(initialTemplateId);
      setStep("brief");
    } else {
      setTemplateId(undefined);
      setStep("source");
    }
    setTab(tabForStep(initialStep));
    setFilter("all");
    setDescription("");
    // The customer supplies their own listing photo; the template drives layout,
    // copy, and brand rather than using a pre-baked image.
    setImageSlotDataUrls({});
    setImageSlotNames({});
    setDialogMediaAssets(dedupeImageLibraryAssets(mediaAssets));
    setMediaSourceMode("details");
    setActiveMediaSlotId(null);
    setGeneratorPrompt("");
    setGeneratorReference(null);
    setGeneratedImageOptions([]);
    setSourceNote("");
    setRadarInspiration(null);
    setError("");
    setUploadingImage(false);
    setUploadingReference(false);
    setGeneratingImage(false);
    setReuseAds(null);
    setReuseError("");
    setRadarAds(null);
    setRadarError("");
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, initialTemplateId, initialStep]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadTrialStatus() {
      try {
        const response = await fetch("/api/trial/status", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { trial?: TrialStatus | null };
        if (!cancelled) setTrialCreditNote(formatTrialCreditNote(response.ok ? payload.trial ?? null : null));
      } catch {
        if (!cancelled) setTrialCreditNote(formatTrialCreditNote(null));
      }
    }

    void loadTrialStatus();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load previous ads and Ad Radar lists once the dialog opens so their
  // tab counts are accurate and switching tabs is instant.
  useEffect(() => {
    if (!open || reuseAds !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/adstudio/campaigns", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { campaigns?: Array<Record<string, unknown>>; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load your ads.");
        if (!cancelled) setReuseAds((payload.campaigns ?? []).map(toReuseAd).filter((ad): ad is ReuseAd => ad !== null));
      } catch (caught) {
        if (!cancelled) {
          setReuseAds([]);
          setReuseError(caught instanceof Error ? caught.message : "Could not load your ads.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reuseAds]);

  useEffect(() => {
    if (!open || radarAds !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/research/swipe-file", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { savedAds?: Array<Record<string, unknown>>; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load saved Ad Radar ads.");
        if (!cancelled) setRadarAds((payload.savedAds ?? []).map(toRadarAd).filter((ad): ad is RadarAd => ad !== null));
      } catch (caught) {
        if (!cancelled) {
          setRadarAds([]);
          setRadarError(caught instanceof Error ? caught.message : "Could not load saved Ad Radar ads.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, radarAds]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCurrentView();
      }
      if (event.key === "Tab") trapFocus(event);
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus.current?.focus();
    };
  }, [closeCurrentView, open]);

  useEffect(() => {
    const trimmed = description.trim();
    if (
      !open ||
      step !== "brief" ||
      isBlank ||
      !selectedTemplate ||
      missingRequiredImageSlots.length > 0 ||
      uploadingImage ||
      trimmed.length < 8
    ) {
      return;
    }

    const preloadKey = [
      selectedTemplate.templateKey ?? selectedTemplate.id,
      imageDataUrls.join("|"),
      trimmed,
    ].join("|");
    if (preloadKeyRef.current === preloadKey) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      preloadKeyRef.current = preloadKey;
      void fetch("/api/adstudio/template-photo-prep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          brandKit,
          goal: selectedTemplate.goal,
          offerId: selectedTemplate.offerId,
          firstAd: {
            mode: "template",
            source: "template_library",
            templateId: selectedTemplate.id,
            templateKey: selectedTemplate.templateKey ?? selectedTemplate.id,
            imageBriefId: selectedTemplate.imageBriefId,
            description: trimmed,
            imageDataUrl,
            imageDataUrls,
            imageSlotDataUrls: resolvedImageSlotDataUrls,
            formats: ["9:16", "4:5", "1:1"],
          },
        }),
      }).catch(() => {});
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [brandKit, description, imageDataUrl, imageDataUrls, resolvedImageSlotDataUrls, isBlank, missingRequiredImageSlots.length, open, selectedTemplate, step, uploadingImage]);

  if (!open) return null;

  const visibleTemplates = templates.filter((template) => {
    if (filter === "all") return true;
    if (filter === "new") return isNewTemplate(template);
    return templateCategory(template.goal) === filter;
  });

  function trapFocus(event: KeyboardEvent) {
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    setSourceNote("");
    setRadarInspiration(null);
    setError("");
    // The customer adds their own listing photo; the template only drives layout/copy.
    setImageSlotDataUrls({});
    setImageSlotNames({});
    setMediaSourceMode("details");
    setActiveMediaSlotId(null);
    setStep("brief");
  }

  function chooseReuse(ad: ReuseAd) {
    // Reuse opens the existing ad so it can be duplicated or tweaked.
    window.location.href = `/ad-studio?campaignId=${encodeURIComponent(ad.id)}`;
  }

  function chooseRadar(ad: RadarAd) {
    setTemplateId("");
    setDescription("Use this saved Ad Radar pattern as structure only. Write original Blockwise copy for this campaign.");
    setSourceNote("Ad Radar structure selected. Add your own photo and Blockwise will write an original version.");
    setRadarInspiration({
      savedId: ad.savedId,
      observedAdId: ad.observedAdId,
      cta: ad.cta,
      adType: ad.adType,
      primaryIntent: ad.primaryIntent,
      hooks: ad.hooks,
    });
    setError("");
    setMediaSourceMode("details");
    setActiveMediaSlotId(null);
    setStep("brief");
  }

  function goBack() {
    if (step === "brief" && mediaSourceMode !== "details") {
      setMediaSourceMode("details");
      setError("");
      return;
    }
    setStep("source");
  }

  function rememberLibraryAsset(asset: ImageLibraryAsset) {
    setDialogMediaAssets((current) => dedupeImageLibraryAssets([asset, ...current]));
  }

  async function selectImage(slotId: string, file: File) {
    setError("");
    setUploadingImage(true);
    try {
      const uploaded = await uploadAdStudioMedia({
        file,
        workspaceId,
        brandKitId: brandKit.brandKitId,
      });
      setImageSlotDataUrls((current) => ({ ...current, [slotId]: uploaded.src }));
      setImageSlotNames((current) => ({ ...current, [slotId]: file.name }));
      rememberLibraryAsset({
        src: uploaded.src,
        label: file.name,
        type: "Uploaded",
        ratio: "Just now",
        role: mediaAssetRoleForSlot(uploadSlots.find((slot) => slot.id === slotId)),
      });
      setActiveMediaSlotId(nextEmptyRequiredSlotId(uploadSlots, { ...resolvedImageSlotDataUrls, [slotId]: uploaded.src }, slotId) ?? slotId);
      setError("");
    } catch (caught) {
      setImageSlotDataUrls((current) => {
        const next = { ...current };
        delete next[slotId];
        return next;
      });
      setImageSlotNames((current) => {
        const next = { ...current };
        delete next[slotId];
        return next;
      });
      setError(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setUploadingImage(false);
    }
  }

  function openLibrary(slotId: string) {
    setActiveMediaSlotId(slotId);
    setMediaSourceMode("library");
    setError("");
  }

  function openGenerator(slotId: string) {
    setActiveMediaSlotId(slotId);
    setMediaSourceMode("generate");
    setGeneratorPrompt("");
    setGeneratorReference(null);
    setGeneratedImageOptions([]);
    setError("");
  }

  function selectLibraryImage(asset: ImageLibraryAsset) {
    if (!activeUploadSlot) return;
    const nextSlotDataUrls = { ...resolvedImageSlotDataUrls, [activeUploadSlot.id]: asset.src };
    const nextSlotId = nextEmptyRequiredSlotId(uploadSlots, nextSlotDataUrls, activeUploadSlot.id);
    setImageSlotDataUrls((current) => ({ ...current, [activeUploadSlot.id]: asset.src }));
    setImageSlotNames((current) => ({ ...current, [activeUploadSlot.id]: asset.label }));
    setActiveMediaSlotId(nextSlotId ?? activeUploadSlot.id);
    setMediaSourceMode(nextSlotId ? "library" : "details");
    setError("");
  }

  async function selectGeneratorReference(file: File) {
    setError("");
    setUploadingReference(true);
    try {
      const uploaded = await uploadAdStudioMedia({
        file,
        workspaceId,
        brandKitId: brandKit.brandKitId,
      });
      const asset = { src: uploaded.src, label: file.name, type: "Reference image", ratio: "Just now", role: "property" };
      setGeneratorReference(asset);
      rememberLibraryAsset(asset);
    } catch (caught) {
      setGeneratorReference(null);
      setError(caught instanceof Error ? caught.message : "Could not upload that sample image.");
    } finally {
      setUploadingReference(false);
    }
  }

  async function generateImageForSlot() {
    const prompt = generatorPrompt.trim();
    if (!activeUploadSlot) return;
    if (!prompt) {
      setError("Add a prompt for the image.");
      return;
    }

    setGeneratingImage(true);
    setGeneratedImageOptions([]);
    setError("");
    try {
      const response = await fetch("/api/adstudio/generate-options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          copyText: description.trim() || prompt,
          sourceImage: generatorReference?.src,
          aspectRatio: "4:5",
          stylePreset: activeUploadSlot.role === "agent_headshot" ? "agent_portrait" : "real_estate_photography",
          brandKitId: brandKit.brandKitId,
          optionCount: 1,
          brand: {
            palette: [
              brandKit.colours.primary,
              brandKit.colours.secondary,
              brandKit.colours.accent,
              brandKit.colours.background,
              brandKit.colours.text,
            ],
            styleTags: brandKit.visualStyle.styleTags,
            imageTreatment: brandKit.visualStyle.imageTreatment,
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        options?: GeneratedImageOption[];
        compliance?: { pass?: boolean; issues?: string[] };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Could not generate that image.");
      if (payload.compliance?.pass === false) {
        throw new Error(payload.compliance.issues?.[0] || "Adjust the image prompt and try again.");
      }

      const options = (payload.options ?? []).filter((option) => Boolean(option.image));
      if (options.length === 0) throw new Error("No generated image was returned.");
      setGeneratedImageOptions(options);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate that image.");
    } finally {
      setGeneratingImage(false);
    }
  }

  function useGeneratedImage(option: GeneratedImageOption) {
    if (!activeUploadSlot) return;
    const label = option.index === undefined ? "Generated image" : `Generated image ${option.index + 1}`;
    setImageSlotDataUrls((current) => ({ ...current, [activeUploadSlot.id]: option.image }));
    setImageSlotNames((current) => ({ ...current, [activeUploadSlot.id]: label }));
    rememberLibraryAsset({ src: option.image, label, type: "AI generated", ratio: "Image", role: mediaAssetRoleForSlot(activeUploadSlot) });
    void registerGeneratedImageAsAsset(brandKit.brandKitId, option.image);
    setActiveMediaSlotId(nextEmptyRequiredSlotId(uploadSlots, { ...resolvedImageSlotDataUrls, [activeUploadSlot.id]: option.image }, activeUploadSlot.id) ?? activeUploadSlot.id);
    setMediaSourceMode("details");
    setError("");
  }

  async function submit() {
    const trimmed = description.trim();
    if (uploadingImage) {
      setError("Wait for the image upload to finish.");
      return;
    }
    if (missingRequiredImageSlots.length > 0) {
      setError(missingRequiredImageSlots.length === 1 ? `Upload ${missingRequiredImageSlots[0]?.label.toLowerCase() ?? "one image"} to generate the ad.` : `Upload all ${missingRequiredImageSlots.length} required images to generate the ad.`);
      return;
    }
    if (!trimmed) {
      setError("Add a short description.");
      return;
    }
    if (trimmed.length > 500) {
      setError("Keep the description under 500 characters.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const source = radarInspiration ? "ad_radar" : isBlank ? "blank" : "template_library";
      await onGenerate({
        mode: isBlank ? "custom" : "template",
        source,
        templateId: isBlank ? undefined : selectedTemplate?.id,
        templateKey: isBlank ? undefined : selectedTemplate?.templateKey ?? selectedTemplate?.id,
        imageBriefId: isBlank ? undefined : selectedTemplate?.imageBriefId,
        savedAdId: radarInspiration?.savedId,
        observedAdId: radarInspiration?.observedAdId,
        hooks: radarInspiration?.hooks,
        referenceCta: radarInspiration?.cta,
        referenceAdType: radarInspiration?.adType,
        referenceIntent: radarInspiration?.primaryIntent,
        description: trimmed,
        imageDataUrl,
        imageDataUrls,
        imageSlotDataUrls: resolvedImageSlotDataUrls,
        formats: ["9:16", "4:5", "1:1"],
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate the ad.");
    } finally {
      setSubmitting(false);
    }
  }

  const stepTitle =
    step === "source"
      ? "Templates"
      : mediaSourceMode === "library"
        ? "Choose from library"
        : mediaSourceMode === "generate"
          ? "Generate image"
      : isBlank
        ? sourceNote
          ? "Make it yours"
          : "Describe your ad"
        : `${selectedTemplate?.name ?? "Template"} - add your details`;

  const footHint =
    step === "brief" && mediaSourceMode === "library"
      ? activeUploadSlot
        ? `Select an image for ${activeUploadSlot.label.toLowerCase()}.`
        : "Select an image for this ad."
      : step === "brief" && mediaSourceMode === "generate"
        ? activeUploadSlot
          ? `Generate an image for ${activeUploadSlot.label.toLowerCase()}, then use it in this ad.`
          : "Generate an image, then use it in this ad."
        : step === "brief"
          ? missingRequiredImageSlots.length > 0
            ? `${filledRequiredImageSlotCount}/${requiredImageSlotCount} required images selected.`
            : "Blockwise will generate Story, Feed, and Square."
          : "Pick a starting point. You can change everything later.";

  return (
    <div className="studio-newad-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeCurrentView()}>
      <style>{EXPLORE_STYLES}</style>
      <div
        ref={dialogRef}
        className="studio-newad"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="studio-newad-head">
          {step === "brief" && (
            <button className="studio-newad-x" type="button" aria-label="Back" onClick={goBack}>
              <ArrowLeft aria-hidden size={18} />
            </button>
          )}
          <div className="studio-newad-titleblock">
            <span>Start an ad</span>
            <h2 id={titleId}>{stepTitle}</h2>
            {step === "source" ? (
              <p>Pick a starting layout, then edit the media and text on the canvas.</p>
            ) : mediaSourceMode === "library" && activeUploadSlot ? (
              <p>{activeUploadSlot.label}</p>
            ) : mediaSourceMode === "generate" && activeUploadSlot ? (
              <p>{activeUploadSlot.label}</p>
            ) : null}
          </div>
          <button className="studio-newad-x" type="button" aria-label="Close" onClick={closeCurrentView}>
            <X aria-hidden size={18} />
          </button>
        </div>

        <div className="studio-newad-body">
          {step === "source" && (
            <div className="studio-explore">
              <div className="studio-explore-tabs" role="tablist" aria-label="Where to start">
                <button type="button" role="tab" aria-selected={tab === "templates"} className={tab === "templates" ? "on" : ""} onClick={() => setTab("templates")}>
                  Templates <i>{templates.length}</i>
                </button>
                <button type="button" role="tab" aria-selected={tab === "myads"} className={tab === "myads" ? "on" : ""} onClick={() => setTab("myads")}>
                  Previous ads <i>{reuseAds === null ? "..." : reuseAds.length}</i>
                </button>
                <button type="button" role="tab" aria-selected={tab === "research"} className={tab === "research" ? "on" : ""} onClick={() => setTab("research")}>
                  Ad Radar <i>{radarAds === null ? "..." : radarAds.length}</i>
                </button>
              </div>

              {tab === "templates" && (
                <>
                  <div className="studio-explore-chips" role="group" aria-label="Filter templates">
                    {TEMPLATE_FILTERS.map((chip) => (
                      <button key={chip.id} type="button" className={filter === chip.id ? "on" : ""} onClick={() => setFilter(chip.id)}>
                        {chip.label}
                      </button>
                    ))}
                    <span className="studio-explore-count">{visibleTemplates.length} templates</span>
                  </div>
                  <div className="studio-explore-grid">
                    {visibleTemplates.map((template) => (
                      <article key={template.id} className="studio-explore-card">
                        <div className={`studio-explore-thumb${templateHasGalleryPreview(template, brandKit) ? " studio-explore-thumb--sample" : ""}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={templatePreviewSrc(template, brandKit)} alt="" loading="lazy" decoding="async" />
                          {isNewTemplate(template) && <span className="studio-explore-badge">NEW</span>}
                        </div>
                        <div className="studio-explore-meta">
                          <div className="studio-explore-row">
                            <strong>{template.name}</strong>
                            <ArrowUpRight aria-hidden size={16} />
                          </div>
                          <p>{templateSampleDescription(template)}</p>
                          <button type="button" className="studio-explore-use" onClick={() => chooseTemplate(template.id)}>
                            Use template
                          </button>
                        </div>
                      </article>
                    ))}
                    <article className="studio-explore-card blank">
                      <div className="studio-explore-thumb blank">
                        <span className="studio-explore-plus"><Plus aria-hidden size={22} /></span>
                      </div>
                      <div className="studio-explore-meta">
                        <div className="studio-explore-row">
                          <strong>Start blank</strong>
                        </div>
                        <p>Describe your own ad and Blockwise builds it from scratch.</p>
                        <button type="button" className="studio-explore-use ghost" onClick={() => chooseTemplate("")}>
                          Start blank
                        </button>
                      </div>
                    </article>
                  </div>
                </>
              )}

              {tab === "myads" && (
                <div className="studio-explore-grid">
                  {reuseAds === null ? (
                    <p className="studio-explore-msg">Loading your ads...</p>
                  ) : reuseAds.length === 0 ? (
                    <p className="studio-explore-msg">{reuseError || "No previous ads yet. Start from a template or competitor research instead."}</p>
                  ) : (
                    reuseAds.map((ad) => (
                      <article key={ad.id} className="studio-explore-card">
                        <div className="studio-explore-thumb">
                          <span className="studio-explore-ph">
                            <Copy aria-hidden size={22} />
                          </span>
                        </div>
                        <div className="studio-explore-meta">
                          <div className="studio-explore-row">
                            <strong>{ad.name}</strong>
                            <ArrowUpRight aria-hidden size={16} />
                          </div>
                          <p>{[formatGoal(ad.goal), formatStatus(ad.status), formatDate(ad.createdAt)].filter(Boolean).join(" / ")}</p>
                          <button type="button" className="studio-explore-use" onClick={() => chooseReuse(ad)}>
                            Open ad
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}

              {tab === "research" && (
                <div className="studio-explore-grid">
                  {radarAds === null ? (
                    <p className="studio-explore-msg">Loading saved Ad Radar ads...</p>
                  ) : radarAds.length === 0 ? (
                    <p className="studio-explore-msg">
                      {radarError || "No saved ads yet. Save ads from Ad Radar, then use them here."} <a href="/ad-radar">Open Ad Radar</a>
                    </p>
                  ) : (
                    radarAds.map((ad) => (
                      <article key={ad.savedId} className="studio-explore-card">
                        <div className="studio-explore-thumb">
                          <span className="studio-explore-ph">
                            <Radar aria-hidden size={22} />
                          </span>
                        </div>
                        <div className="studio-explore-meta">
                          <div className="studio-explore-row">
                            <strong>Saved Ad Radar inspiration</strong>
                            <ArrowUpRight aria-hidden size={16} />
                          </div>
                          <p>Uses the selected ad structure internally. Competitor creative is not copied or shown.</p>
                          <button type="button" className="studio-explore-use" onClick={() => chooseRadar(ad)}>
                            Use inspiration
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {step === "brief" && mediaSourceMode === "details" && (
            <div className="studio-newad-own">
              {sourceNote ? <p className="studio-newad-note">{sourceNote}</p> : <p className="studio-newad-note">{trialCreditNote}</p>}
              <div className="studio-newad-media-plan">
                {!isBlank && selectedTemplate ? (
                  <aside className="studio-newad-template-map-card">
                    <div className={`studio-newad-template-map format-${slotPreviewFormat.replace(/[.:]/g, "-")}`} aria-label="Template image slot map">
                      <img src={templatePreviewSrc(selectedTemplate, brandKit)} alt="" loading="lazy" decoding="async" />
                      {previewSlots.map((slot, index) => {
                        const filled = Boolean(resolvedImageSlotDataUrls[slot.id]);
                        const active = slot.id === activeUploadSlot?.id;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            className={`studio-newad-slot-pin${filled ? " filled" : ""}${active ? " active" : ""}`}
                            style={{
                              left: `${slot.rect.x * 100}%`,
                              top: `${slot.rect.y * 100}%`,
                              width: `${slot.rect.w * 100}%`,
                              height: `${slot.rect.h * 100}%`,
                            }}
                            aria-label={`Select ${slot.label}`}
                            onClick={() => setActiveMediaSlotId(slot.id)}
                          >
                            <span>{index + 1}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p>{slotRequirementNote}</p>
                  </aside>
                ) : null}

                <div className="studio-newad-slot-list">
                  {uploadSlots.map((slot, index) => {
                    const filled = Boolean(resolvedImageSlotDataUrls[slot.id]);
                    const uploaded = Boolean(imageSlotDataUrls[slot.id]);
                    const active = slot.id === activeUploadSlot?.id;
                    return (
                      <section key={slot.id} className={`studio-newad-slot-card${active ? " active" : ""}`}>
                        <button className="studio-newad-slot-card-head" type="button" onClick={() => setActiveMediaSlotId(slot.id)}>
                          <span className="studio-newad-slot-number">{index + 1}</span>
                          <span className="studio-newad-slot-title">
                            <strong>{slot.label}</strong>
                            <small>{slot.description}</small>
                          </span>
                          <span className={`studio-newad-slot-status${filled ? " filled" : ""}${slot.required ? "" : " optional"}`}>
                            {filled ? (slot.defaultUrl && !uploaded ? "Brand kit" : "Filled") : slot.required ? "Required" : "Optional"}
                          </span>
                        </button>
                        <AssetUploadDropzone
                          className="studio-newad-upload"
                          label={`${slot.label} upload`}
                          actionText={filled ? "Replace image" : "Upload image"}
                          helperText="JPG, PNG, or WebP / up to 8 MB"
                          previewUrl={resolvedImageSlotDataUrls[slot.id] ?? ""}
                          previewAlt=""
                          fileName={imageSlotNames[slot.id] ?? defaultSlotFileName(slot, filled)}
                          fileType={slot.role === "agent_headshot" ? "Headshot" : "Property image"}
                          acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
                          maxBytes={AD_IMAGE_MAX_BYTES}
                          typeError="Use a JPG, PNG, or WebP image."
                          sizeError="Use an image under 8 MB."
                          capturePagePaste={index === 0}
                          onFileAccepted={(file) => selectImage(slot.id, file)}
                          onFileRejected={setError}
                          onClear={uploaded ? () => {
                            setImageSlotDataUrls((current) => {
                              const next = { ...current };
                              delete next[slot.id];
                              return next;
                            });
                            setImageSlotNames((current) => {
                              const next = { ...current };
                              delete next[slot.id];
                              return next;
                            });
                            setActiveMediaSlotId(slot.id);
                            setError("");
                            setUploadingImage(false);
                          } : undefined}
                        />
                        <div className="studio-newad-media-actions" aria-label={`${slot.label} source options`}>
                          <button type="button" onClick={() => openLibrary(slot.id)}>
                            <ImageIcon aria-hidden size={16} />
                            Choose from library
                          </button>
                          <button type="button" onClick={() => openGenerator(slot.id)}>
                            <Sparkles aria-hidden size={16} />
                            Generate image
                          </button>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
              <label className="studio-newad-field">
                <span>Short description</span>
                <textarea
                  value={description}
                  maxLength={500}
                  rows={5}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={
                    selectedTemplate
                      ? `Example: ${selectedTemplate.promptHint}`
                      : "Example: Open home this Saturday, 3 bed family home in Scarborough with renovated kitchen."
                  }
                />
                <small>{description.length}/500</small>
              </label>
            </div>
          )}

          {step === "brief" && mediaSourceMode === "library" && (
            <div className="studio-newad-library">
              {activeUploadSlot ? (
                <p className="studio-newad-library-note">
                  Filling slot {activeSlotIndex + 1}: <strong>{activeUploadSlot.label}</strong>
                </p>
              ) : null}
              {dialogMediaAssets.length === 0 ? (
                <p className="studio-newad-listmsg">No library images yet.</p>
              ) : (
                <div className="studio-newad-library-grid">
                  {libraryAssetsForActiveSlot.map((asset) => (
                    <button
                      key={asset.src}
                      type="button"
                      className={activeUploadSlot && resolvedImageSlotDataUrls[activeUploadSlot.id] === asset.src ? "active" : ""}
                      onClick={() => selectLibraryImage(asset)}
                    >
                      <img src={asset.src} alt="" />
                      <span>
                        <strong>{asset.label}</strong>
                        <small>{[asset.type, asset.ratio].filter(Boolean).join(" / ") || "Image"}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "brief" && mediaSourceMode === "generate" && activeUploadSlot && (
            <div className="studio-newad-generator">
              <AssetUploadDropzone
                className="studio-newad-upload"
                label="Upload sample image"
                actionText="Upload sample image"
                helperText="Optional JPG, PNG, or WebP reference / up to 8 MB"
                previewUrl={generatorReference?.src ?? ""}
                previewAlt=""
                fileName={generatorReference?.label ?? ""}
                acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
                maxBytes={AD_IMAGE_MAX_BYTES}
                typeError="Use a JPG, PNG, or WebP image."
                sizeError="Use an image under 8 MB."
                onFileAccepted={selectGeneratorReference}
                onFileRejected={setError}
                onClear={() => {
                  setGeneratorReference(null);
                  setError("");
                }}
              />
              <label className="studio-newad-field">
                <span>Image prompt</span>
                <textarea
                  value={generatorPrompt}
                  maxLength={500}
                  rows={4}
                  onChange={(event) => setGeneratorPrompt(event.target.value)}
                  placeholder={activeUploadSlot.role === "agent_headshot"
                    ? "Example: Professional real estate agent portrait, warm natural light, clean neutral background."
                    : "Example: Bright editorial real estate photo with warm natural light, clean styling, and room for ad text."}
                />
                <small>{generatorPrompt.length}/500</small>
              </label>
              <button
                className="studio-btn accent studio-newad-generate-image"
                type="button"
                disabled={generatingImage || uploadingReference}
                onClick={() => void generateImageForSlot()}
              >
                <Sparkles aria-hidden size={16} />
                {uploadingReference ? "Uploading sample" : generatingImage ? "Generating image" : "Generate image"}
              </button>
              {generatedImageOptions.length > 0 && (
                <div className="studio-newad-generated-grid">
                  {generatedImageOptions.map((option) => (
                    <button key={option.image} type="button" onClick={() => useGeneratedImage(option)}>
                      <img src={option.image} alt="" />
                      <span>Use generated image</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="studio-newad-foot">
          <span className={error ? "studio-newad-error" : "studio-newad-sel"}>{error || footHint}</span>
          <button className="studio-btn secondary" type="button" onClick={closeCurrentView}>Close</button>
          {step === "brief" && mediaSourceMode === "details" && (
            <button className="studio-btn accent" type="button" onClick={() => void submit()} disabled={submitting || uploadingImage}>
              {uploadingImage ? "Uploading" : submitting ? "Generating" : "Generate ad"}
              <ArrowUpRight aria-hidden size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toReuseAd(row: Record<string, unknown>): ReuseAd | null {
  const id = String(row.id ?? row.campaign_id ?? "");
  if (!id) return null;
  if (row.status === "archived") return null;
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : "Ad draft",
    goal: typeof row.goal === "string" ? row.goal : null,
    status: typeof row.status === "string" ? row.status : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  };
}

function toRadarAd(entry: Record<string, unknown>): RadarAd | null {
  const handoffPayload = isRecord(entry.handoff_payload) ? entry.handoff_payload : {};
  const ad = entry.ad as
    | {
        id?: string | null;
        creative?: {
          headline?: string | null;
          body?: string | null;
          cta?: string | null;
          adType?: string | null;
          primaryIntent?: string | null;
          hooks?: string[] | null;
        };
        page?: { name?: string | null };
      }
    | null
    | undefined;
  if (!ad) return null;
  const savedId = String(entry.id ?? "");
  if (!savedId) return null;
  const observedAdId = String(entry.observedAdId ?? ad.id ?? handoffPayload.observedAdId ?? "");
  const cta = ad.creative?.cta?.trim() ?? "";
  if (!observedAdId) return null;
  return {
    savedId,
    observedAdId,
    cta,
    adType: ad.creative?.adType?.trim() || stringValue(handoffPayload.adType),
    primaryIntent: ad.creative?.primaryIntent?.trim() || stringValue(handoffPayload.primaryIntent),
    hooks: Array.isArray(ad.creative?.hooks)
      ? ad.creative.hooks.filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0)
      : Array.isArray(handoffPayload.hooks)
        ? handoffPayload.hooks.filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0)
        : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatGoal(goal: string | null): string {
  if (!goal) return "";
  return goal.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatus(status: string | null): string {
  if (!status) return "";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function formatTrialCreditNote(status: TrialStatus | null): string {
  if (status?.isTrial && Number.isFinite(status.includedAdPacks) && status.includedAdPacks > 0) {
    return `Uses 1 of ${status.includedAdPacks} free ad packs. No Meta account is needed until publish.`;
  }

  return "Uses one ad pack. No Meta account is needed until publish.";
}

function slotRequirementSummary(slots: TemplateMediaSlot[], isBlank: boolean): string {
  const required = slots.filter((slot) => slot.required);
  const headshot = slots.find((slot) => slot.role === "agent_headshot");
  if (isBlank || slots.length === 1) return "Add one strong property image. You can replace it on the canvas later.";
  const propertyCount = required.filter((slot) => slot.role !== "agent_headshot").length;
  const headshotText = headshot
    ? headshot.required
      ? " and an agent headshot"
      : " plus the brand-kit headshot"
    : "";
  return `This template needs ${propertyCount} property ${propertyCount === 1 ? "image" : "images"}${headshotText}. Numbers match the image positions in the template.`;
}

function defaultSlotFileName(slot: TemplateMediaSlot, filled: boolean): string {
  if (!filled) return "";
  if (slot.defaultUrl) return "Brand kit headshot";
  return "";
}

function resolvedSlotDataUrls(
  slots: TemplateMediaSlot[],
  uploaded: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    slots
      .map((slot) => [slot.id, uploaded[slot.id] ?? slot.defaultUrl ?? ""] as const)
      .filter((entry): entry is [string, string] => entry[1].length > 0),
  );
}

function firstRecordValue(record: Record<string, string>): string | undefined {
  return Object.values(record).find((value) => value.length > 0);
}

function nextEmptyRequiredSlotId(
  slots: TemplateMediaSlot[],
  dataUrls: Record<string, string>,
  currentSlotId: string,
): string | null {
  const startIndex = Math.max(0, slots.findIndex((slot) => slot.id === currentSlotId));
  const ordered = [...slots.slice(startIndex + 1), ...slots.slice(0, startIndex + 1)];
  return ordered.find((slot) => slot.required && !dataUrls[slot.id])?.id ?? null;
}

function dedupeImageLibraryAssets(assets: ImageLibraryAsset[]): ImageLibraryAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.src || seen.has(asset.src)) return false;
    seen.add(asset.src);
    return true;
  });
}

function imageLibraryAssetsForSlot(assets: ImageLibraryAsset[], slot: TemplateMediaSlot | undefined): ImageLibraryAsset[] {
  if (!slot) return assets;
  const preferred = assets.filter((asset) => libraryAssetMatchesSlot(asset, slot));
  return preferred.length > 0 ? preferred : assets;
}

function libraryAssetMatchesSlot(asset: ImageLibraryAsset, slot: TemplateMediaSlot): boolean {
  const role = resolveLibraryAssetRole(asset);
  if (slot.role === "agent_headshot") return role === "person";
  return role === "property" || role === "background";
}

function mediaAssetRoleForSlot(slot: TemplateMediaSlot | undefined): string {
  if (slot?.role === "agent_headshot") return "person";
  return "property";
}

function resolveLibraryAssetRole(asset: ImageLibraryAsset): "property" | "person" | "logo" | "background" {
  if (asset.role === "person" || asset.role === "property" || asset.role === "logo" || asset.role === "background") return asset.role;
  const haystack = `${asset.label} ${asset.type ?? ""}`.toLowerCase();
  if (/agent|headshot|portrait|profile|person|team/.test(haystack)) return "person";
  if (/logo|wordmark|brandmark/.test(haystack)) return "logo";
  if (/office|skyline|interior|living|backdrop|background|market view/.test(haystack)) return "background";
  return "property";
}

async function registerGeneratedImageAsAsset(brandKitId: string, src: string) {
  const storagePath = storagePathFromMediaSrc(src);
  if (!brandKitId || !storagePath) return;
  await fetch(`/api/adstudio/brand-kits/${brandKitId}/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assetType: "listing_image",
      storagePath,
      source: "ai_generated",
    }),
  }).catch(() => {});
}

function storagePathFromMediaSrc(src: string): string | null {
  try {
    const url = new URL(src, window.location.origin);
    if (url.pathname !== "/api/adstudio/media") return null;
    return url.searchParams.get("path")?.trim() || null;
  } catch {
    return null;
  }
}

const EXPLORE_STYLES = `
.studio-explore{display:grid;gap:18px}
.studio-explore-tabs{display:flex;gap:10px;flex-wrap:wrap}
.studio-explore-tabs button{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);font-weight:650;font-size:13.5px;padding:9px 16px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.studio-explore-tabs button:hover{color:var(--ink)}
.studio-explore-tabs button.on{background:#001b3d;color:#fff;border-color:#001b3d}
.studio-explore-tabs button i{font-style:normal;font-size:11.5px;font-weight:700;min-width:22px;height:20px;padding:0 6px;border-radius:999px;display:inline-grid;place-items:center;background:var(--line-soft);color:var(--muted)}
.studio-explore-tabs button.on i{background:rgba(255,255,255,.22);color:#fff}
.studio-explore-chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.studio-explore-chips button{border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);font-weight:650;font-size:12.5px;padding:7px 13px;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
.studio-explore-chips button:hover{color:var(--ink)}
.studio-explore-chips button.on{background:var(--ink,#0f172a);color:#fff;border-color:var(--ink,#0f172a)}
.studio-explore-count{margin-left:auto;font-size:12.5px;color:var(--muted)}
.studio-explore-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:stretch}
.studio-explore-card{display:flex;min-width:0;flex-direction:column;border:1px solid var(--line-soft);border-radius:14px;background:#fff;box-shadow:var(--st-sh-1);overflow:hidden;transition:transform .15s,box-shadow .15s}
.studio-explore-card:hover{transform:translateY(-2px);box-shadow:var(--st-sh-lift)}
.studio-explore-thumb{position:relative;height:236px;display:grid;place-items:center;overflow:hidden;background:#eef2f7}
.studio-explore-thumb--sample{height:326px;background:linear-gradient(180deg,#f8fafc 0%,#e8edf4 100%)}
.studio-explore-thumb img{max-width:calc(100% - 24px);max-height:calc(100% - 20px);object-fit:contain;background:#fff;border-radius:12px;box-shadow:0 14px 34px rgba(15,23,42,.18);display:block}
.studio-explore-ph{display:grid;justify-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.7px;color:rgba(15,23,42,.35)}
.studio-explore-badge{position:absolute;top:10px;left:10px;font-size:10px;font-weight:800;letter-spacing:.4px;background:#c9f24a;color:#1c2b08;border-radius:999px;padding:3px 9px}
.studio-explore-thumb.blank{background:var(--accent-tint);color:var(--accent)}
.studio-explore-plus{width:46px;height:46px;border-radius:999px;background:#fff;box-shadow:var(--st-sh-1);display:grid;place-items:center;color:var(--accent)}
.studio-explore-meta{display:flex;flex-direction:column;gap:7px;padding:14px;flex:1}
.studio-explore-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.studio-explore-row strong{font-size:14.5px;font-weight:700;line-height:1.22;letter-spacing:-.1px}
.studio-explore-row svg{color:var(--muted);flex:0 0 auto;margin-top:2px}
.studio-explore-meta p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.studio-explore-use{margin-top:auto;align-self:flex-start;border:0;border-radius:9px;background:#001b3d;color:#fff;font-weight:650;font-size:13px;padding:9px 16px;cursor:pointer;transition:background .15s}
.studio-explore-use:hover{background:#0a2c55}
.studio-explore-use.ghost{background:#fff;color:var(--accent);border:1px solid var(--line)}
.studio-explore-use.ghost:hover{background:var(--accent-tint)}
.studio-explore-msg{grid-column:1/-1;margin:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);padding:18px;color:var(--muted);font-size:13.5px;line-height:1.5}
.studio-explore-msg a{color:var(--accent);font-weight:650}
.studio-newad-media-plan{display:grid;grid-template-columns:minmax(220px,0.82fr) minmax(0,1.18fr);gap:16px;align-items:start}
.studio-newad-template-map-card{display:grid;gap:10px;align-content:start;position:sticky;top:0}
.studio-newad-template-map-card p{margin:0;color:var(--muted);font-size:12.5px;line-height:1.45}
.studio-newad-template-map{position:relative;overflow:hidden;border:1px solid var(--line-soft);border-radius:10px;background:#f4f0e8;box-shadow:var(--st-sh-1)}
.studio-newad-template-map.format-4-5{aspect-ratio:4/5}
.studio-newad-template-map.format-9-16{aspect-ratio:9/16}
.studio-newad-template-map.format-1-1{aspect-ratio:1/1}
.studio-newad-template-map.format-1-91-1{aspect-ratio:1.91/1}
.studio-newad-template-map img{width:100%;height:100%;object-fit:contain;display:block;background:#f8fafc}
.studio-newad-slot-pin{position:absolute;display:block;border:2px solid rgba(255,255,255,.95);border-radius:8px;background:rgba(0,27,61,.12);box-shadow:0 10px 24px rgba(15,23,42,.16);cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
.studio-newad-slot-pin span{position:absolute;top:6px;left:6px;width:24px;height:24px;border-radius:999px;background:#c9f24a;color:#1c2b08;display:grid;place-items:center;font-size:12px;font-weight:900;box-shadow:0 8px 18px rgba(15,23,42,.22)}
.studio-newad-slot-pin.filled{background:rgba(18,113,91,.18);border-color:#12715b}
.studio-newad-slot-pin.active{background:rgba(0,27,61,.2);border-color:#001b3d;box-shadow:0 0 0 3px rgba(0,27,61,.16),0 10px 24px rgba(15,23,42,.16)}
.studio-newad-slot-list{display:grid;gap:12px}
.studio-newad-slot-card{display:grid;gap:10px;border:1px solid var(--line-soft);border-radius:12px;background:#fff;padding:12px;box-shadow:var(--st-sh-1);transition:border-color .15s,box-shadow .15s}
.studio-newad-slot-card.active{border-color:#001b3d;box-shadow:0 0 0 3px rgba(0,27,61,.08),var(--st-sh-1)}
.studio-newad-slot-card-head{width:100%;min-height:0;border:0;border-radius:0;background:transparent;color:var(--ink);display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:start;gap:10px;padding:0;text-align:left;box-shadow:none;cursor:pointer}
.studio-newad-slot-number{width:30px;height:30px;border-radius:999px;background:#001b3d;color:#fff;display:grid;place-items:center;font-size:12px;font-weight:850;line-height:1}
.studio-newad-slot-title{display:grid;gap:3px;min-width:0}
.studio-newad-slot-title strong{font-size:14px;font-weight:760;line-height:1.2}
.studio-newad-slot-title small{font-size:12.3px;line-height:1.35;color:var(--muted)}
.studio-newad-slot-status{justify-self:end;border-radius:999px;background:#fff7ed;color:#b54708;padding:4px 8px;font-size:10.5px;font-weight:850;letter-spacing:.01em}
.studio-newad-slot-status.filled{background:#ecfdf3;color:#12715b}
.studio-newad-slot-status.optional{background:#eef2f7;color:#475569}
.studio-newad-media-actions{display:flex;gap:8px;flex-wrap:wrap}
.studio-newad-media-actions button{min-height:36px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;padding:0 12px;font-size:12.5px;font-weight:650;box-shadow:var(--st-sh-1);cursor:pointer}
.studio-newad-media-actions button:hover{background:var(--accent-tint);border-color:#cfe0f3;color:var(--accent)}
.studio-newad-library,.studio-newad-generator{display:grid;gap:14px}
.studio-newad-library-note{margin:0;border:1px solid #cfe0f3;border-radius:10px;background:#f4f8fc;color:#21415f;padding:11px 13px;font-size:13px;line-height:1.4}
.studio-newad-library-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.studio-newad-library-grid button{min-width:0;border:1px solid var(--line-soft);border-radius:8px;background:#fff;padding:8px;text-align:left;display:grid;gap:8px;box-shadow:var(--st-sh-1);cursor:pointer;color:var(--ink)}
.studio-newad-library-grid button:hover{box-shadow:var(--st-sh-lift)}
.studio-newad-library-grid button.active{border-color:#001b3d;box-shadow:0 0 0 3px rgba(0,27,61,.08),var(--st-sh-1)}
.studio-newad-library-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#eef2f7;display:block}
.studio-newad-library-grid span,.studio-newad-generated-grid span{display:grid;gap:2px;min-width:0}
.studio-newad-library-grid strong{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-newad-library-grid small{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-newad-generate-image{justify-self:start;min-height:40px}
.studio-newad-generated-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.studio-newad-generated-grid button{border:1px solid var(--line-soft);border-radius:8px;background:#fff;padding:8px;display:grid;gap:8px;text-align:left;box-shadow:var(--st-sh-1);cursor:pointer;color:var(--ink);font-weight:650;font-size:12.5px}
.studio-newad-generated-grid button:hover{box-shadow:var(--st-sh-lift)}
.studio-newad-generated-grid img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px;background:#eef2f7;display:block}
@media(max-width:900px){
  .studio-explore-grid{grid-template-columns:repeat(2,1fr);gap:12px}
  .studio-explore-tabs button{font-size:12.5px;padding:8px 13px}
  .studio-explore-thumb{height:210px}
  .studio-explore-thumb--sample{height:286px}
  .studio-newad-media-plan{grid-template-columns:1fr}
  .studio-newad-template-map-card{position:static}
  .studio-newad-library-grid,.studio-newad-generated-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:560px){
  .studio-explore-grid{grid-template-columns:1fr}
  .studio-explore-thumb{height:220px}
  .studio-explore-thumb--sample{height:320px}
  .studio-newad-slot-card-head{grid-template-columns:30px minmax(0,1fr)}
  .studio-newad-slot-status{grid-column:2;justify-self:start}
  .studio-newad-library-grid,.studio-newad-generated-grid{grid-template-columns:1fr}
}
`;
// NewAdDialog: Templates pop-up with Templates, Previous ads, and Ad Radar tabs.
