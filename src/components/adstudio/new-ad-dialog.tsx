"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Copy, LayoutGrid, Radar, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import type { AdStudioBrandKit, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
import { isBuiltInAdStudioTemplate } from "@/lib/adstudio/templates.ts";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";
import { BlankTemplateCard, TemplateCard } from "./panels/templates-panel";

type StartStep = "source" | "template" | "reuse" | "radar";
type Step = StartStep | "brief";

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

type RadarMedia = { kind: string; url: string };
type RadarAd = {
  savedId: string;
  observedAdId: string;
  pageName: string;
  headline: string;
  body: string;
  cta: string;
  adType: string;
  primaryIntent: string;
  hooks: string[];
  thumb: string | null;
};

type RadarInspiration = Pick<RadarAd, "savedId" | "observedAdId" | "cta" | "adType" | "primaryIntent" | "hooks">;

type NewAdDialogProps = {
  open: boolean;
  onClose: () => void;
  brandKit: AdStudioBrandKit;
  workspaceId: string;
  templates: AdStudioTemplate[];
  onGenerate: (input: FirstAdInput) => Promise<void>;
  /** Pre-select a template (e.g. launched from a template card). */
  initialTemplateId?: string;
  /** Where the dialog opens: the source chooser, or straight to the template gallery. */
  initialStep?: StartStep;
};

export function NewAdDialog({
  open,
  onClose,
  brandKit,
  workspaceId,
  templates,
  onGenerate,
  initialTemplateId,
  initialStep = "source",
}: NewAdDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [briefFrom, setBriefFrom] = useState<StartStep>("source");
  // undefined = nothing chosen yet; "" = blank (create your own)
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [radarInspiration, setRadarInspiration] = useState<RadarInspiration | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [trialCreditNote, setTrialCreditNote] = useState("Uses one ad pack. No Meta account is needed until publish.");

  const [reuseAds, setReuseAds] = useState<ReuseAd[] | null>(null);
  const [reuseError, setReuseError] = useState("");
  const [radarAds, setRadarAds] = useState<RadarAd[] | null>(null);
  const [radarError, setRadarError] = useState("");

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (initialTemplateId !== undefined) {
      setTemplateId(initialTemplateId);
      setBriefFrom("template");
      setStep("brief");
    } else {
      setTemplateId(undefined);
      setStep(initialStep);
    }
    setDescription("");
    setImageDataUrl("");
    setImageName("");
    setSourceNote("");
    setRadarInspiration(null);
    setError("");
    setUploadingImage(false);
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

  // Lazy-load "Reuse" and "Ad Radar" lists only when their tab is opened.
  useEffect(() => {
    if (!open || step !== "reuse" || reuseAds !== null) return;
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
  }, [open, step, reuseAds]);

  useEffect(() => {
    if (!open || step !== "radar" || radarAds !== null) return;
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
  }, [open, step, radarAds]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") trapFocus(event);
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const isBlank = templateId === "";
  const selectedTemplate = templates.find((template) => template.id === templateId);

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
    setBriefFrom(id === "" ? "source" : "template");
    setStep("brief");
  }

  function chooseReuse(ad: ReuseAd) {
    // Reuse opens the existing ad so it can be duplicated or tweaked.
    window.location.href = `/ad-studio?campaignId=${encodeURIComponent(ad.id)}`;
  }

  function chooseRadar(ad: RadarAd) {
    const brief = [ad.headline, ad.body, ad.cta ? `CTA: ${ad.cta}` : ""]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 480);
    setTemplateId("");
    setDescription(brief);
    setSourceNote(`Copied from ${ad.pageName} on Ad Radar. Add your own photo and Blockwise will write your version.`);
    setRadarInspiration({
      savedId: ad.savedId,
      observedAdId: ad.observedAdId,
      cta: ad.cta,
      adType: ad.adType,
      primaryIntent: ad.primaryIntent,
      hooks: ad.hooks,
    });
    setError("");
    setBriefFrom("radar");
    setStep("brief");
  }

  function goBack() {
    if (step === "brief") {
      setStep(briefFrom);
      return;
    }
    setStep("source");
  }

  async function selectImage(file: File) {
    setError("");
    setUploadingImage(true);
    try {
      const uploaded = await uploadAdStudioMedia({
        file,
        workspaceId,
        brandKitId: brandKit.brandKitId,
      });
      setImageDataUrl(uploaded.src);
      setImageName(file.name);
      setError("");
    } catch (caught) {
      setImageDataUrl("");
      setImageName("");
      setError(caught instanceof Error ? caught.message : "Could not upload that image.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function submit() {
    const trimmed = description.trim();
    if (uploadingImage) {
      setError("Wait for the image upload to finish.");
      return;
    }
    if (!imageDataUrl) {
      setError("Upload one image to generate the ad.");
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
      const isBuiltInTemplate = selectedTemplate ? isBuiltInAdStudioTemplate(selectedTemplate.id) : false;
      await onGenerate({
        mode: isBlank || !isBuiltInTemplate ? "custom" : "template",
        source,
        templateId: isBlank || !isBuiltInTemplate ? undefined : selectedTemplate?.id,
        templateKey: selectedTemplate?.templateKey ?? selectedTemplate?.id,
        savedAdId: radarInspiration?.savedId,
        observedAdId: radarInspiration?.observedAdId,
        hooks: radarInspiration?.hooks,
        referenceCta: radarInspiration?.cta,
        referenceAdType: radarInspiration?.adType,
        referenceIntent: radarInspiration?.primaryIntent,
        description: trimmed,
        imageDataUrl,
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
      ? "Create a new ad"
      : step === "template"
        ? "Start with a template"
        : step === "reuse"
          ? "Reuse one of your ads"
          : step === "radar"
            ? "Copy an ad from Ad Radar"
            : isBlank
              ? sourceNote
                ? "Make it yours"
                : "Describe your ad"
              : `${selectedTemplate?.name ?? "Template"} - add your details`;

  const footHint =
    step === "brief"
      ? "Blockwise will generate Story, Feed, and Square."
      : step === "source"
        ? "Three ways to start. You can change everything later."
        : "Pick a starting point. You can change everything later.";

  return (
    <div className="studio-newad-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="studio-newad"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="studio-newad-head">
          {step !== "source" && (
            <button className="studio-newad-x" type="button" aria-label="Back" onClick={goBack}>
              <ArrowLeft aria-hidden size={18} />
            </button>
          )}
          <h2 id={titleId}>{stepTitle}</h2>
          <div className="studio-newad-steps" aria-hidden>
            <span className={`st${step !== "brief" ? " on" : ""}`}><i>1</i>Start</span>
            <span className="ln" />
            <span className={`st${step === "brief" ? " on" : ""}`}><i>2</i>Details</span>
          </div>
          <button className="studio-newad-x" type="button" aria-label="Close" onClick={onClose}>
            <X aria-hidden size={18} />
          </button>
        </div>

        <div className="studio-newad-body">
          {step === "source" && (
            <div className="studio-newad-sources">
              <button type="button" className="studio-newad-source" onClick={() => setStep("template")}>
                <span className="ic"><LayoutGrid aria-hidden size={20} /></span>
                <strong>Start with a template</strong>
                <span>Proven layouts for listings, appraisals and market updates.</span>
              </button>
              <button type="button" className="studio-newad-source" onClick={() => setStep("reuse")}>
                <span className="ic"><Copy aria-hidden size={20} /></span>
                <strong>Reuse one of your ads</strong>
                <span>Open a previous ad to duplicate or tweak.</span>
              </button>
              <button type="button" className="studio-newad-source" onClick={() => setStep("radar")}>
                <span className="ic"><Radar aria-hidden size={20} /></span>
                <strong>Copy an ad from Ad Radar</strong>
                <span>Turn a competitor's winning ad into your brief.</span>
              </button>
              <button type="button" className="studio-newad-blanklink" onClick={() => chooseTemplate("")}>
                Or start blank and describe it yourself
              </button>
            </div>
          )}

          {step === "template" && (
            <div className="studio-tpl-grid">
              {templates.map((template, index) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  index={index}
                  active={templateId === template.id}
                  onSelect={chooseTemplate}
                />
              ))}
              <BlankTemplateCard active={isBlank} onSelect={() => chooseTemplate("")} />
            </div>
          )}

          {step === "reuse" && (
            <div className="studio-newad-list">
              {reuseAds === null ? (
                <p className="studio-newad-listmsg">Loading your ads...</p>
              ) : reuseAds.length === 0 ? (
                <p className="studio-newad-listmsg">
                  {reuseError || "No previous ads yet. Start from a template or Ad Radar instead."}
                </p>
              ) : (
                reuseAds.map((ad) => (
                  <button key={ad.id} type="button" className="studio-newad-item" onClick={() => chooseReuse(ad)}>
                    <span className="studio-newad-item-thumb reuse"><Copy aria-hidden size={18} /></span>
                    <span className="studio-newad-item-main">
                      <strong>{ad.name}</strong>
                      <small>{[formatGoal(ad.goal), formatStatus(ad.status), formatDate(ad.createdAt)].filter(Boolean).join(" / ")}</small>
                    </span>
                    <ArrowUpRight aria-hidden size={16} />
                  </button>
                ))
              )}
            </div>
          )}

          {step === "radar" && (
            <div className="studio-newad-list">
              {radarAds === null ? (
                <p className="studio-newad-listmsg">Loading saved Ad Radar ads...</p>
              ) : radarAds.length === 0 ? (
                <p className="studio-newad-listmsg">
                  {radarError || "No saved ads yet. Save ads from Ad Radar, then copy them here."}{" "}
                  <a href="/ad-radar">Open Ad Radar</a>
                </p>
              ) : (
                radarAds.map((ad) => (
                  <button key={ad.savedId} type="button" className="studio-newad-item" onClick={() => chooseRadar(ad)}>
                    <span className="studio-newad-item-thumb">
                      {ad.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ad.thumb} alt="" onError={(event) => (event.currentTarget.style.display = "none")} />
                      ) : (
                        <Radar aria-hidden size={18} />
                      )}
                    </span>
                    <span className="studio-newad-item-main">
                      <strong>{ad.headline || ad.body || "Untitled ad"}</strong>
                      <small>{ad.pageName}</small>
                    </span>
                    <Copy aria-hidden size={16} />
                  </button>
                ))
              )}
            </div>
          )}

          {step === "brief" && (
            <div className="studio-newad-own">
              {sourceNote ? <p className="studio-newad-note">{sourceNote}</p> : <p className="studio-newad-note">{trialCreditNote}</p>}
              <AssetUploadDropzone
                className="studio-newad-upload"
                label="Upload one image"
                actionText="Upload one image"
                helperText="JPG, PNG, or WebP / up to 8 MB"
                previewUrl={imageDataUrl}
                previewAlt=""
                fileName={imageName}
                acceptedTypes={AD_IMAGE_UPLOAD_TYPES}
                maxBytes={AD_IMAGE_MAX_BYTES}
                typeError="Use a JPG, PNG, or WebP image."
                sizeError="Use an image under 8 MB."
                capturePagePaste
                onFileAccepted={selectImage}
                onFileRejected={setError}
                onClear={() => {
                  setImageDataUrl("");
                  setImageName("");
                  setError("");
                  setUploadingImage(false);
                }}
              />
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
        </div>

        <div className="studio-newad-foot">
          <span className={error ? "studio-newad-error" : "studio-newad-sel"}>{error || footHint}</span>
          <button className="studio-btn secondary" type="button" onClick={onClose}>Close</button>
          {step === "brief" && (
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
        media?: RadarMedia[];
      }
    | null
    | undefined;
  if (!ad) return null;
  const savedId = String(entry.id ?? "");
  if (!savedId) return null;
  const observedAdId = String(entry.observedAdId ?? ad.id ?? handoffPayload.observedAdId ?? "");
  const headline = ad.creative?.headline?.trim() ?? "";
  const body = ad.creative?.body?.trim() ?? "";
  const cta = ad.creative?.cta?.trim() ?? "";
  if (!headline && !body) return null;
  const image = (ad.media ?? []).find(
    (item) =>
      (item.kind === "image" || item.kind === "thumbnail") &&
      typeof item.url === "string" &&
      /^https?:\/\//i.test(item.url),
  );
  return {
    savedId,
    observedAdId,
    pageName: ad.page?.name?.trim() || "Unknown advertiser",
    headline,
    body,
    cta,
    adType: ad.creative?.adType?.trim() || stringValue(handoffPayload.adType),
    primaryIntent: ad.creative?.primaryIntent?.trim() || stringValue(handoffPayload.primaryIntent),
    hooks: Array.isArray(ad.creative?.hooks)
      ? ad.creative.hooks.filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0)
      : Array.isArray(handoffPayload.hooks)
        ? handoffPayload.hooks.filter((hook): hook is string => typeof hook === "string" && hook.trim().length > 0)
        : [],
    thumb: image?.url ?? null,
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
// NewAdDialog: source chooser (template / reuse / Ad Radar) to details, then generate.
