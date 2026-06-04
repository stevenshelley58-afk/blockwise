"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, LayoutGrid, Upload, Wand2, X } from "lucide-react";

import type { AdStudioTemplate, FirstAdInput } from "@/lib/adstudio";

type Mode = "template" | "custom";
type Step = "mode" | "template" | "brief";

type NewAdDialogProps = {
  open: boolean;
  onClose: () => void;
  templates: AdStudioTemplate[];
  onGenerate: (input: FirstAdInput) => Promise<void>;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function NewAdDialog({ open, onClose, templates, onGenerate }: NewAdDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("template");
  const [step, setStep] = useState<Step>("mode");
  const [templateId, setTemplateId] = useState<string | undefined>(templates[0]?.id);
  const [description, setDescription] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMode("template");
    setStep("mode");
    setTemplateId(templates[0]?.id);
    setDescription("");
    setImageDataUrl("");
    setImageName("");
    setError("");
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, templates]);

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

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];

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

  function chooseMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setStep(nextMode === "template" ? "template" : "brief");
  }

  function chooseTemplate(id: string) {
    setTemplateId(id);
    setStep("brief");
  }

  async function selectImage(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Use a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Use an image under 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageDataUrl(String(event.target?.result ?? ""));
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function submit() {
    const trimmed = description.trim();
    if (mode === "template" && !selectedTemplate) {
      setError("Choose a template to continue.");
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
        mode,
        templateId: mode === "template" ? selectedTemplate.id : undefined,
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
          {step !== "mode" && (
            <button className="studio-newad-x" type="button" aria-label="Back" onClick={() => setStep(mode === "template" && step === "brief" ? "template" : "mode")}>
              <ArrowLeft aria-hidden size={18} />
            </button>
          )}
          <h2 id={titleId}>{step === "mode" ? "How do you want to start?" : step === "template" ? "Start with a template" : "Create your ad"}</h2>
          <button className="studio-newad-x" type="button" aria-label="Close" onClick={onClose}>
            <X aria-hidden size={18} />
          </button>
        </div>

        <div className="studio-newad-body">
          {step === "mode" && (
            <div className="studio-newad-modes">
              <button className="studio-newad-mode" type="button" onClick={() => chooseMode("template")}>
                <span className="ic"><LayoutGrid aria-hidden size={20} /></span>
                <span className="tx"><strong>Start with a template</strong></span>
                <span className="ck"><Check aria-hidden size={13} /></span>
              </button>
              <button className="studio-newad-mode" type="button" onClick={() => chooseMode("custom")}>
                <span className="ic"><Wand2 aria-hidden size={20} /></span>
                <span className="tx"><strong>Create your own</strong></span>
              </button>
            </div>
          )}

          {step === "template" && (
            <div className="studio-newad-grid">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={`studio-newad-card${templateId === template.id ? " active" : ""}`}
                  aria-pressed={templateId === template.id}
                  onClick={() => chooseTemplate(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span className="purpose">{template.promptHint}</span>
                </button>
              ))}
            </div>
          )}

          {step === "brief" && (
            <div className="studio-newad-own">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => void selectImage(event.target.files?.[0])}
              />
              <button className="studio-newad-drop" type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden size={26} />
                <strong>{imageName || "Upload one image"}</strong>
                <span>JPG, PNG, or WebP</span>
              </button>
              <label className="studio-newad-field">
                <span>Short description</span>
                <textarea
                  value={description}
                  maxLength={500}
                  rows={5}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Example: Open home this Saturday, 3 bed family home in Scarborough with renovated kitchen."
                />
                <small>{description.length}/500</small>
              </label>
            </div>
          )}
        </div>

        <div className="studio-newad-foot">
          <span className={error ? "studio-newad-error" : "studio-newad-sel"}>
            {error || (step === "brief" ? "Blockwise will generate Story, Feed, and Square." : " ")}
          </span>
          <button className="studio-btn secondary" type="button" onClick={onClose}>Close</button>
          {step === "brief" && (
            <button className="studio-btn accent" type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Generating" : "Generate ad"}
              <ArrowUpRight aria-hidden size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
