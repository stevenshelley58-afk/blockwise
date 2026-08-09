"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Image as ImageIcon, Sparkles, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AdStudioBrandKit, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
import { resolveAdvertiserDomain } from "@/lib/adstudio/advertiser-domain";
import { isAdStudioImageSrc, isTransientImagePreview } from "@/lib/adstudio/image-src.ts";
import { templatePreviewDataUrl } from "@/lib/adstudio/template-preview.ts";
import { templateThumbnailSrcSet } from "@/lib/adstudio/template-display.ts";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";
import { GenerationProgress } from "./generation-progress";
import { briefGuidanceForTemplate } from "./new-ad-dialog-brief";
import {
  DEFAULT_IMAGE_SLOT,
  customerCopyFieldsForTemplate,
  defaultImageForTemplateSlot,
  defaultImageLabelForTemplateSlot,
  defaultTextForTemplateField,
  hasPendingImageUploads,
  imageRequirementsForTemplate,
  updatePendingImageUploads,
  type TemplateCopyRequirement,
  type TemplateImageRequirement,
} from "./new-ad-dialog-slots";

type Step = "source" | "brief";
type TemplateFilter = "all" | "listings" | "appraisals" | "market" | "sold";
type MediaSourceMode = "details" | "library";
type GenerationQuality = NonNullable<FirstAdInput["generationQuality"]>;
type ColourSource = NonNullable<FirstAdInput["colourSource"]>;
type ImageLibraryAsset = {
  /** Signed/downscaled URL used for the grid thumbnail. */
  src: string;
  /**
   * The source actually sent to the generator when this asset is picked. For a
   * stored asset that is the durable `/api/adstudio/media?path=` proxy, not the
   * expiring 640px render behind `src` — see `library-read-model.ts`.
   */
  fullSrc: string;
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

/**
 * Point 10 — editable Meta feed copy (the text shown around the ad image).
 * Char limits mirror ADSTUDIO_COPY_LIMITS on the server so the UI never lets a
 * customer type past what the pipeline would keep. Kept client-local because
 * copy-generation.ts is server-only (node:crypto, providers).
 */
type FeedCopy = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};
const EMPTY_FEED_COPY: FeedCopy = { primaryText: "", headline: "", description: "", cta: "" };
const FEED_COPY_LIMITS: Record<keyof FeedCopy, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 19,
};
type FeedCopyFieldKey = keyof FeedCopy;
const FEED_COPY_FIELDS: ReadonlyArray<{ key: FeedCopyFieldKey; label: string; hint: string; multiline?: boolean }> = [
  { key: "headline", label: "Headline", hint: "Shown next to the button" },
  { key: "primaryText", label: "Primary text", hint: "The main caption above the image", multiline: true },
  { key: "description", label: "Description", hint: "A short supporting line" },
  { key: "cta", label: "Call to action", hint: "The button label" },
];

type CopyMode = "ai" | "write";
const COPY_MODES: ReadonlyArray<{ id: CopyMode; label: string }> = [
  { id: "ai", label: "Help me write it" },
  { id: "write", label: "I'll write it myself" },
];

/**
 * Every Meta CTA option that survives the server's 24-char clamp
 * (src/lib/adstudio/copy-generation.ts). The preview renders the same label
 * that Ad Studio's publish flow shows on the button.
 */
const FEED_COPY_CTA_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "LEARN_MORE", label: "Learn more" },
  { value: "CONTACT_US", label: "Contact us" },
  { value: "SIGN_UP", label: "Sign up" },
  { value: "DOWNLOAD", label: "Download" },
  { value: "GET_QUOTE", label: "Get quote" },
  { value: "BOOK_NOW", label: "Book now" },
];
const TEMPLATE_FILTERS: ReadonlyArray<{ id: TemplateFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "listings", label: "Listings" },
  { id: "appraisals", label: "Appraisals" },
  { id: "market", label: "Market updates" },
  { id: "sold", label: "Sold & nurture" },
];

type TrialStatus = {
  isTrial: boolean;
  includedRenders: number;
};

type NewAdDialogProps = {
  open: boolean;
  onClose: () => void;
  brandKit: AdStudioBrandKit;
  workspaceId: string;
  templates: AdStudioTemplate[];
  mediaAssets?: ImageLibraryAsset[];
  hasMoreMediaAssets?: boolean;
  loadingMoreMediaAssets?: boolean;
  onLoadMoreMediaAssets?: () => void | Promise<void>;
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
  const formatLabel = isFullscreen ? "Story · 9:16" : "Feed · 4:5";
  const copy = templateAdCopy(template);

  return (
    <button
      type="button"
      className="studio-explore-card studio-explore-card--template"
      aria-label={`Use ${template.name} ${formatLabel} template`}
      onClick={() => onSelect(template.id)}
    >
      <span className="studio-template-media">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={templatePreviewSrc(template, brandKit)}
          srcSet={templateThumbnailSrcSet(template)}
          sizes="(max-width: 900px) 44vw, 300px"
          width={template.dimensions.width}
          height={template.dimensions.height}
          alt={`${template.name} ${formatLabel} creative preview`}
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className="studio-template-info">
        <span className="studio-template-info-top">
          <strong>{template.name}</strong>
          <small>{formatLabel}</small>
        </span>
        <span className="studio-template-info-copy">{copy.primaryText}</span>
        <span className="studio-template-info-meta">
          <span>{copy.headline}</span>
          <span className="studio-template-info-cta">{copy.cta}</span>
        </span>
      </span>
      <span className="studio-explore-card-use" aria-hidden>Use</span>
      <span className="studio-explore-card-action">
        <span>Use this template</span>
        <ArrowUpRight aria-hidden size={15} />
      </span>
    </button>
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

type GuideZone = `feed:${FeedCopyFieldKey}` | `text:${string}` | `image:${string}`;

function NewAdPlacementGuide({
  template,
  brandKit,
  activeZone,
  copyFieldsVisible,
  onZoneClick,
}: {
  template: AdStudioTemplate | undefined;
  brandKit: AdStudioBrandKit;
  activeZone: GuideZone | null;
  copyFieldsVisible: boolean;
  onZoneClick: (zone: GuideZone) => void;
}) {
  const brandName = brandNameForPreview(brandKit);
  const brandInitial = initialForBrand(brandName);
  const domain = domainForPreview(brandKit);
  const sample = template ? templateAdCopy(template) : undefined;
  const primaryText = sample?.primaryText || "Primary text";
  const headline = sample?.headline || "Headline";
  const description = sample?.description || "Description";
  const cta = sample?.cta || "Learn more";
  const mediaSrc = template ? templatePreviewSrc(template, brandKit) : "";
  const isFullscreen = template?.format === "9:16";
  const primaryImageZone = template?.inputs.images[0]?.key
    ? `image:${template.inputs.images[0].key}` as GuideZone
    : null;

  const zoneClass = (zone: GuideZone) =>
    `newad-pv-zone${activeZone === zone ? " is-active" : ""}`;

  const captionButton = (zone: GuideZone, content: string) => (
    <button
      type="button"
      className={zoneClass(zone)}
      data-preview-zone={zone.replace("feed:", "")}
      onClick={() => onZoneClick(zone)}
      disabled={!copyFieldsVisible}
      aria-label={copyFieldsVisible
        ? `Show ${zone.replace("feed:", "")} field`
        : `Generate or write copy to edit ${zone.replace("feed:", "")}`}
    >
      <span>{content}</span>
    </button>
  );

  return (
    <div className="newad-preview">
      <div className="newad-preview-cap">
        <span>Where your content appears</span>
        <span>Selected template</span>
      </div>
      <div className={`newad-pv newad-pv--${isFullscreen ? "story" : "feed"}`}>
        {isFullscreen ? (
          <div className={`newad-pv-story${activeZone?.startsWith("image:") ? " is-active" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mediaSrc ? <img src={mediaSrc} alt="" loading="lazy" decoding="async" /> : <span className="newad-pv-story-ph" />}
            <span className="newad-pv-shade" aria-hidden />
            {primaryImageZone ? (
              <button
                type="button"
                className={`newad-sample-image-region${activeZone === primaryImageZone ? " is-active" : ""}`}
                onClick={() => onZoneClick(primaryImageZone)}
                aria-label="Show image field"
              />
            ) : null}
            {template?.inputs.text.map((field) => {
              const box = template.typography?.[field.key]?.sampleBox;
              if (!box) return null;
              const zone: GuideZone = `text:${field.key}`;
              return (
                <button
                  key={field.key}
                  type="button"
                  className={`newad-sample-region${activeZone === zone ? " is-active" : ""}`}
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.width * 100}%`,
                    height: `${box.height * 100}%`,
                  }}
                  onClick={() => onZoneClick(zone)}
                  aria-label={`Show ${field.label} field`}
                >
                  <span>{field.label}</span>
                </button>
              );
            })}
            <span className="newad-pv-story-top">
              <span className="studio-template-avatar">{brandInitial}</span>
              <span><strong>{brandName}</strong><small>Sponsored</small></span>
            </span>
            <span className="newad-pv-story-copy">
              {captionButton("feed:headline", headline)}
              {captionButton("feed:primaryText", primaryText)}
            </span>
            {captionButton("feed:cta", cta)}
          </div>
        ) : (
          <div className="newad-pv-feed">
            <span className="newad-pv-feed-head">
              <span className="studio-template-avatar">{brandInitial}</span>
              <span><strong>{brandName}</strong><small>Sponsored</small></span>
              <span className="studio-template-dots" aria-hidden>···</span>
            </span>
            {captionButton("feed:primaryText", primaryText)}
            <span className={`newad-pv-media${activeZone?.startsWith("image:") ? " is-active" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {mediaSrc ? <img src={mediaSrc} alt="" loading="lazy" decoding="async" /> : <span className="newad-pv-media-ph" />}
              {primaryImageZone ? (
                <button
                  type="button"
                  className={`newad-sample-image-region${activeZone === primaryImageZone ? " is-active" : ""}`}
                  onClick={() => onZoneClick(primaryImageZone)}
                  aria-label="Show image field"
                />
              ) : null}
              {template?.inputs.text.map((field) => {
                const box = template.typography?.[field.key]?.sampleBox;
                if (!box) return null;
                const zone: GuideZone = `text:${field.key}`;
                return (
                  <button
                    key={field.key}
                    type="button"
                    className={`newad-sample-region${activeZone === zone ? " is-active" : ""}`}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                    onClick={() => onZoneClick(zone)}
                    aria-label={`Show ${field.label} field`}
                  >
                    <span>{field.label}</span>
                  </button>
                );
              })}
            </span>
            <span className="newad-pv-feed-link">
              <span>
                <small>{domain}</small>
                {captionButton("feed:headline", headline)}
                {captionButton("feed:description", description)}
              </span>
              {captionButton("feed:cta", cta)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function NewAdDialog({
  open,
  onClose,
  brandKit,
  workspaceId,
  templates,
  mediaAssets = [],
  hasMoreMediaAssets = false,
  loadingMoreMediaAssets = false,
  onLoadMoreMediaAssets,
  onGenerate,
  initialTemplateId,
}: NewAdDialogProps) {
  const titleId = useId();
  const requirementsAlertId = useId();
  const copyFieldsTitleId = useId();
  const copyFieldIdPrefix = useId();
  const descriptionInputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const latestMediaAssetsRef = useRef(mediaAssets);
  const [step, setStep] = useState<Step>("source");
  const [filter, setFilter] = useState<TemplateFilter>("all");
  // Nothing can be created until the customer chooses the sample to clone.
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [generationQuality, setGenerationQuality] = useState<GenerationQuality>("fast");
  const [colourSource, setColourSource] = useState<ColourSource>("template");
  const [imageDataUrlsBySlot, setImageDataUrlsBySlot] = useState<Record<string, string>>({});
  // Point 9 — background image scaling: the slot shows a raw `URL.createObjectURL`
  // preview INSTANTLY while the heavier storage upload (which downscales big
  // photos on the way up) runs off to the side. Pending uploads gate Generate
  // so the server always gets the final downscaled URL, not a transient blob.
  // Preview object URLs are tracked so they can be revoked (no blob leaks).
  const previewUrlsRef = useRef<Record<string, string>>({});
  const uploadVersionRef = useRef(0);
  const activeUploadVersionBySlotRef = useRef<Record<string, number>>({});
  const [copyMode, setCopyMode] = useState<CopyMode>("ai");
  const [copyGenerated, setCopyGenerated] = useState(false);
  const [feedCopy, setFeedCopy] = useState<FeedCopy>(EMPTY_FEED_COPY);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [imageNamesBySlot, setImageNamesBySlot] = useState<Record<string, string>>({});
  const [onImageCopy, setOnImageCopy] = useState<Record<string, string>>({});
  const [activeImageSlotId, setActiveImageSlotId] = useState(DEFAULT_IMAGE_SLOT.id);
  const [mediaSourceMode, setMediaSourceMode] = useState<MediaSourceMode>("details");
  const [dialogMediaAssets, setDialogMediaAssets] = useState<ImageLibraryAsset[]>([]);
  const [error, setError] = useState("");
  const [showRequirementsAlert, setShowRequirementsAlert] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingImageUploads, setPendingImageUploads] = useState<Record<string, number>>({});
  const uploadingImage = hasPendingImageUploads(pendingImageUploads);
  const [trialCreditNote, setTrialCreditNote] = useState("Uses one ad pack. No Meta account is needed until publish.");

  const [activeZone, setActiveZone] = useState<GuideZone | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const handleFormFocusCapture = useCallback((event: FocusEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const zone = target?.closest<HTMLElement>("[data-guide-zone]")?.dataset.guideZone as GuideZone | undefined;
    if (zone) setActiveZone(zone);
  }, []);

  const handleZoneClick = useCallback((zone: GuideZone) => {
    const target = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("[data-guide-zone]") ?? [])
      .find((element) => element.dataset.guideZone === zone);
    (target?.matches("input, textarea, select, button") ? target : target?.querySelector<HTMLElement>("input, textarea, select, button"))?.focus();
  }, []);

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
  const defaultOnImageCopy = useMemo(
    () => brandTextDefaultsForTemplate(selectedTemplate, brandKit),
    [brandKit, selectedTemplate],
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
  // A slot can be filled and still hold a source the generator cannot use. The
  // server enforces the same contract, so catching it here keeps the customer
  // in the dialog with a slot-specific message instead of a generic failure.
  // An in-flight upload's blob: preview is excluded — `uploadingImage` already
  // explains that one, and it resolves itself.
  const unusableImageLabels = useMemo(
    () => imageRequirements
      .filter((slot) => {
        const src = imageDataUrls[slot.id];
        return Boolean(src) && !isTransientImagePreview(src) && !isAdStudioImageSrc(src);
      })
      .map((slot) => slot.label),
    [imageDataUrls, imageRequirements],
  );
  const missingCopyLabels = useMemo(
    () => customerCopyFields.filter((field) => field.required && !onImageCopy[field.key]?.trim()).map((field) => field.label),
    [customerCopyFields, onImageCopy],
  );
  const missingFeedCopyLabels = useMemo(() => {
    if (copyMode === "ai") return copyGenerated ? [] : ["generated ad copy"];
    return [
      !feedCopy.primaryText.trim() ? "primary text" : "",
      !feedCopy.headline.trim() ? "headline" : "",
    ].filter(Boolean);
  }, [copyGenerated, copyMode, feedCopy.headline, feedCopy.primaryText]);
  const overLimitLabels = useMemo(
    () => [
      ...customerCopyFields
        .filter((field) => (onImageCopy[field.key] ?? "").length > field.maxLength)
        .map((field) => field.label),
      ...FEED_COPY_FIELDS
        .filter((field) => field.key !== "cta" && feedCopy[field.key].length > FEED_COPY_LIMITS[field.key])
        .map((field) => field.label),
    ],
    [customerCopyFields, feedCopy, onImageCopy],
  );
  const effectiveDescription = copyMode === "ai"
    ? description
    : [feedCopy.primaryText, feedCopy.headline, feedCopy.description, ...Object.values(onImageCopy)].filter(Boolean).join(" ");
  const requirementBlockers = buildRequirementBlockers({
    description: effectiveDescription,
    missingImageLabels,
    unusableImageLabels,
    missingCopyLabels,
    missingFeedCopyLabels,
    overLimitLabels,
    descriptionTooLong: copyMode === "ai" && description.length > 500,
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
    : "We couldn't create this ad";
  const hasUnsavedProgress = Boolean(
    (templateId && templateId !== initialTemplateId) ||
      description.trim() ||
      Object.keys(imageDataUrlsBySlot).length > 0 ||
      Object.values(feedCopy).some((value) => value.trim()) ||
      colourSource !== "template" ||
      customerCopyFields.some(
        (field) => (onImageCopy[field.key] ?? "") !== (defaultOnImageCopy[field.key] ?? ""),
      ),
  );

  const closeCurrentView = useCallback(() => {
    if (discardConfirmOpen) {
      setDiscardConfirmOpen(false);
      return;
    }
    if (step === "brief" && mediaSourceMode !== "details") {
      setMediaSourceMode("details");
      setError("");
      setShowRequirementsAlert(false);
      return;
    }
    if (hasUnsavedProgress) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }, [discardConfirmOpen, hasUnsavedProgress, mediaSourceMode, onClose, step]);

  function discardAndClose() {
    setDiscardConfirmOpen(false);
    onClose();
  }

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
    setColourSource("template");
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
    activeUploadVersionBySlotRef.current = {};
    setPendingImageUploads({});
    setCopyMode("ai");
    setCopyGenerated(false);
    setFeedCopy(EMPTY_FEED_COPY);
    setCopyError(null);
    setActiveZone(null);
    setDiscardConfirmOpen(false);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, initialTemplateId]);

  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0 });
  }, [mediaSourceMode, open, step, templateId]);

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
        if (submitting) return;
        closeCurrentView();
      }
      if (event.key === "Tab") trapFocus(event);
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus.current?.focus();
    };
  }, [closeCurrentView, open, submitting]);

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
    activeUploadVersionBySlotRef.current = {};
    setPendingImageUploads({});
    setImageDataUrlsBySlot({});
    setImageNamesBySlot({});
    setOnImageCopy(brandTextDefaultsForTemplate(template, brandKit));
    setFeedCopy(EMPTY_FEED_COPY);
    setCopyMode("ai");
    setCopyGenerated(false);
    setCopyError(null);
    setGeneratingCopy(false);
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

  function invalidateSlotUpload(slotId: string) {
    delete activeUploadVersionBySlotRef.current[slotId];
  }

  /**
   * Point 9 — the customer sees their photo the instant they pick it. A raw
   * `URL.createObjectURL` blob preview drops into the slot right away while the
   * heavier storage upload (which downscales big photos on the way up) runs in
   * the background. The blob is replaced by the final storage URL when the
   * upload settles. Generate awaits any in-flight upload so the server always
   * receives the real, downscaled URL — never a transient blob:.
   */
  async function selectImage(file: File, slotId: string) {
    setError("");
    revokeSlotPreview(slotId);
    const uploadVersion = ++uploadVersionRef.current;
    activeUploadVersionBySlotRef.current[slotId] = uploadVersion;
    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current[slotId] = previewUrl;
    setImageDataUrlsBySlot((current) => ({ ...current, [slotId]: previewUrl }));
    setImageNamesBySlot((current) => ({ ...current, [slotId]: file.name }));
    setPendingImageUploads((current) => updatePendingImageUploads(current, slotId, 1));
    try {
      const uploaded = await uploadAdStudioMedia({
        file,
        workspaceId,
        brandKitId: brandKit.brandKitId,
      });
      if (activeUploadVersionBySlotRef.current[slotId] !== uploadVersion) return;
      // Blob preview served its purpose; swap to the real URL and release it.
      revokeSlotPreview(slotId);
      setSlotImage(slotId, uploaded.src, file.name);
      rememberLibraryAsset({
        src: uploaded.src,
        fullSrc: uploaded.src,
        label: file.name,
        type: "Uploaded",
        ratio: "Just now",
        role: "property",
      });
      setError("");
    } catch (caught) {
      if (activeUploadVersionBySlotRef.current[slotId] !== uploadVersion) return;
      revokeSlotPreview(slotId);
      clearSlotImage(slotId);
      setError(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setPendingImageUploads((current) => updatePendingImageUploads(current, slotId, -1));
    }
  }

  /** Release a single slot's blob preview URL (idempotent). */
  function revokeSlotPreview(slotId: string) {
    const url = previewUrlsRef.current[slotId];
    if (url) {
      URL.revokeObjectURL(url);
      delete previewUrlsRef.current[slotId];
    }
  }

  function clearSlotImage(slotId: string) {
    invalidateSlotUpload(slotId);
    revokeSlotPreview(slotId);
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

  function openLibrary(slotId: string) {
    setActiveImageSlotId(slotId);
    setMediaSourceMode("library");
    setError("");
  }

  function selectLibraryImage(asset: ImageLibraryAsset) {
    invalidateSlotUpload(activeImageSlot.id);
    revokeSlotPreview(activeImageSlot.id);
    setSlotImage(activeImageSlot.id, asset.fullSrc, asset.label);
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

  async function runAiCopy() {
    if (!selectedTemplate) return;
    if (!description.trim()) {
      setCopyError("Write a brief first so the AI knows what to say.");
      return;
    }
    setGeneratingCopy(true);
    setCopyError(null);
    try {
      const response = await fetch("/api/adstudio/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "templateFields",
          brief: description.trim(),
          sourceImageUrl: imageDataUrl,
          templateFields: selectedTemplate.inputs.text.map((field) => ({
            key: field.key,
            label: field.label,
            maxLength: field.maxLength,
            sample: field.sample,
          })),
        }),
      });
      const result = (await response.json()) as {
        onImage?: Record<string, string>;
        copy?: { primaryText: string; headline: string; description: string; cta: string };
        error?: string;
      };
      if (!response.ok || result.error) {
        setCopyError(result.error ?? "Copy generation failed. Try again.");
        return;
      }
      if (result.copy) {
        setFeedCopy({
          primaryText: result.copy.primaryText ?? "",
          headline: result.copy.headline ?? "",
          description: result.copy.description ?? "",
          cta: result.copy.cta ?? "",
        });
      }
      if (result.onImage) {
        setOnImageCopy((current) => ({ ...current, ...result.onImage }));
      }
      setCopyGenerated(true);
    } catch {
      setCopyError("Copy generation failed. Try again.");
    } finally {
      setGeneratingCopy(false);
    }
  }

  function useSampleCopy() {
    if (!selectedTemplate) return;
    const sample = templateAdCopy(selectedTemplate);
    setFeedCopy({
      primaryText: sample.primaryText,
      headline: sample.headline,
      description: sample.description,
      cta: sample.cta,
    });
    setOnImageCopy((current) => ({
      ...current,
      ...Object.fromEntries(
        selectedTemplate.inputs.text.map((field) => [field.key, field.sample]).filter(([, v]) => v),
      ),
    }));
    setCopyError(null);
  }

  function selectGenerationQuality(quality: GenerationQuality) {
    setGenerationQuality(quality);
    setError("");
  }

  function selectColourSource(source: ColourSource) {
    setColourSource(source);
    setError("");
  }

  async function submit() {
    const trimmed = effectiveDescription.trim();
    const blockers = buildRequirementBlockers({
      description: effectiveDescription,
      missingImageLabels,
      unusableImageLabels,
      missingCopyLabels,
      missingFeedCopyLabels,
      overLimitLabels,
      descriptionTooLong: copyMode === "ai" && description.length > 500,
      uploadingImage,
    });
    if (blockers.length > 0) {
      setShowRequirementsAlert(true);
      setError("");
      if (copyMode === "ai" && blockers.some((blocker) => blocker.target === "description")) {
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
        colourSource,
        imageDataUrl,
        imageDataUrls,
        onImageCopy: Object.fromEntries(
          Object.entries(onImageCopy)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value),
        ),
        // Forward customer-written feed copy only when the two required fields
        // are present — otherwise the server generates copy as before.
        ...(feedCopy.headline.trim() && feedCopy.primaryText.trim()
          ? {
              copy: {
                primaryText: feedCopy.primaryText.trim(),
                headline: feedCopy.headline.trim(),
                description: feedCopy.description.trim(),
                cta: feedCopy.cta.trim(),
              },
            }
          : {}),
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
        : "Create your ad";

  const footHint =
    mediaSourceMode === "library"
      ? `Select an image for ${activeImageSlot.label}.`
      : trialCreditNote;
  const showFooter = step === "brief";
  const generationTemplate = submitting ? selectedTemplate : null;

  if (generationTemplate) {
    return (
      <div className="studio-newad-overlay">
        <div
          ref={dialogRef}
          className="studio-newad studio-newad--generating"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy="true"
          tabIndex={-1}
        >
          <GenerationProgress quality={generationQuality} template={generationTemplate} titleId={titleId} />
        </div>
      </div>
    );
  }

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
            <h2 id={titleId}>{stepTitle}</h2>
          </div>
          <button className="studio-newad-x" type="button" aria-label="Close" onClick={closeCurrentView}>
            <X aria-hidden size={18} />
          </button>
        </div>

        <div ref={bodyRef} className="studio-newad-body">
          {step === "source" && (
            <div className="studio-explore">
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
            <div className="studio-newad-canvas">
              <div className="studio-newad-own" onFocusCapture={handleFormFocusCapture}>
                <section className="newad-flow-section" aria-labelledby="newad-writing-method">
                  <h3 id="newad-writing-method">How would you like to write this ad?</h3>
                  <div className="studio-newad-copymodes" role="radiogroup" aria-label="Writing method">
                    {COPY_MODES.map((mode) => (
                      <label
                        key={mode.id}
                        className={copyMode === mode.id ? "studio-copymode-tab is-active" : "studio-copymode-tab"}
                      >
                        <input
                          type="radio"
                          name="new-ad-writing-method"
                          value={mode.id}
                          checked={copyMode === mode.id}
                          onChange={() => {
                            setCopyMode(mode.id);
                            setCopyError(null);
                            setShowRequirementsAlert(false);
                          }}
                        />
                        {mode.id === "ai" ? <Sparkles aria-hidden size={17} /> : null}
                        <span>{mode.label}</span>
                        {mode.id === "ai" ? <em>Recommended</em> : null}
                      </label>
                    ))}
                  </div>
                </section>

                {copyMode === "ai" && (
                  <section className="newad-flow-section" aria-labelledby="newad-about-title">
                    <div className="newad-flow-heading">
                      <h3 id="newad-about-title">Tell us about the ad</h3>
                      <span className={description.length > 500 ? "studio-newad-charcount is-over" : "studio-newad-charcount"} aria-live="polite">
                        {description.length}/500
                      </span>
                    </div>
                    <div className={description.length > 500 ? "studio-newad-field is-over" : "studio-newad-field"}>
                      <label className="newad-sr-only" htmlFor={descriptionInputId}>Tell us about the ad</label>
                      <textarea
                        id={descriptionInputId}
                        ref={descriptionRef}
                        value={description}
                        rows={5}
                        aria-invalid={description.length > 500 || hasDescriptionRequirement ? true : undefined}
                        aria-describedby={hasDescriptionRequirement ? requirementsAlertId : undefined}
                        onChange={(event) => {
                          setShowRequirementsAlert(false);
                          setCopyGenerated(false);
                          setDescription(event.target.value);
                        }}
                        placeholder={briefGuidance.placeholder}
                      />
                    </div>
                    <div className="studio-newad-ai-copy">
                      <button
                        type="button"
                        className="studio-btn accent"
                        onClick={() => void runAiCopy()}
                        disabled={generatingCopy || !description.trim() || description.length > 500}
                      >
                        <Sparkles aria-hidden size={16} />
                        {generatingCopy ? "Generating copy…" : copyGenerated ? "Generate again" : "Generate copy"}
                      </button>
                      {copyError && <p className="studio-newad-copy-error" role="alert">{copyError}</p>}
                    </div>
                  </section>
                )}

                {(copyMode === "write" || copyGenerated) && (
                  <section className="newad-flow-section" aria-label="Editable ad copy">
                    <div className="studio-newad-copyfields-list">
                      {FEED_COPY_FIELDS.map((field) => {
                        const inputId = `feedcopy-${field.key}`;
                        const limit = FEED_COPY_LIMITS[field.key];
                        const value = feedCopy[field.key];
                        const isOver = field.key !== "cta" && value.length > limit;
                        const zone: GuideZone = `feed:${field.key}`;
                        return (
                          <div className={isOver ? "studio-newad-field is-over" : "studio-newad-field"} key={field.key} data-guide-zone={zone}>
                            <div className="studio-newad-field-head">
                              <label htmlFor={inputId}>{field.label}</label>
                              {field.key !== "cta" ? (
                                <span className={isOver ? "studio-newad-charcount is-over" : "studio-newad-charcount"} aria-live="polite">
                                  {value.length}/{limit}
                                </span>
                              ) : null}
                            </div>
                            {field.key === "cta" ? (
                              <select
                                id={inputId}
                                value={value}
                                onChange={(event) => setFeedCopy((current) => ({ ...current, [field.key]: event.target.value }))}
                              >
                                {FEED_COPY_CTA_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            ) : field.multiline ? (
                              <textarea
                                id={inputId}
                                rows={2}
                                value={value}
                                aria-invalid={isOver || undefined}
                                onChange={(event) => setFeedCopy((current) => ({ ...current, [field.key]: event.target.value }))}
                              />
                            ) : (
                              <input
                                id={inputId}
                                type="text"
                                value={value}
                                aria-invalid={isOver || undefined}
                                onChange={(event) => setFeedCopy((current) => ({ ...current, [field.key]: event.target.value }))}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {copyMode === "write" ? (
                      <button className="newad-use-sample" type="button" onClick={useSampleCopy}>Start with example copy</button>
                    ) : null}
                  </section>
                )}

                <section className="newad-flow-section" aria-labelledby="newad-template-content">
                  <h3 id="newad-template-content">Add the content for this template</h3>
                  <div className="studio-newad-upload-group">
                    {imageRequirements.map((slot) => (
                      <div className="studio-newad-image-slot" key={slot.id} data-guide-zone={`image:${slot.id}`}>
                        {imageRequirements.length > 1 && (
                          <div className="studio-newad-image-slot-head">
                            <strong>{slot.label}</strong>
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
                    <div className="studio-newad-copyfields" aria-labelledby={copyFieldsTitleId}>
                      <div className="studio-newad-copyfields-head">
                        <strong id={copyFieldsTitleId}>Text on the ad</strong>
                        <button type="button" onClick={fillEmptyCopyFieldsWithExamples}>Use examples</button>
                      </div>
                      <div className="studio-newad-copyfields-list">
                        {customerCopyFields.map((field) => {
                          const inputId = `${copyFieldIdPrefix}-${field.key}`;
                          const value = onImageCopy[field.key] ?? "";
                          const isOver = value.length > field.maxLength;
                          const brandDefault = defaultTextForTemplateField(field, brandKit);
                          const isBrandPrefilled = Boolean(brandDefault && value === brandDefault);
                          const zone: GuideZone = `text:${field.key}`;
                          return (
                            <div className={isOver ? "studio-newad-field is-over" : "studio-newad-field"} key={field.key} data-guide-zone={zone}>
                              <div className="studio-newad-field-head">
                                <label htmlFor={inputId}>{field.label}</label>
                                <span className="studio-newad-field-actions">
                                  {isBrandPrefilled ? <em>From Brand Pack</em> : null}
                                  <span className={isOver ? "studio-newad-charcount is-over" : "studio-newad-charcount"} aria-live="polite">
                                    {value.length}/{field.maxLength}
                                  </span>
                                  <button type="button" onClick={() => useCopyExample(field)}>Use example</button>
                                </span>
                              </div>
                              <input
                                id={inputId}
                                type="text"
                                value={value}
                                aria-invalid={isOver || undefined}
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
                    </div>
                  )}
                </section>

              <fieldset className="studio-newad-quality">
                <legend>Colour scheme</legend>
                <div className="studio-newad-quality-options">
                  <label className={colourSource === "template" ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="colour-source"
                      value="template"
                      checked={colourSource === "template"}
                      onChange={() => selectColourSource("template")}
                    />
                    <span>
                      <strong>Template colours</strong>
                      <small>Keep the selected ad&apos;s original colour scheme</small>
                    </span>
                    <em>Recommended</em>
                  </label>
                  <label className={colourSource === "brand" ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="colour-source"
                      value="brand"
                      checked={colourSource === "brand"}
                      onChange={() => selectColourSource("brand")}
                    />
                    <span>
                      <strong>Brand Pack colours</strong>
                      <small>Adapt the ad to your saved brand palette</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="studio-newad-quality">
                <legend>Generation quality</legend>
                <div className="studio-newad-quality-options">
                  <label className={generationQuality === "fast" ? "is-selected" : undefined}>
                    <input
                      type="radio"
                      name="generation-quality"
                      value="fast"
                      checked={generationQuality === "fast"}
                      onChange={() => selectGenerationQuality("fast")}
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
                      onChange={() => selectGenerationQuality("high")}
                    />
                    <span>
                      <strong>High quality</strong>
                      <small>Usually ready in about 2–3 minutes</small>
                    </span>
                  </label>
                </div>
              </fieldset>
              </div>
              <aside className="studio-newad-previewpane" aria-label="Template placement guide">
                <NewAdPlacementGuide
                  template={selectedTemplate}
                  brandKit={brandKit}
                  activeZone={activeZone}
                  copyFieldsVisible={copyMode === "write" || copyGenerated}
                  onZoneClick={handleZoneClick}
                />
              </aside>
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
              {hasMoreMediaAssets && onLoadMoreMediaAssets ? (
                <button
                  className="studio-btn secondary block"
                  type="button"
                  disabled={loadingMoreMediaAssets}
                  onClick={() => void onLoadMoreMediaAssets()}
                >
                  {loadingMoreMediaAssets ? "Loading…" : "Load more images"}
                </button>
              ) : null}
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
                {uploadingImage ? "Preparing image…" : submitting ? "Creating ad" : error ? "Try again" : "Generate ad"}
                <ArrowUpRight aria-hidden size={16} />
              </button>
            )}
          </div>
        )}
        <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
          <AlertDialogContent
            size="sm"
            overlayClassName="z-[250]"
            className="z-[260] border-(--line) bg-white text-(--ink)"
          >
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-warning-soft text-warning">
                <AlertTriangle aria-hidden />
              </AlertDialogMedia>
              <AlertDialogTitle>Discard this ad draft?</AlertDialogTitle>
              <AlertDialogDescription>
                Your selected template, images and copy will be removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep editing</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={discardAndClose}>
                Discard draft
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
  if (status?.isTrial && Number.isFinite(status.includedRenders) && status.includedRenders > 0) {
    return `Uses 2 of ${status.includedRenders} free renders for one Feed + Story ad. No Meta account is needed until publish.`;
  }

  return "Uses two renders for one Feed + Story ad. No Meta account is needed until publish.";
}

function buildRequirementBlockers(input: {
  description: string;
  missingImageLabels: string[];
  unusableImageLabels?: string[];
  missingCopyLabels?: string[];
  missingFeedCopyLabels?: string[];
  overLimitLabels?: string[];
  descriptionTooLong?: boolean;
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

  if (input.missingFeedCopyLabels && input.missingFeedCopyLabels.length > 0) {
    blockers.push({
      id: "missing_feed_copy",
      target: "description",
      message: input.missingFeedCopyLabels.includes("generated ad copy")
        ? "Generate the ad copy, then review the editable fields."
        : `Fill in ${input.missingFeedCopyLabels.join(" and ")} before generating the ad.`,
    });
  }

  if (input.overLimitLabels && input.overLimitLabels.length > 0) {
    blockers.push({
      id: "copy_too_long",
      target: "description",
      message: `Shorten ${input.overLimitLabels.join(", ")} to the character limit shown in red.`,
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

  if (input.unusableImageLabels && input.unusableImageLabels.length > 0) {
    blockers.push({
      id: "unusable_image",
      target: "images",
      message:
        input.unusableImageLabels.length === 1
          ? `Blockwise can't read the image you picked for ${input.unusableImageLabels[0]}. Upload it again or choose another one from your library.`
          : `Blockwise can't read the images you picked for ${input.unusableImageLabels.join(", ")}. Upload them again or choose others from your library.`,
    });
  }

  if (input.uploadingImage) {
    blockers.push({
      id: "uploading_image",
      target: "upload",
      message: "Image upload is still running. Wait for it to finish, then generate the ad.",
    });
  }

  if (input.descriptionTooLong) {
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
.studio-explore-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:stretch}
.studio-explore-card{display:flex;min-width:0;flex-direction:column;border:1px solid var(--line-soft);border-radius:14px;background:#fff;box-shadow:var(--st-sh-1);overflow:hidden;color:var(--ink);font:inherit;text-align:left;transition:transform .15s,box-shadow .15s,border-color .15s}
button.studio-explore-card{padding:0;cursor:pointer}
.studio-explore-card:hover{transform:translateY(-2px);box-shadow:var(--st-sh-lift)}
.studio-explore-card:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.studio-explore-card--template{border-color:#d9e2ed;background:#fff}
.studio-explore-card--template:hover{border-color:#b9c7d8}
.studio-explore-card-action{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:auto;border-top:1px solid var(--line-soft);padding:11px 12px;color:#001b3d;font-size:13px;font-weight:760}
.studio-explore-card-action svg{flex:0 0 auto}
/* Clean template cards: creative preview (true aspect ratio, no crop),
   then title + format label + the actual ad copy underneath. */
.studio-template-avatar{flex:0 0 auto;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#123e75;color:#fff;font-size:12px;font-weight:800}
.studio-template-dots{margin-left:auto;color:#64748b;font-size:18px;line-height:1;letter-spacing:0}
.studio-template-media{display:grid;place-items:center;padding:14px;background:#eef2f7}
.studio-template-media img{width:auto;max-width:100%;max-height:300px;object-fit:contain;display:block;border-radius:8px;box-shadow:0 10px 24px rgba(15,23,42,.14)}
.studio-template-info{display:grid;gap:6px;padding:12px 14px 14px}
.studio-template-info-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;min-width:0}
.studio-template-info-top strong{font-size:13.5px;font-weight:760;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-info-top small{flex:0 0 auto;font-size:11px;font-weight:700;color:var(--muted)}
.studio-template-info-copy{font-size:12px;line-height:1.4;color:var(--ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.studio-template-info-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.studio-template-info-meta>span:first-child{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.studio-template-info-cta{flex:0 0 auto;border-radius:6px;background:#e4e6eb;color:#172033;font-size:11px;font-weight:760;padding:4px 9px;white-space:nowrap}
.studio-explore-card-use{position:absolute;top:9px;right:9px;z-index:3;border-radius:999px;background:rgba(15,23,42,.82);color:#fff;font-size:11px;font-weight:750;padding:6px 11px;opacity:0;transform:translateY(-3px);transition:opacity .15s,transform .15s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.25)}
.studio-explore-card--template:hover .studio-explore-card-use,.studio-explore-card--template:focus-visible .studio-explore-card-use{opacity:1;transform:none}
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
.newad-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.studio-newad-own{display:grid;gap:26px}
.newad-flow-section{display:grid;gap:14px;min-width:0}
.newad-flow-section+.newad-flow-section{border-top:1px solid var(--line-soft);padding-top:24px}
.newad-flow-section h3{margin:0;color:var(--ink);font-size:16px;font-weight:780;line-height:1.3;letter-spacing:-.01em}
.newad-flow-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.studio-newad-copymodes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
.studio-copymode-tab{min-height:72px;display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font:inherit;font-size:13.5px;font-weight:700;padding:13px 14px;text-align:left;cursor:pointer;transition:border-color .15s,background .15s,box-shadow .15s}
.studio-copymode-tab:hover{border-color:#b8bec9;background:var(--accent-tint)}
.studio-copymode-tab.is-active{border-color:var(--ink);color:var(--ink);background:#f6f7f9;box-shadow:0 0 0 1px var(--ink)}
.studio-copymode-tab:focus-within{outline:2px solid var(--ink);outline-offset:2px}
.studio-copymode-tab input{width:18px;height:18px;flex:0 0 auto;accent-color:var(--ink)}
.studio-copymode-tab svg{flex:0 0 auto}
.studio-copymode-tab span{min-width:0}
.studio-copymode-tab em{margin-left:auto;border-radius:999px;background:var(--ink);color:#fff;padding:4px 7px;font-size:10.5px;font-style:normal;font-weight:700;white-space:nowrap}
.studio-newad-ai-copy{display:grid;gap:10px;margin:8px 0 14px}
.studio-newad-ai-hint{font-size:12.5px;line-height:1.5;color:var(--muted);margin:0}
.studio-newad-copy-error{font-size:12.5px;color:var(--danger,#c0392b);margin:0}
.studio-newad-charcount{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.studio-newad-charcount.is-over,.studio-newad-field.is-over .studio-newad-charcount{color:#ba1a1a;font-weight:700}
.studio-newad-field.is-over input,.studio-newad-field.is-over textarea{border-color:#ba1a1a;box-shadow:0 0 0 3px rgba(186,26,26,.12)}
.newad-use-sample{justify-self:start;min-height:44px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;font-weight:700;padding:0 4px;cursor:pointer}
.newad-use-sample:hover{color:var(--ink);text-decoration:underline}
@media(max-width:900px){
  .studio-explore-grid{grid-template-columns:repeat(2,1fr);gap:12px}
  .studio-explore-thumb{height:210px}
  .studio-explore-thumb--sample{height:286px}
  .studio-newad-library-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
/* Desktop gallery: clean preview cards (image-2 style) with the ad copy
   underneath. 4 columns, exactly two full rows visible inside the dialog;
   remaining templates scroll. Creatives keep their true aspect ratio
   (4:5 feed / 9:16 story) and are letterboxed, never cropped.
   Row budget = (dialog − head 62 − body padding 44 − filter 19 −
   gaps 28) / 2, capped at 464px once the dialog stops growing. */
@media(min-width:901px){
  .studio-explore-grid{--row-h:clamp(280px,calc(50vh - 101px),464px);grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
  .studio-explore-card--template{position:relative;height:var(--row-h)}
  .studio-explore-card--template .studio-explore-card-action{display:none}
  .studio-template-media{height:auto;flex:1;min-height:0;overflow:hidden}
  .studio-template-media img{max-width:100%;max-height:100%}
}
@media(max-width:560px){
  .studio-explore-filterbar{gap:8px}
  .studio-explore-filter{flex:1}
  .studio-explore-filter select{min-width:0;width:100%}
  .studio-explore-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .studio-explore-card-action{padding:10px 9px;font-size:12px}
  .studio-template-media{padding:10px}
  .studio-template-info{padding:10px 11px 12px}
  .studio-explore-thumb{height:180px}
  .studio-explore-thumb--sample{height:240px}
  .studio-newad-library-grid{grid-template-columns:1fr}
  .studio-newad-copyfields-head,.studio-newad-field-head{align-items:stretch;flex-direction:column}
  .studio-newad-copyfields-head button{width:100%;white-space:normal}
  .studio-newad-field-actions{justify-content:space-between;width:100%}
  .studio-newad-field-head label{align-items:flex-start;flex-direction:column;gap:2px}
  .studio-newad-field-head>button{width:100%}
  .studio-newad-quality-options{grid-template-columns:1fr}
  .studio-newad-copymodes{grid-template-columns:1fr}
}

/* ── Canvas editor: split form + live preview ─────────────────────────── */
.studio-newad-canvas{display:grid;grid-template-columns:minmax(0,1fr);gap:22px;align-items:start}
@media (min-width:861px){
  .studio-newad-canvas{grid-template-columns:minmax(0,1fr) 372px}
  .studio-newad-previewpane{position:sticky;top:0}
}
.studio-newad-canvas.is-peek-collapsed .studio-newad-previewpane{display:none}

.newad-preview{display:grid;gap:10px}
.newad-preview-cap{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.newad-preview-cap>span:first-child{font-size:11px;font-weight:800;letter-spacing:1.6px;text-transform:uppercase;color:var(--accent)}
.newad-preview-cap>span:last-child{font-size:11.5px;color:var(--muted);text-align:right}

.newad-pv{position:relative;border:1px solid var(--line-soft);border-radius:16px;background:#fff;box-shadow:var(--st-sh-1);overflow:hidden}
.newad-pv--feed{max-width:470px;margin:0 auto;width:100%}
.newad-pv--story{max-width:270px;margin:0 auto;width:100%}

/* Feed placement */
.newad-pv-feed-head{display:flex;align-items:center;gap:9px;padding:12px 13px 8px}
.newad-pv-feed-head .studio-template-avatar{width:32px;height:32px}
.newad-pv-feed-head>span:nth-child(2){display:grid;gap:1px;min-width:0}
.newad-pv-feed-head strong{font-size:13.5px;font-weight:760;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.newad-pv-feed-head small{font-size:11px;color:#64748b}
.newad-pv-feed-head .studio-template-dots{margin-left:auto;color:#64748b;font-size:18px;line-height:1}
.newad-pv-feed .newad-pv-zone{padding:0 13px 10px;text-align:left;font-size:14px;line-height:1.36;color:#1d2129}
.newad-pv-media{position:relative;display:block;background:#f1f5f9;border-top:1px solid #edf1f6;border-bottom:1px solid #edf1f6}
.newad-pv-media.is-active{box-shadow:inset 0 0 0 3px var(--ink)}
.newad-pv-media img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.newad-pv-media-ph{display:block;width:100%;aspect-ratio:4/5;background:linear-gradient(135deg,#e8edf4,#dbe4ef)}
.newad-sample-image-region{position:absolute;z-index:1;inset:0;border:0;background:transparent;padding:0;cursor:pointer}
.newad-sample-image-region:hover,.newad-sample-image-region:focus-visible{outline:2px solid var(--ink);outline-offset:-3px}
.newad-sample-image-region.is-active{outline:3px solid var(--ink);outline-offset:-4px}
.newad-sample-region{position:absolute;z-index:2;border:1.5px solid transparent;border-radius:6px;background:transparent;color:transparent;padding:0;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.newad-sample-region:hover{border-color:rgba(255,255,255,.9);box-shadow:0 0 0 2px rgba(22,24,29,.72)}
.newad-sample-region.is-active{z-index:3;border-color:#fff;box-shadow:0 0 0 2px var(--ink),0 0 0 999px rgba(22,24,29,.34)}
.newad-sample-region span{position:absolute;left:5px;top:5px;display:none;min-height:21px;align-items:center;border-radius:999px;background:var(--ink);color:#fff;padding:0 7px;font-size:9px;font-weight:750;white-space:nowrap}
.newad-sample-region.is-active span{display:inline-flex}
.newad-sample-region:focus-visible{outline:2px solid #fff;outline-offset:2px}
.newad-pv-feed-link{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f2f3f5;padding:11px 13px}
.newad-pv-feed-link>span:first-child{display:grid;gap:3px;min-width:0}
.newad-pv-feed-link small{font-size:9.5px;text-transform:uppercase;color:#64748b;letter-spacing:.3px}
.newad-pv-feed-link>span:first-child .newad-pv-zone{width:100%}
.newad-pv-feed-link .newad-pv-zone[data-preview-zone="headline"]{font-size:13px;font-weight:760;color:#1d2129;line-height:1.25}
.newad-pv-feed-link .newad-pv-zone[data-preview-zone="description"]{font-size:12px;color:#64748b;line-height:1.3}
.newad-pv-feed-link>.newad-pv-zone[data-preview-zone="cta"]{flex:0 0 auto;width:auto;min-height:34px;border-radius:6px;background:#e4e6eb;color:#172033;font-size:12px;font-weight:760;padding:0 14px;display:grid;place-items:center;white-space:nowrap}
.newad-pv-feed-link>.newad-pv-zone[data-preview-zone="cta"].is-active{background:#e4e6eb}

/* Fullscreen (story) placement */
.newad-pv-story{position:relative;aspect-ratio:9/16;background:#0b1020;color:#fff;overflow:hidden}
.newad-pv-story.is-active{box-shadow:inset 0 0 0 3px #fff}
.newad-pv-story img,.newad-pv-story-ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.newad-pv-story-ph{background:linear-gradient(160deg,#16213a,#0b1020)}
.newad-pv-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,7,18,.5) 0%,rgba(3,7,18,.04) 40%,rgba(3,7,18,.78) 100%)}
.newad-pv-story-top{position:absolute;left:12px;right:12px;top:14px;display:flex;align-items:center;gap:8px;z-index:2}
.newad-pv-story-top .studio-template-avatar{width:28px;height:28px;background:rgba(255,255,255,.94);color:#111827}
.newad-pv-story-top>span:nth-child(2){display:grid;gap:1px;min-width:0;text-shadow:0 1px 4px rgba(0,0,0,.5)}
.newad-pv-story-top strong{font-size:12px;font-weight:760;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.newad-pv-story-top small{font-size:10px;color:rgba(255,255,255,.78)}
.newad-pv-story-copy{position:absolute;left:13px;right:13px;bottom:58px;display:grid;gap:7px;z-index:2}
.newad-pv-story-copy .newad-pv-zone{width:100%}
.newad-pv-story-copy .newad-pv-zone[data-preview-zone="headline"]{font-size:19px;font-weight:820;line-height:1.08;color:#fff}
.newad-pv-story-copy .newad-pv-zone[data-preview-zone="primaryText"]{font-size:11.5px;line-height:1.34;color:rgba(255,255,255,.92)}
.newad-pv-story .newad-pv-zone[data-preview-zone="cta"]{position:absolute;left:13px;right:13px;bottom:13px;z-index:2;min-height:36px;border-radius:999px;background:rgba(255,255,255,.95);color:#101827;display:grid;place-items:center;font-size:12.5px;font-weight:800;text-align:center;box-shadow:0 8px 18px rgba(0,0,0,.22)}
.newad-pv-story .newad-pv-zone[data-preview-zone="cta"].is-active{background:rgba(255,255,255,1)}
.newad-pv-story .newad-pv-zone[data-preview-zone="cta"]:hover{box-shadow:0 0 0 2px rgba(22,24,29,.8),0 8px 18px rgba(0,0,0,.22)}

/* Editable zones */
.newad-pv-zone{display:block;width:100%;border:0;background:none;font:inherit;color:inherit;padding:0;margin:0;text-align:left;cursor:pointer;border-radius:6px;transition:box-shadow .16s ease,background .16s ease,transform .16s ease}
.newad-pv-zone:hover:not(:disabled){box-shadow:0 0 0 1.5px rgba(22,24,29,.55)}
.newad-pv-zone:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.newad-pv-zone:disabled{cursor:default;opacity:.72}
.newad-pv-zone.is-active{background:var(--surface-subtle);box-shadow:0 0 0 2px var(--ink)}
.newad-pv-zone .is-ghost{color:#94a3b8;font-style:italic}
.newad-pv-story .newad-pv-zone .is-ghost{color:rgba(255,255,255,.55)}
`;
// NewAdDialog: choose one gallery sample, then provide its declared assets.
