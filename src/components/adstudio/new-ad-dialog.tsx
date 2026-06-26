"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Copy, Image as ImageIcon, Plus, Radar, Sparkles, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import type { AdStudioBrandKit, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
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
type TemplateImageRequirement = {
  id: string;
  label: string;
  guidance?: string;
  role: "primary" | "secondary" | "agent_headshot";
  required: boolean;
};
type RequirementBlockerTarget = "description" | "images" | "upload";
type RequirementBlocker = {
  id: string;
  message: string;
  target?: RequirementBlockerTarget;
};

const FIRST_AD_FORMATS: FirstAdInput["formats"] = ["9:16", "4:5", "1:1"];
const DEFAULT_IMAGE_SLOT: TemplateImageRequirement = {
  id: "primary_photo",
  label: "Property image",
  role: "primary",
  required: true,
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
  const requirementsAlertId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [tab, setTab] = useState<ExploreTab>("templates");
  const [filter, setFilter] = useState<TemplateFilter>("all");
  // undefined = nothing chosen yet; "" = blank (create your own)
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [imageDataUrlsBySlot, setImageDataUrlsBySlot] = useState<Record<string, string>>({});
  const [imageNamesBySlot, setImageNamesBySlot] = useState<Record<string, string>>({});
  const [activeImageSlotId, setActiveImageSlotId] = useState(DEFAULT_IMAGE_SLOT.id);
  const [mediaSourceMode, setMediaSourceMode] = useState<MediaSourceMode>("details");
  const [dialogMediaAssets, setDialogMediaAssets] = useState<ImageLibraryAsset[]>([]);
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [generatorReference, setGeneratorReference] = useState<ImageLibraryAsset | null>(null);
  const [generatedImageOptions, setGeneratedImageOptions] = useState<GeneratedImageOption[]>([]);
  const [sourceNote, setSourceNote] = useState("");
  const [radarInspiration, setRadarInspiration] = useState<RadarInspiration | null>(null);
  const [error, setError] = useState("");
  const [showRequirementsAlert, setShowRequirementsAlert] = useState(false);
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
  const imageRequirements = useMemo(
    () => imageRequirementsForTemplate(selectedTemplate, isBlank),
    [isBlank, selectedTemplate],
  );
  const primaryImageSlot = imageRequirements[0] ?? DEFAULT_IMAGE_SLOT;
  const activeImageSlot = imageRequirements.find((slot) => slot.id === activeImageSlotId) ?? primaryImageSlot;
  const imageDataUrl = imageDataUrlsBySlot[primaryImageSlot.id] ?? "";
  const missingImageLabels = useMemo(
    () => imageRequirements
      .filter((slot) => slot.required && !imageDataUrlsBySlot[slot.id])
      .map((slot) => slot.label),
    [imageDataUrlsBySlot, imageRequirements],
  );
  const imageDataUrls = useMemo(
    () => imageRequirements.reduce<Record<string, string>>((values, slot) => {
      const src = imageDataUrlsBySlot[slot.id];
      if (src) values[slot.id] = src;
      return values;
    }, {}),
    [imageDataUrlsBySlot, imageRequirements],
  );
  const requirementBlockers = buildRequirementBlockers({
    description,
    missingImageLabels,
    uploadingImage,
  });
  const visibleRequirementBlockers = showRequirementsAlert ? requirementBlockers : [];
  const hasDescriptionRequirement = visibleRequirementBlockers.some((blocker) => blocker.target === "description");
  const detailsErrorMessage = step === "brief" && mediaSourceMode === "details" ? error : "";
  const footerAlertItems = visibleRequirementBlockers.length > 0
    ? [
        ...visibleRequirementBlockers,
        ...(detailsErrorMessage ? [{ id: "details_error", message: detailsErrorMessage }] : []),
      ]
    : detailsErrorMessage
      ? [{ id: "details_error", message: detailsErrorMessage }]
      : [];
  const showFooterAlert = step === "brief" && mediaSourceMode === "details" && footerAlertItems.length > 0;
  const footerAlertTitle = visibleRequirementBlockers.length > 0
    ? "Add the missing details before generating"
    : "Fix this before generating";

  const closeCurrentView = useCallback(() => {
    if (step === "brief" && mediaSourceMode !== "details") {
      setMediaSourceMode("details");
      setError("");
      setShowRequirementsAlert(false);
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
    // The customer supplies their own listing photo; the template drives the
    // layout, copy and brand — never a pre-baked image.
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    setActiveImageSlotId(DEFAULT_IMAGE_SLOT.id);
    setDialogMediaAssets(dedupeImageLibraryAssets(mediaAssets));
    setMediaSourceMode("details");
    setGeneratorPrompt("");
    setGeneratorReference(null);
    setGeneratedImageOptions([]);
    setSourceNote("");
    setRadarInspiration(null);
    setError("");
    setShowRequirementsAlert(false);
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
      !imageDataUrl ||
      uploadingImage ||
      trimmed.length < 8
    ) {
      return;
    }

    const preloadKey = [
      selectedTemplate.templateKey ?? selectedTemplate.id,
      imageDataUrl,
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
            formats: FIRST_AD_FORMATS,
          },
        }),
      }).catch(() => {});
    }, 800);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [brandKit, description, imageDataUrl, imageDataUrls, isBlank, open, selectedTemplate, step, uploadingImage]);

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
    setShowRequirementsAlert(false);
    // The customer adds their own listing photo; the template only drives layout/copy.
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    setActiveImageSlotId(DEFAULT_IMAGE_SLOT.id);
    setMediaSourceMode("details");
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
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    setActiveImageSlotId(DEFAULT_IMAGE_SLOT.id);
    setRadarInspiration({
      savedId: ad.savedId,
      observedAdId: ad.observedAdId,
      cta: ad.cta,
      adType: ad.adType,
      primaryIntent: ad.primaryIntent,
      hooks: ad.hooks,
    });
    setError("");
    setShowRequirementsAlert(false);
    setMediaSourceMode("details");
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

  function setSlotImage(slotId: string, src: string, label: string) {
    setImageDataUrlsBySlot((current) => ({ ...current, [slotId]: src }));
    setImageNamesBySlot((current) => ({ ...current, [slotId]: label }));
  }

  function clearSlotImage(slotId: string) {
    setImageDataUrlsBySlot((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setImageNamesBySlot((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
  }

  async function selectImage(file: File, slotId: string) {
    setError("");
    setUploadingImage(true);
    try {
      const uploaded = await uploadAdStudioMedia({
        file,
        workspaceId,
        brandKitId: brandKit.brandKitId,
      });
      setSlotImage(slotId, uploaded.src, file.name);
      rememberLibraryAsset({ src: uploaded.src, label: file.name, type: "Uploaded", ratio: "Just now", role: "property" });
      setError("");
    } catch (caught) {
      clearSlotImage(slotId);
      setError(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setUploadingImage(false);
    }
  }

  function openLibrary(slotId: string) {
    setActiveImageSlotId(slotId);
    setMediaSourceMode("library");
    setError("");
  }

  function openGenerator(slotId: string) {
    setActiveImageSlotId(slotId);
    setMediaSourceMode("generate");
    setGeneratorPrompt("");
    setGeneratorReference(null);
    setGeneratedImageOptions([]);
    setError("");
  }

  function selectLibraryImage(asset: ImageLibraryAsset) {
    setSlotImage(activeImageSlot.id, asset.src, asset.label);
    setMediaSourceMode("details");
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

  async function generateImageForAd() {
    const prompt = generatorPrompt.trim();
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
          stylePreset: "real_estate_photography",
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
    const label = option.index === undefined ? "Generated image" : `Generated image ${option.index + 1}`;
    setSlotImage(activeImageSlot.id, option.image, label);
    rememberLibraryAsset({ src: option.image, label, type: "AI generated", ratio: "Image", role: "background" });
    void registerGeneratedImageAsAsset(brandKit.brandKitId, option.image);
    setMediaSourceMode("details");
    setError("");
  }

  async function submit() {
    const trimmed = description.trim();
    const blockers = buildRequirementBlockers({ description, missingImageLabels, uploadingImage });
    if (blockers.length > 0) {
      setShowRequirementsAlert(true);
      setError("");
      if (blockers.some((blocker) => blocker.target === "description")) {
        window.setTimeout(() => descriptionRef.current?.focus(), 0);
      }
      return;
    }

    setSubmitting(true);
    setError("");
    setShowRequirementsAlert(false);
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
        formats: FIRST_AD_FORMATS,
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
    step !== "brief"
      ? "Pick a starting point. You can change everything later."
      : mediaSourceMode === "library"
        ? `Select an image for ${activeImageSlot.label}.`
        : mediaSourceMode === "generate"
          ? `Generate an image for ${activeImageSlot.label}.`
          : "Blockwise will generate Story, Feed, and Square.";

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
            ) : mediaSourceMode === "library" || mediaSourceMode === "generate" ? (
              <p>{activeImageSlot.label}</p>
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
              <div className="studio-newad-upload-group">
                {imageRequirements.map((slot) => (
                  <div className="studio-newad-image-slot" key={slot.id}>
                    {imageRequirements.length > 1 && (
                      <div className="studio-newad-image-slot-head">
                        <span>
                          <strong>{slot.label}</strong>
                          {slot.guidance ? <small>{slot.guidance}</small> : null}
                        </span>
                        {slot.required ? <em>Required</em> : null}
                      </div>
                    )}
                    <AssetUploadDropzone
                      className="studio-newad-upload"
                      label={imageRequirements.length > 1 ? slot.label : "Upload one image"}
                      actionText={uploadActionText(slot, imageRequirements.length)}
                      helperText="JPG, PNG, or WebP / up to 8 MB"
                      previewUrl={imageDataUrlsBySlot[slot.id] ?? ""}
                      previewAlt=""
                      fileName={imageNamesBySlot[slot.id] ?? ""}
                      acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
                      maxBytes={AD_IMAGE_MAX_BYTES}
                      typeError="Use a JPG, PNG, or WebP image."
                      sizeError="Use an image under 8 MB."
                      capturePagePaste
                      onFileAccepted={(file) => selectImage(file, slot.id)}
                      onFileRejected={setError}
                      onClear={() => {
                        clearSlotImage(slot.id);
                        setError("");
                        setUploadingImage(false);
                      }}
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
                  </div>
                ))}
              </div>
              <label className="studio-newad-field">
                <span>Short description</span>
                <textarea
                  ref={descriptionRef}
                  value={description}
                  maxLength={500}
                  rows={5}
                  aria-invalid={hasDescriptionRequirement ? true : undefined}
                  aria-describedby={hasDescriptionRequirement ? requirementsAlertId : undefined}
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
              {dialogMediaAssets.length === 0 ? (
                <p className="studio-explore-msg">No library images yet.</p>
              ) : (
                <div className="studio-newad-library-grid">
                  {dialogMediaAssets.map((asset) => (
                    <button key={asset.src} type="button" onClick={() => selectLibraryImage(asset)}>
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

          {step === "brief" && mediaSourceMode === "generate" && (
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
                  placeholder="Example: Bright editorial real estate background with warm natural light, clean living room styling, space for ad text."
                />
                <small>{generatorPrompt.length}/500</small>
              </label>
              <button
                className="studio-btn accent studio-newad-generate-image"
                type="button"
                disabled={generatingImage || uploadingReference}
                onClick={() => void generateImageForAd()}
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

        <div className={`studio-newad-foot${showFooterAlert ? " has-alert" : ""}`}>
          {showFooterAlert ? (
            <div className="studio-newad-requirements" id={requirementsAlertId} role="alert" aria-live="assertive">
              <div className="studio-newad-requirements-head">
                <AlertTriangle aria-hidden size={18} />
                <strong>{footerAlertTitle}</strong>
              </div>
              {footerAlertItems.length === 1 ? (
                <p>{footerAlertItems[0]?.message}</p>
              ) : (
                <ul>
                  {footerAlertItems.map((item) => (
                    <li key={item.id}>{item.message}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <span className={error ? "studio-newad-error" : "studio-newad-sel"}>{error || footHint}</span>
          )}
          <button className="studio-btn secondary" type="button" onClick={closeCurrentView}>Close</button>
          {step === "brief" && mediaSourceMode === "details" && (
            <button className="studio-btn accent" type="button" onClick={() => void submit()} disabled={submitting} aria-describedby={showFooterAlert ? requirementsAlertId : undefined}>
              {uploadingImage ? "Uploading" : submitting ? "Generating" : "Generate ad"}
              <ArrowUpRight aria-hidden size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function imageRequirementsForTemplate(
  template: AdStudioTemplate | undefined,
  isBlank: boolean,
): TemplateImageRequirement[] {
  if (isBlank || !template) return [DEFAULT_IMAGE_SLOT];

  const byId = new Map<string, TemplateImageRequirement>();
  for (const format of FIRST_AD_FORMATS) {
    const design = template.designs?.[format];
    for (const layer of design?.layers ?? []) {
      if (layer.type !== "image_slot") continue;
      if (byId.has(layer.id)) continue;
      byId.set(layer.id, {
        id: layer.id,
        label: layer.editorLabel?.trim() || imageSlotLabel(layer.id, layer.role),
        guidance: layer.guidance,
        role: layer.role,
        required: layer.required !== false,
      });
    }
  }

  return byId.size > 0 ? Array.from(byId.values()) : [DEFAULT_IMAGE_SLOT];
}

function imageSlotLabel(id: string, role: TemplateImageRequirement["role"]): string {
  if (role === "primary") return "Primary property image";
  if (role === "agent_headshot") return "Agent headshot";
  if (id.includes("secondary")) return "Secondary property image";
  return "Supporting property image";
}

function uploadActionText(slot: TemplateImageRequirement, slotCount: number): string {
  if (slotCount <= 1) return "Upload one image";
  if (slot.role === "primary") return "Upload primary image";
  if (slot.role === "agent_headshot") return "Upload headshot";
  return "Upload supporting image";
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

function buildRequirementBlockers(input: {
  description: string;
  missingImageLabels: string[];
  uploadingImage: boolean;
}): RequirementBlocker[] {
  const blockers: RequirementBlocker[] = [];
  const trimmed = input.description.trim();

  if (!trimmed) {
    blockers.push({
      id: "missing_description",
      target: "description",
      message: "Add a short description so Blockwise knows what to write. Include the property, suburb, offer, or key selling point.",
    });
  }

  if (input.missingImageLabels.length > 0) {
    blockers.push({
      id: "missing_image",
      target: "images",
      message:
        input.missingImageLabels.length === 1
          ? `Add ${input.missingImageLabels[0]} before generating the ad. Upload a file, choose from library, or generate an image.`
          : `Add the required images before generating the ad: ${input.missingImageLabels.join(", ")}.`,
    });
  }

  if (input.uploadingImage) {
    blockers.push({
      id: "uploading_image",
      target: "upload",
      message: "Image upload is still running. Wait for it to finish, then generate the ad.",
    });
  }

  if (input.description.length > 500) {
    blockers.push({
      id: "description_too_long",
      target: "description",
      message: "Keep the short description to 500 characters or less.",
    });
  }

  return blockers;
}

function dedupeImageLibraryAssets(assets: ImageLibraryAsset[]): ImageLibraryAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.src || seen.has(asset.src)) return false;
    seen.add(asset.src);
    return true;
  });
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
.studio-newad-upload-group{display:grid;gap:14px}
.studio-newad-image-slot{display:grid;gap:8px}
.studio-newad-image-slot-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.studio-newad-image-slot-head span{display:grid;gap:3px;min-width:0}
.studio-newad-image-slot-head strong{font-size:13px;font-weight:750;color:var(--ink);line-height:1.25}
.studio-newad-image-slot-head small{font-size:12px;color:var(--muted);line-height:1.35}
.studio-newad-image-slot-head em{font-style:normal;font-size:11px;font-weight:750;color:#47627d;background:#eef4fb;border-radius:999px;padding:3px 8px;white-space:nowrap}
.studio-newad-media-actions{display:flex;gap:8px;flex-wrap:wrap}
.studio-newad-media-actions button{min-height:36px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;padding:0 12px;font-size:12.5px;font-weight:650;box-shadow:var(--st-sh-1);cursor:pointer}
.studio-newad-media-actions button:hover{background:var(--accent-tint);border-color:#cfe0f3;color:var(--accent)}
.studio-newad-library,.studio-newad-generator{display:grid;gap:14px}
.studio-newad-library-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.studio-newad-library-grid button{min-width:0;border:1px solid var(--line-soft);border-radius:8px;background:#fff;padding:8px;text-align:left;display:grid;gap:8px;box-shadow:var(--st-sh-1);cursor:pointer}
.studio-newad-library-grid button:hover{box-shadow:var(--st-sh-lift)}
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
  .studio-newad-library-grid,.studio-newad-generated-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:560px){
  .studio-explore-grid{grid-template-columns:1fr}
  .studio-explore-thumb{height:220px}
  .studio-explore-thumb--sample{height:320px}
  .studio-newad-library-grid,.studio-newad-generated-grid{grid-template-columns:1fr}
}
`;
// NewAdDialog: Templates pop-up with Templates, Previous ads, and Ad Radar tabs.
