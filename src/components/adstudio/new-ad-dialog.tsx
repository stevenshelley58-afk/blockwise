"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";

import { AssetUploadDropzone } from "@/components/asset-upload-dropzone";
import type { AdStudioBrandKit, AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";
import { AD_IMAGE_MAX_BYTES, AD_IMAGE_UPLOAD_TYPES } from "@/lib/upload/asset-file";

import { uploadAdStudioMedia } from "./media-upload";
import { BlankTemplateCard, TemplateCard } from "./panels/templates-panel";

type Step = "template" | "brief";

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
  onGenerate: (input: FirstAdInput) => Promise<void>;
  /** Pre-select a template (e.g. launched from the Templates panel). */
  initialTemplateId?: string;
};

export function NewAdDialog({ open, onClose, brandKit, workspaceId, templates, onGenerate, initialTemplateId }: NewAdDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [step, setStep] = useState<Step>("template");
  // undefined = nothing chosen yet; "" = blank (create your own)
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [trialCreditNote, setTrialCreditNote] = useState("Uses one ad pack. No Meta account is needed until publish.");

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (initialTemplateId !== undefined) {
      setTemplateId(initialTemplateId);
      setStep("brief");
    } else {
      setTemplateId(undefined);
      setStep("template");
    }
    setDescription("");
    setImageDataUrl("");
    setImageName("");
    setError("");
    setUploadingImage(false);
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, initialTemplateId]);

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
    setError("");
    setStep("brief");
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
      await onGenerate({
        mode: isBlank ? "custom" : "template",
        templateId: isBlank ? undefined : selectedTemplate?.id,
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

  const stepTitle = step === "template" ? "Start with a template" : isBlank ? "Describe your ad" : `${selectedTemplate?.name ?? "Template"} — add your details`;

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
          {step === "brief" && (
            <button className="studio-newad-x" type="button" aria-label="Back" onClick={() => setStep("template")}>
              <ArrowLeft aria-hidden size={18} />
            </button>
          )}
          <h2 id={titleId}>{stepTitle}</h2>
          <div className="studio-newad-steps" aria-hidden>
            <span className={`st${step === "template" ? " on" : ""}`}><i>1</i>Template</span>
            <span className="ln" />
            <span className={`st${step === "brief" ? " on" : ""}`}><i>2</i>Details</span>
          </div>
          <button className="studio-newad-x" type="button" aria-label="Close" onClick={onClose}>
            <X aria-hidden size={18} />
          </button>
        </div>

        <div className="studio-newad-body">
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

          {step === "brief" && (
            <div className="studio-newad-own">
              <p className="studio-newad-note">{trialCreditNote}</p>
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
          <span className={error ? "studio-newad-error" : "studio-newad-sel"}>
            {error || (step === "brief" ? "Blockwise will generate Story, Feed, and Square." : "Pick a starting point — you can change everything later.")}
          </span>
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

function formatTrialCreditNote(status: TrialStatus | null): string {
  if (status?.isTrial && Number.isFinite(status.includedAdPacks) && status.includedAdPacks > 0) {
    return `Uses 1 of ${status.includedAdPacks} free ad packs. No Meta account is needed until publish.`;
  }

  return "Uses one ad pack. No Meta account is needed until publish.";
}
// NewAdDialog: template gallery → details (image + description) → generate.
