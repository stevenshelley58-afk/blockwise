"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Image as ImageIcon, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import type { AdStudioBrandKit, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
import { resolveAdvertiserDomain } from "@/lib/adstudio/advertiser-domain";
import { templatePreviewDataUrl } from "@/lib/adstudio/template-preview.ts";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";
import { briefGuidanceForTemplate } from "./new-ad-dialog-brief";
import {
  DEFAULT_IMAGE_SLOT,
  customerCopyFieldsForTemplate,
  defaultImageForTemplateSlot,
  defaultImageLabelForTemplateSlot,
  defaultTextForTemplateField,
  imageRequirementsForTemplate,
  type TemplateCopyRequirement,
  type TemplateImageRequirement,
} from "./new-ad-dialog-slots";

type Step = "source" | "brief";
type TemplateFilter = "all" | "listings" | "appraisals" | "market" | "sold";
type MediaSourceMode = "details" | "library";
type GenerationQuality = NonNullable<FirstAdInput["generationQuality"]>;
type ImageLibraryAsset = {
  src: string;
  label: string;
  type?: string;
  ratio?: string;
  role?: string;
};
type RequirementBlockerTarget = "description" | "images" | "upload";
type RequirementBlocker = {
  id: string;
  message: string;
  target?: RequirementBlockerTarget;
};

const FIRST_AD_FORMATS: FirstAdInput["formats"] = ["9:16", "4:5"];

const TEMPLATE_FILTERS: ReadonlyArray<{ id: TemplateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "listings", label: "Listings" },
  { id: "appraisals", label: "Appraisals" },
  { id: "market", label: "Market updates" },
  { id: "sold", label: "Sold & nurture" },
];

type TrialStatus = {
  isTrial: boolean;
  includedAdPacks: number;
};

type NewAdDialogProps = {
  open: boolean;
  onClose: () => void;
  brandKit: AdStudioBrandKit;
  workspaceId: string;
  templates: AdStudioTemplate[];
  mediaAssets?: ImageLibraryAsset[];
  onGenerate: (input: FirstAdInput) => Promise<void>;
  /** Open directly on a selected gallery sample. */
  initialTemplateId?: string;
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

function templatePreviewSrc(template: AdStudioTemplate, brandKit: AdStudioBrandKit): string {
  return templatePreviewDataUrl(template, brandKit);
}

type TemplateAdCopy = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

function TemplateChoiceCard({
  template,
  brandKit,
  onSelect,
}: {
  template: AdStudioTemplate;
  brandKit: AdStudioBrandKit;
  onSelect: (id: string) => void;
}) {
  const isFullscreen = template.format === "9:16";
  const placementLabel = isFullscreen ? "Fullscreen ad" : "Feed ad";

  return (
    <button
      type="button"
      className={`studio-explore-card studio-explore-card--template${isFullscreen ? " studio-explore-card--fullscreen" : " studio-explore-card--feed"}`}
      aria-label={`Use ${template.name} ${placementLabel.toLowerCase()} template`}
      onClick={() => onSelect(template.id)}
    >
      <span className="studio-explore-card-head">
        <span>
          <strong>{template.name}</strong>
          <small>{placementLabel}</small>
        </span>
      </span>
      <TemplateAdPreview template={template} brandKit={brandKit} />
      <span className="studio-explore-card-action">
        <span>Use this template</span>
        <ArrowUpRight aria-hidden size={15} />
      </span>
    </button>
  );
}

function TemplateAdPreview({ template, brandKit }: { template: AdStudioTemplate; brandKit: AdStudioBrandKit }) {
  const previewSrc = templatePreviewSrc(template, brandKit);
  const copy = templateAdCopy(template);
  const brandName = brandNameForPreview(brandKit);
  const brandInitial = initialForBrand(brandName);
  const domain = domainForPreview(brandKit);
  const isFullscreen = template.format === "9:16";

  if (isFullscreen) {
    return (
      <span className="studio-template-ad studio-template-ad--fullscreen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="studio-template-story-media" src={previewSrc} alt="" loading="lazy" decoding="async" />
        <span className="studio-template-story-shade" />
        <span className="studio-template-story-bars" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="studio-template-story-top">
          <span className="studio-template-avatar">{brandInitial}</span>
          <span>
            <strong>{brandName}</strong>
            <small>Sponsored</small>
          </span>
        </span>
        <span className="studio-template-story-copy">
          <strong>{copy.headline}</strong>
          <span>{copy.primaryText}</span>
        </span>
        <span className="studio-template-story-cta">{copy.cta}</span>
      </span>
    );
  }

  return (
    <span className="studio-template-ad studio-template-ad--feed">
      <span className="studio-template-feed-head">
        <span className="studio-template-avatar">{brandInitial}</span>
        <span>
          <strong>{brandName}</strong>
          <small>Sponsored</small>
        </span>
        <span className="studio-template-dots" aria-hidden>...</span>
      </span>
      <span className="studio-template-feed-primary">{copy.primaryText}</span>
      <span className="studio-template-feed-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewSrc} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="studio-template-feed-link">
        <span>
          <small>{domain}</small>
          <strong>{copy.headline}</strong>
          {copy.description ? <em>{copy.description}</em> : null}
        </span>
        <span className="studio-template-feed-cta">{copy.cta}</span>
      </span>
    </span>
  );
}

function templateAdCopy(template: AdStudioTemplate): TemplateAdCopy {
  const headline = cleanText(template.meta.headlines[0]) || template.name;
  const primaryText = cleanText(template.meta.primaryText[0]) || template.audienceIntent;
  const description = cleanText(template.meta.descriptions[0]);
  const cta = metaCtaLabel(template.meta.cta);

  return { headline, primaryText, description, cta };
}

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function metaCtaLabel(value: string | undefined): string {
  switch (value) {
    case "CONTACT_US":
      return "Contact us";
    case "DOWNLOAD":
      return "Download";
    case "SIGN_UP":
      return "Sign up";
    case "LEARN_MORE":
    default:
      return "Learn more";
  }
}

function brandNameForPreview(brandKit: AdStudioBrandKit): string {
  return brandKit.identity.tradingName || brandKit.identity.businessName || "Your agency";
}

function initialForBrand(brandName: string): string {
  return (brandName.trim().charAt(0) || "B").toUpperCase();
}

function domainForPreview(brandKit: AdStudioBrandKit): string {
  return resolveAdvertiserDomain({ brandKit }).host;
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
}: NewAdDialogProps) {
  const titleId = useId();
  const requirementsAlertId = useId();
  const copyFieldsTitleId = useId();
  const copyFieldIdPrefix = useId();
  const descriptionInputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const latestMediaAssetsRef = useRef(mediaAssets);
  const [step, setStep] = useState<Step>("source");
  const [filter, setFilter] = useState<TemplateFilter>("all");
  // Nothing can be created until the customer chooses the sample to clone.
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [generationQuality, setGenerationQuality] = useState<GenerationQuality>("fast");
  const [imageDataUrlsBySlot, setImageDataUrlsBySlot] = useState<Record<string, string>>({});
  const [imageNamesBySlot, setImageNamesBySlot] = useState<Record<string, string>>({});
  const [onImageCopy, setOnImageCopy] = useState<Record<string, string>>({});
  const [activeImageSlotId, setActiveImageSlotId] = useState(DEFAULT_IMAGE_SLOT.id);
  const [mediaSourceMode, setMediaSourceMode] = useState<MediaSourceMode>("details");
  const [dialogMediaAssets, setDialogMediaAssets] = useState<ImageLibraryAsset[]>([]);
  const [error, setError] = useState("");
  const [showRequirementsAlert, setShowRequirementsAlert] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [trialCreditNote, setTrialCreditNote] = useState("Uses one ad pack. No Meta account is needed until publish.");

  const selectedTemplate = templates.find((template) => template.id === templateId);
  const imageRequirements = useMemo(
    () => imageRequirementsForTemplate(selectedTemplate),
    [selectedTemplate],
  );
  // Fields the customer types verbatim (price, address, phone...) — rendered
  // as explicit inputs so the copy model never has to invent facts.
  const customerCopyFields = useMemo(
    () => customerCopyFieldsForTemplate(selectedTemplate),
    [selectedTemplate],
  );
  const primaryImageSlot = imageRequirements.find((slot) => slot.required) ?? imageRequirements[0] ?? DEFAULT_IMAGE_SLOT;
  const activeImageSlot = imageRequirements.find((slot) => slot.id === activeImageSlotId) ?? primaryImageSlot;
  const imageDataUrls = useMemo(
    () => imageRequirements.reduce<Record<string, string>>((values, slot) => {
      const src = imageDataUrlsBySlot[slot.id] ?? defaultImageForTemplateSlot(slot, brandKit);
      if (src) values[slot.id] = src;
      return values;
    }, {}),
    [brandKit, imageDataUrlsBySlot, imageRequirements],
  );
  const imageDataUrl = imageDataUrls[primaryImageSlot.id] ?? "";
  const missingImageLabels = useMemo(
    () => imageRequirements
      .filter((slot) => slot.required && !imageDataUrls[slot.id])
      .map((slot) => slot.label),
    [imageDataUrls, imageRequirements],
  );
  const missingCopyLabels = useMemo(
    () => customerCopyFields.filter((field) => field.required && !onImageCopy[field.key]?.trim()).map((field) => field.label),
    [customerCopyFields, onImageCopy],
  );
  const requirementBlockers = buildRequirementBlockers({
    description,
    missingImageLabels,
    missingCopyLabels,
    uploadingImage,
  });
  const visibleRequirementBlockers = showRequirementsAlert ? requirementBlockers : [];
  const hasDescriptionRequirement = visibleRequirementBlockers.some((blocker) => blocker.target === "description");
  const detailsErrorMessage = step === "brief" && mediaSourceMode === "details" ? error : "";
  const briefGuidance = briefGuidanceForTemplate(selectedTemplate);
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
    setFilter("all");
    setDescription("");
    setGenerationQuality("fast");
    // The customer supplies every declared image and text field. The selected
    // sample is only the visual anchor sent to the image model.
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    const initialTemplate = templates.find((template) => template.id === initialTemplateId);
    setOnImageCopy(brandTextDefaultsForTemplate(initialTemplate, brandKit));
    setActiveImageSlotId(DEFAULT_IMAGE_SLOT.id);
    setDialogMediaAssets(dedupeImageLibraryAssets(latestMediaAssetsRef.current));
    setMediaSourceMode("details");
    setError("");
    setShowRequirementsAlert(false);
    setUploadingImage(false);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, initialTemplateId]);

  useEffect(() => {
    latestMediaAssetsRef.current = mediaAssets;
    if (!open) return;
    setDialogMediaAssets((current) => dedupeImageLibraryAssets([...current, ...mediaAssets]));
  }, [mediaAssets, open]);

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

  if (!open) return null;

  const visibleTemplates = templates.filter((template) => {
    if (filter === "all") return true;
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
    const template = templates.find((candidate) => candidate.id === id);
    if (!template) return;
    preloadTemplateReference(template.sample.imageSrc);
    setTemplateId(id);
    setError("");
    setShowRequirementsAlert(false);
    // Inputs reset whenever the customer chooses a different sample.
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    setOnImageCopy(brandTextDefaultsForTemplate(template, brandKit));
    setActiveImageSlotId(DEFAULT_IMAGE_SLOT.id);
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

  function selectLibraryImage(asset: ImageLibraryAsset) {
    setSlotImage(activeImageSlot.id, asset.src, asset.label);
    setMediaSourceMode("details");
    setError("");
  }

  function useCopyExample(field: TemplateCopyRequirement) {
    setOnImageCopy((current) => ({ ...current, [field.key]: field.sample }));
    setShowRequirementsAlert(false);
  }

  function fillEmptyCopyFieldsWithExamples() {
    setOnImageCopy((current) => ({
      ...current,
      ...Object.fromEntries(
        customerCopyFields
          .filter((field) => !current[field.key]?.trim())
          .map((field) => [field.key, field.sample]),
      ),
    }));
    setShowRequirementsAlert(false);
  }

  function useBriefExample() {
    setDescription(briefGuidance.placeholder.replace(/^Example:\s*/u, ""));
    setShowRequirementsAlert(false);
  }

  async function submit() {
    const trimmed = description.trim();
    const blockers = buildRequirementBlockers({ description, missingImageLabels, missingCopyLabels, uploadingImage });
    if (blockers.length > 0) {
      setShowRequirementsAlert(true);
      setError("");
      if (blockers.some((blocker) => blocker.target === "description")) {
        window.setTimeout(() => descriptionRef.current?.focus(), 0);
      }
      return;
    }

    if (!selectedTemplate) {
      setError("Choose a template first.");
      setStep("source");
      return;
    }

    setSubmitting(true);
    setError("");
    setShowRequirementsAlert(false);
    try {
      await onGenerate({
        source: "gallery",
        templateId: selectedTemplate.id,
        description: trimmed,
        generationQuality,
        imageDataUrl,
        imageDataUrls,
        onImageCopy: Object.fromEntries(
          Object.entries(onImageCopy)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value),
        ),
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
      ? "Choose a template"
      : mediaSourceMode === "library"
        ? "Choose from library"
        : `${selectedTemplate?.name ?? "Template"} - add your assets`;

  const footHint =
    mediaSourceMode === "library"
      ? `Select an image for ${activeImageSlot.label}.`
      : "Blockwise will create your ad from the selected template, using your images and text.";
  const showFooter = step === "brief";

  return (
    <div className="studio-newad-overlay" onMouseDown={(event) => event.target === event.currentTarget && closeCurrentView()}>
      <style>{EXPLORE_STYLES}</style>
      <div
        ref={dialogRef}
        className="studio-newad"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={submitting}
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
            {mediaSourceMode === "library" ? (
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
              <p className="studio-explore-intro">Choose a template. The next step asks only for the images and exact text it requires.</p>
              <div className="studio-explore-filterbar">
                <label className="studio-explore-filter">
                  <span>Category</span>
                  <select value={filter} onChange={(event) => setFilter(event.target.value as TemplateFilter)}>
                    {TEMPLATE_FILTERS.map((chip) => (
                      <option key={chip.id} value={chip.id}>{chip.label}</option>
                    ))}
                  </select>
                </label>
                <span className="studio-explore-count">{visibleTemplates.length} {visibleTemplates.length === 1 ? "template" : "templates"}</span>
              </div>
              <div className="studio-explore-grid">
                {visibleTemplates.length === 0 ? (
                  <p className="studio-explore-msg">No templates are available in this category yet.</p>
                ) : null}
                {visibleTemplates.map((template) => (
                  <TemplateChoiceCard key={template.id} template={template} brandKit={brandKit} onSelect={chooseTemplate} />
                ))}
              </div>
            </div>
          )}

          {step === "brief" && mediaSourceMode === "details" && (
            <div className="studio-newad-own">
              <p className="studio-newad-note">{briefGuidance.note} {trialCreditNote}</p>
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
                      previewUrl={imageDataUrlsBySlot[slot.id] ?? defaultImageForTemplateSlot(slot, brandKit)}
                      previewAlt=""
                      fileName={imageNamesBySlot[slot.id] ?? defaultImageLabelForTemplateSlot(slot, brandKit)}
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
                    </div>
                  </div>
                ))}
              </div>
              {customerCopyFields.length > 0 && (
                <section className="studio-newad-copyfields" aria-labelledby={copyFieldsTitleId}>
                  <div className="studio-newad-copyfields-head">
                    <span>
                      <strong id={copyFieldsTitleId}>Text on the ad</strong>
                      <small>Brand details are filled from your Brand Pack when available. Listing details stay blank.</small>
                    </span>
                    <button type="button" onClick={fillEmptyCopyFieldsWithExamples}>Fill empty fields with examples</button>
                  </div>
                  <div className="studio-newad-copyfields-list">
                    {customerCopyFields.map((field) => {
                      const inputId = `${copyFieldIdPrefix}-${field.key}`;
                      const brandDefault = defaultTextForTemplateField(field, brandKit);
                      const isBrandPrefilled = Boolean(brandDefault && onImageCopy[field.key] === brandDefault);
                      return (
                        <div className="studio-newad-field" key={field.key}>
                          <div className="studio-newad-field-head">
                            <label htmlFor={inputId}>
                              {field.label}
                              <small>Appears exactly as typed</small>
                            </label>
                            <span className="studio-newad-field-actions">
                              {isBrandPrefilled ? <em>From Brand Pack</em> : null}
                              <button type="button" onClick={() => useCopyExample(field)}>Use example</button>
                            </span>
                          </div>
                          <input
                            id={inputId}
                            type="text"
                            value={onImageCopy[field.key] ?? ""}
                            maxLength={Math.min(field.maxLength, 200)}
                            placeholder={field.sample}
                            onChange={(event) => {
                              setShowRequirementsAlert(false);
                              setOnImageCopy((current) => ({ ...current, [field.key]: event.target.value }));
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              <div className="studio-newad-field studio-newad-brief-field">
                <div className="studio-newad-field-head">
                  <label htmlFor={descriptionInputId}>{briefGuidance.fieldLabel}</label>
                  <button type="button" onClick={useBriefExample}>Use example brief</button>
                </div>
                <textarea
                  id={descriptionInputId}
                  ref={descriptionRef}
                  value={description}
                  maxLength={500}
                  rows={5}
                  aria-invalid={hasDescriptionRequirement ? true : undefined}
                  aria-describedby={hasDescriptionRequirement ? requirementsAlertId : undefined}
                  onChange={(event) => {
                    setShowRequirementsAlert(false);
                    setDescription(event.target.value);
                  }}
                  placeholder={briefGuidance.placeholder}
                />
                <small className="studio-newad-field-help">{briefGuidance.helperText}</small>
                <small className="studio-newad-field-count">{description.length}/500</small>
              </div>
              <fieldset className="studio-newad-quality">
                <legend>Generation quality</legend>
                <div className="studio-newad-quality-options">
                  <label className={generationQuality === "fast" ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="generation-quality"
                      value="fast"
                      checked={generationQuality === "fast"}
                      onChange={() => setGenerationQuality("fast")}
                    />
                    <span>
                      <strong>Fast</strong>
                      <small>Usually ready in about 1 minute</small>
                    </span>
                    <em>Recommended</em>
                  </label>
                  <label className={generationQuality === "high" ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="generation-quality"
                      value="high"
                      checked={generationQuality === "high"}
                      onChange={() => setGenerationQuality("high")}
                    />
                    <span>
                      <strong>High quality</strong>
                      <small>Usually ready in about 2–3 minutes</small>
                    </span>
                  </label>
                </div>
              </fieldset>
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

        </div>

        {showFooter && (
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
              <span
                className={error ? "studio-newad-error" : "studio-newad-sel"}
                role="status"
                aria-live="polite"
              >
                {submitting
                  ? generationQuality === "fast"
                    ? "Creating your ad. Fast ads are usually ready in under a minute."
                    : "Creating your high-quality ad. This usually takes 2–3 minutes."
                  : error || footHint}
              </span>
            )}
            <button className="studio-btn secondary" type="button" onClick={closeCurrentView}>Close</button>
            {step === "brief" && mediaSourceMode === "details" && (
              <button className="studio-btn accent" type="button" onClick={() => void submit()} disabled={submitting} aria-describedby={showFooterAlert ? requirementsAlertId : undefined}>
                {uploadingImage ? "Uploading" : submitting ? "Creating ad" : "Generate ad"}
                <ArrowUpRight aria-hidden size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function brandTextDefaultsForTemplate(
  template: AdStudioTemplate | undefined,
  brandKit: AdStudioBrandKit,
): Record<string, string> {
  return Object.fromEntries(
    customerCopyFieldsForTemplate(template)
      .map((field) => [field.key, defaultTextForTemplateField(field, brandKit)] as const)
      .filter(([, value]) => value),
  );
}

function uploadActionText(slot: TemplateImageRequirement, slotCount: number): string {
  if (slotCount <= 1) return "Upload one image";
  if (slot.role === "primary") return "Upload primary image";
  if (slot.role === "agent_headshot") return "Upload headshot";
  return "Upload supporting image";
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
  missingCopyLabels?: string[];
  uploadingImage: boolean;
}): RequirementBlocker[] {
  const blockers: RequirementBlocker[] = [];
  const trimmed = input.description.trim();

  if (input.missingCopyLabels && input.missingCopyLabels.length > 0) {
    blockers.push({
      id: "missing_copy_fields",
      target: "description",
      message:
        input.missingCopyLabels.length === 1
          ? `Fill in ${input.missingCopyLabels[0]} — it appears on the ad exactly as you type it.`
          : `Fill in ${input.missingCopyLabels.join(", ")} — these appear on the ad exactly as you type them.`,
    });
  }

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
          ? `Add ${input.missingImageLabels[0]} before generating the ad. Upload a file or choose one from your library.`
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

function preloadTemplateReference(src: string): void {
  if (!src || typeof document === "undefined") return;
  const absoluteSrc = new URL(src, document.baseURI).href;
  const alreadyLoaded = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'))
    .some((link) => link.href === absoluteSrc);
  if (alreadyLoaded) return;

  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = absoluteSrc;
  document.head.appendChild(link);
}

const EXPLORE_STYLES = `
.studio-explore{display:grid;gap:14px}
.studio-explore-intro{margin:0;color:var(--muted);font-size:13.5px;line-height:1.5}
.studio-explore-filterbar{display:flex;align-items:center;justify-content:space-between;gap:12px}
.studio-explore-filter{display:inline-flex;align-items:center;gap:8px;min-width:0}
.studio-explore-filter span{font-size:12px;font-weight:700;color:var(--muted)}
.studio-explore-filter select{min-width:150px}
.studio-explore-count{flex:0 0 auto;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.studio-explore-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;align-items:stretch}
.studio-explore-card{display:flex;min-width:0;flex-direction:column;border:1px solid var(--line-soft);border-radius:14px;background:#fff;box-shadow:var(--st-sh-1);overflow:hidden;color:var(--ink);font:inherit;text-align:left;transition:transform .15s,box-shadow .15s,border-color .15s}
button.studio-explore-card{padding:0;cursor:pointer}
.studio-explore-card:hover{transform:translateY(-2px);box-shadow:var(--st-sh-lift)}
.studio-explore-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.studio-explore-card--template{border-color:#d9e2ed;background:#fff}
.studio-explore-card--template:hover{border-color:#b9c7d8}
.studio-explore-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 12px 10px;border-bottom:1px solid var(--line-soft)}
.studio-explore-card-head>span:first-child{display:grid;gap:2px;min-width:0}
.studio-explore-card-head strong{font-size:13.5px;font-weight:760;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-explore-card-head small{font-size:11.5px;font-weight:700;color:var(--muted);line-height:1.1}
.studio-explore-card-action{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;border-top:1px solid var(--line-soft);padding:11px 12px;color:#001b3d;font-size:13px;font-weight:760}
.studio-explore-card-action svg{flex:0 0 auto}
.studio-template-ad{display:block;min-width:0}
.studio-template-avatar{flex:0 0 auto;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#123e75;color:#fff;font-size:12px;font-weight:800}
.studio-template-ad--feed{background:#fff}
.studio-template-feed-head{display:flex;align-items:center;gap:8px;padding:10px 11px 7px}
.studio-template-feed-head>span:nth-child(2){display:grid;gap:1px;min-width:0}
.studio-template-feed-head strong{font-size:12.5px;font-weight:760;line-height:1.12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-feed-head small{font-size:10.5px;color:#64748b;line-height:1.1}
.studio-template-dots{margin-left:auto;color:#64748b;font-size:18px;line-height:1;letter-spacing:0}
.studio-template-feed-primary{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;padding:0 11px 9px;color:#111827;font-size:12px;line-height:1.35}
.studio-template-feed-media{display:block;background:#f1f5f9;border-top:1px solid #edf1f6;border-bottom:1px solid #edf1f6}
.studio-template-feed-media img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.studio-template-feed-link{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 11px;background:#f2f3f5}
.studio-template-feed-link>span:first-child{display:grid;gap:2px;min-width:0}
.studio-template-feed-link small{font-size:9.5px;text-transform:uppercase;color:#64748b;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-feed-link strong{font-size:12.5px;font-weight:760;line-height:1.14;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.studio-template-feed-link em{font-style:normal;font-size:11px;color:#64748b;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-feed-cta{flex:0 0 auto;border-radius:6px;background:#e4e6eb;color:#172033;font-size:11.5px;font-weight:760;padding:7px 10px;white-space:nowrap}
.studio-template-ad--fullscreen{position:relative;aspect-ratio:9/16;margin:12px;border-radius:13px;overflow:hidden;background:#0b1020;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12),0 14px 28px rgba(15,23,42,.18)}
.studio-template-story-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.studio-template-story-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,7,18,.56) 0%,rgba(3,7,18,.06) 38%,rgba(3,7,18,.76) 100%)}
.studio-template-story-bars{position:absolute;left:10px;right:10px;top:9px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.studio-template-story-bars i{display:block;height:2px;border-radius:999px;background:rgba(255,255,255,.6)}
.studio-template-story-top{position:absolute;left:11px;right:11px;top:18px;display:flex;align-items:center;gap:8px}
.studio-template-story-top .studio-template-avatar{width:26px;height:26px;background:rgba(255,255,255,.94);color:#111827}
.studio-template-story-top>span:nth-child(2){display:grid;gap:1px;min-width:0;text-shadow:0 1px 4px rgba(0,0,0,.45)}
.studio-template-story-top strong{font-size:11.5px;font-weight:760;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-story-top small{font-size:9.5px;color:rgba(255,255,255,.78);line-height:1.1}
.studio-template-story-copy{position:absolute;left:13px;right:13px;bottom:60px;display:grid;gap:6px;text-shadow:0 2px 10px rgba(0,0,0,.55)}
.studio-template-story-copy strong{font-size:19px;font-weight:820;line-height:1.04;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.studio-template-story-copy span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:11.5px;line-height:1.32;color:rgba(255,255,255,.9)}
.studio-template-story-cta{position:absolute;left:13px;right:13px;bottom:13px;min-height:34px;border-radius:999px;background:rgba(255,255,255,.95);color:#101827;display:grid;place-items:center;font-size:12px;font-weight:800;box-shadow:0 8px 18px rgba(0,0,0,.22)}
.studio-explore-thumb{position:relative;height:236px;display:grid;place-items:center;overflow:hidden;background:#eef2f7}
.studio-explore-thumb--sample{height:326px;background:linear-gradient(180deg,#f8fafc 0%,#e8edf4 100%)}
.studio-explore-thumb img{max-width:calc(100% - 24px);max-height:calc(100% - 20px);object-fit:contain;background:#fff;border-radius:12px;box-shadow:0 14px 34px rgba(15,23,42,.18);display:block}
.studio-explore-ph{display:grid;justify-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:0;color:rgba(15,23,42,.35)}
.studio-explore-meta{display:flex;flex-direction:column;gap:7px;padding:14px;flex:1}
.studio-explore-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.studio-explore-row strong{font-size:14.5px;font-weight:700;line-height:1.22;letter-spacing:0}
.studio-explore-row svg{color:var(--muted);flex:0 0 auto;margin-top:2px}
.studio-explore-meta p{margin:0;font-size:12.5px;color:var(--muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.studio-explore-use{margin-top:auto;align-self:flex-start;border:0;border-radius:9px;background:#001b3d;color:#fff;font-weight:650;font-size:13px;padding:9px 16px;cursor:pointer;transition:background .15s}
.studio-explore-use:hover{background:#0a2c55}
.studio-explore-msg{grid-column:1/-1;margin:0;border-radius:12px;background:#fff;box-shadow:var(--st-sh-1);padding:18px;color:var(--muted);font-size:13.5px;line-height:1.5}
.studio-explore-msg a{color:var(--accent);font-weight:650}
.studio-newad-upload-group{display:grid;gap:14px}
.studio-newad-copyfields{display:grid;gap:14px;border-top:1px solid var(--line-soft);padding-top:18px}
.studio-newad-copyfields-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.studio-newad-copyfields-head>span{display:grid;gap:4px;min-width:0;max-width:68ch}
.studio-newad-copyfields-head strong{font-size:15px;font-weight:760;line-height:1.3;color:var(--ink)}
.studio-newad-copyfields-head small{font-size:12.5px;line-height:1.45;color:var(--muted)}
.studio-newad-copyfields-head button,.studio-newad-field-head>button,.studio-newad-field-actions button{min-height:44px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink);font:inherit;font-size:12.5px;font-weight:700;padding:0 14px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.studio-newad-copyfields-head button:hover,.studio-newad-field-head>button:hover,.studio-newad-field-actions button:hover{background:var(--accent-tint);border-color:#c8d4e2;color:var(--accent)}
.studio-newad-copyfields-head button:focus-visible,.studio-newad-field-head>button:focus-visible,.studio-newad-field-actions button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.studio-newad-copyfields-list{display:grid;gap:14px}
.studio-newad-field{display:grid;gap:7px;min-width:0}
.studio-newad-field-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.studio-newad-field-head label{display:flex;align-items:baseline;gap:6px;min-width:0;color:var(--ink);font-size:13px;font-weight:750;line-height:1.35}
.studio-newad-field-head label small{color:var(--muted);font-size:12px;font-weight:500}
.studio-newad-field-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.studio-newad-field-actions em{font-style:normal;border-radius:999px;background:#f1f2f4;color:#3f4651;font-size:11.5px;font-weight:700;padding:5px 9px;white-space:nowrap}
.studio-newad-field input,.studio-newad-field textarea{width:100%;min-width:0;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:15px;line-height:1.45;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
.studio-newad-field input{min-height:44px;padding:0 12px}
.studio-newad-field textarea{resize:vertical;min-height:116px;padding:11px 12px}
.studio-newad-field input::placeholder,.studio-newad-field textarea::placeholder{color:#545a66;opacity:1}
.studio-newad-field input:hover,.studio-newad-field textarea:hover{border-color:#b8bec9}
.studio-newad-field input:focus-visible,.studio-newad-field textarea:focus-visible{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(22,24,29,.14)}
.studio-newad-field textarea[aria-invalid="true"]{border-color:#ba1a1a}
.studio-newad-field-help{color:var(--muted);font-size:12px;line-height:1.4}
.studio-newad-field-count{justify-self:end;color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.studio-newad-brief-field{border-top:1px solid var(--line-soft);padding-top:18px}
.studio-newad-quality{display:grid;gap:9px;margin:0;border:0;border-top:1px solid var(--line-soft);padding:18px 0 0;min-width:0}
.studio-newad-quality legend{padding:0;color:var(--ink);font-size:13px;font-weight:750;line-height:1.35}
.studio-newad-quality-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.studio-newad-quality-options label{position:relative;display:flex;align-items:center;gap:10px;min-height:66px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:10px 12px;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
.studio-newad-quality-options label:hover{border-color:#b8bec9;background:var(--accent-tint)}
.studio-newad-quality-options label.is-selected{border-color:var(--ink);background:#f6f7f9;box-shadow:0 0 0 1px var(--ink)}
.studio-newad-quality-options label:focus-within{outline:0;box-shadow:0 0 0 3px rgba(22,24,29,.14)}
.studio-newad-quality-options input{width:18px;height:18px;flex:0 0 auto;accent-color:var(--ink)}
.studio-newad-quality-options span{display:grid;gap:3px;min-width:0}
.studio-newad-quality-options strong{color:var(--ink);font-size:13px;font-weight:750;line-height:1.2}
.studio-newad-quality-options small{color:var(--muted);font-size:11.5px;line-height:1.35}
.studio-newad-quality-options em{margin-left:auto;border-radius:999px;background:var(--ink);color:#fff;padding:4px 7px;font-size:10.5px;font-style:normal;font-weight:700;white-space:nowrap}
.studio-newad-image-slot{display:grid;gap:8px}
.studio-newad-image-slot-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.studio-newad-image-slot-head span{display:grid;gap:3px;min-width:0}
.studio-newad-image-slot-head strong{font-size:13px;font-weight:750;color:var(--ink);line-height:1.25}
.studio-newad-image-slot-head small{font-size:12px;color:var(--muted);line-height:1.35}
.studio-newad-image-slot-head em{font-style:normal;font-size:11px;font-weight:750;color:#47627d;background:#eef4fb;border-radius:999px;padding:3px 8px;white-space:nowrap}
.studio-newad-media-actions{display:flex;gap:8px;flex-wrap:wrap}
.studio-newad-media-actions button{min-height:44px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;padding:0 12px;font-size:12.5px;font-weight:650;box-shadow:var(--st-sh-1);cursor:pointer}
.studio-newad-media-actions button:hover{background:var(--accent-tint);border-color:#cfe0f3;color:var(--accent)}
.studio-newad-library{display:grid;gap:14px}
.studio-newad-library-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.studio-newad-library-grid button{min-width:0;border:1px solid var(--line-soft);border-radius:8px;background:#fff;padding:8px;text-align:left;display:grid;gap:8px;box-shadow:var(--st-sh-1);cursor:pointer}
.studio-newad-library-grid button:hover{box-shadow:var(--st-sh-lift)}
.studio-newad-library-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;background:#eef2f7;display:block}
.studio-newad-library-grid span{display:grid;gap:2px;min-width:0}
.studio-newad-library-grid strong{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-newad-library-grid small{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media(max-width:900px){
  .studio-explore-grid{grid-template-columns:repeat(2,1fr);gap:12px}
  .studio-explore-thumb{height:210px}
  .studio-explore-thumb--sample{height:286px}
  .studio-newad-library-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:560px){
  .studio-explore-filterbar{gap:8px}
  .studio-explore-filter{flex:1}
  .studio-explore-filter select{min-width:0;width:100%}
  .studio-explore-grid{grid-template-columns:1fr}
  .studio-explore-thumb{height:220px}
  .studio-explore-thumb--sample{height:320px}
  .studio-newad-library-grid{grid-template-columns:1fr}
  .studio-newad-copyfields-head,.studio-newad-field-head{align-items:stretch;flex-direction:column}
  .studio-newad-copyfields-head button{width:100%;white-space:normal}
  .studio-newad-field-actions{justify-content:space-between;width:100%}
  .studio-newad-field-head label{align-items:flex-start;flex-direction:column;gap:2px}
  .studio-newad-field-head>button{width:100%}
  .studio-newad-quality-options{grid-template-columns:1fr}
}
`;
// NewAdDialog: choose one gallery sample, then provide its declared assets.
