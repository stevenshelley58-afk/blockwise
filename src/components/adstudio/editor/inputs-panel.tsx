"use client";

import { useEffect, useRef } from "react";
import type { ImageInput, TextInput } from "../../../../packages/ad-template-contract/src/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Inputs Panel — shared content inputs for the selected template. Picked files keep a
// local preview while uploading directly to private workspace media refs.
//
// One field per declared textInput and one file control per imageInput.
// Values live in the shared editor state (use-editor-state), so Feed and Story
// both read the same values — one edit updates both placements. Saving embeds
// them in the AdDocument (sharedTextValues + private workspace image refs).
//
// ---------------------------------------------------------------------------

export interface InputsPanelProps {
  className?: string;
  textInputs: TextInput[];
  imageInputs: ImageInput[];
  textValues: Record<string, string>;
  /** dataUrl per input key (null = not picked yet). */
  imageValues: Record<string, string | null>;
  /** Template-provided imagery displayed until the customer replaces it. */
  defaultImageValues: Record<string, string>;
  onTextChange: (key: string, value: string) => void;
  /** Populate every text field with the authored template example. */
  onUseTemplateText: () => void;
  onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => void;
  /** Opens the crop dialog for the input's slot in the ACTIVE placement. */
  onCropClick: (key: string) => void;
  /** Logical input selected from either placement's preview. */
  activeInputKey?: string | null;
  /** Imperative focus request; requestId lets the same field be requested again. */
  focusRequest?: { inputKey: string; requestId: string | number } | null;
  /** Keeps preview selection in sync with keyboard and pointer focus. */
  onFieldFocus?: (key: string) => void;
}

export function InputsPanel({
  className,
  textInputs,
  imageInputs,
  textValues,
  imageValues,
  defaultImageValues,
  onTextChange,
  onUseTemplateText,
  onImageChange,
  onCropClick,
  activeInputKey = null,
  focusRequest = null,
  onFieldFocus,
}: InputsPanelProps) {
  const requiredImageInputs = imageInputs.filter(input => input.required !== false);
  const optionalImageInputs = imageInputs.filter(input => input.required === false);
  const missingRequiredImages = requiredImageInputs.filter(input => !imageValues[input.key] && !defaultImageValues[input.key]);
  const focusTargetsRef = useRef(new Map<string, HTMLElement>());
  const optionalDetailsRef = useRef<HTMLDetailsElement | null>(null);
  const completedFocusRequestRef = useRef<string | null>(null);
  const optionalImageKeys = optionalImageInputs.map(input => input.key).join("\u0000");

  useEffect(() => {
    if (!focusRequest) return;
    const requestKey = `${focusRequest.requestId}:${focusRequest.inputKey}`;
    if (completedFocusRequestRef.current === requestKey) return;
    completedFocusRequestRef.current = requestKey;
    if (optionalImageKeys.split("\u0000").includes(focusRequest.inputKey) && optionalDetailsRef.current) {
      optionalDetailsRef.current.open = true;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = focusTargetsRef.current.get(focusRequest.inputKey);
      if (!target) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, optionalImageKeys]);

  const setFocusTarget = (key: string, node: HTMLElement | null) => {
    if (node) focusTargetsRef.current.set(key, node);
    else focusTargetsRef.current.delete(key);
  };

  return (
    <aside aria-label="Content" className={cn("w-full shrink-0 overflow-y-auto bg-card p-4 xl:w-auto", className)}>
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Content
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        These values fill both the Feed and Story designs — edit once, both update.
      </p>

      <section aria-label="Text">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-foreground">Text</h4>
          {textInputs.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={onUseTemplateText} className="min-h-9 rounded-full px-3 text-xs">
              Use template text
            </Button>
          ) : null}
        </div>
        {textInputs.length === 0 ? (
          <p className="mb-4 text-xs text-muted-foreground">This template has no text inputs.</p>
        ) : (
          <div className="mb-5 space-y-4">
            {textInputs.map(input => {
              const value = textValues[input.key] ?? "";
              const active = activeInputKey === input.key;
              return (
                <div
                  key={input.key}
                  data-active={active || undefined}
                  className={cn(
                    "-mx-2 rounded-(--r-card) p-2 transition-colors",
                    active && "bg-primary/5 ring-2 ring-primary/35",
                  )}
                >
                  <Label htmlFor={`content-${input.key}`} className="mb-1 block text-sm font-medium">{input.label}</Label>
                  <Input
                    ref={node => setFocusTarget(input.key, node)}
                    id={`content-${input.key}`}
                    type="text"
                    value={value}
                    placeholder={input.placeholder || undefined}
                    maxLength={input.maxLength}
                    onChange={e => onTextChange(input.key, e.target.value)}
                    onFocus={() => onFieldFocus?.(input.key)}
                    className="min-h-11 rounded-(--r-card) bg-muted/30"
                    aria-describedby={`content-${input.key}-count`}
                  />
                  <span id={`content-${input.key}-count`} className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
                    {value.length}/{input.maxLength}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-label="Images">
        <h4 className="mb-2 text-xs font-semibold text-foreground">Images</h4>
        {imageInputs.length === 0 ? (
          <p className="mb-4 text-xs text-muted-foreground">This template has no image slots.</p>
        ) : (
          <div className="mb-4 space-y-4">
            <p className="rounded-(--r-card) bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground" role="status">
              {missingRequiredImages.length > 0
                ? `${missingRequiredImages.length} required ${missingRequiredImages.length === 1 ? "image is" : "images are"} still needed. Each label shows where it appears.`
                : "All required images are in place. Replace or crop any image below if needed."}
            </p>
            {requiredImageInputs.map(input => (
              <ImageSlotControl
                key={input.key}
                input={input}
                defaultUrl={defaultImageValues[input.key] ?? null}
                dataUrl={imageValues[input.key] ?? null}
                active={activeInputKey === input.key}
                setFocusTarget={node => setFocusTarget(input.key, node)}
                onFieldFocus={() => onFieldFocus?.(input.key)}
                onImageChange={onImageChange}
                onCropClick={() => onCropClick(input.key)}
              />
            ))}
            {optionalImageInputs.length > 0 ? (
              <details ref={optionalDetailsRef} className="rounded-(--r-ctl) border border-border bg-muted/20">
                <summary className="cursor-pointer px-3 py-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Optional brand details
                </summary>
                <div className="space-y-4 border-t border-border p-3">
                  {optionalImageInputs.map(input => (
                    <ImageSlotControl
                      key={input.key}
                      input={input}
                      defaultUrl={defaultImageValues[input.key] ?? null}
                      dataUrl={imageValues[input.key] ?? null}
                      active={activeInputKey === input.key}
                      setFocusTarget={node => setFocusTarget(input.key, node)}
                      onFieldFocus={() => onFieldFocus?.(input.key)}
                      onImageChange={onImageChange}
                      onCropClick={() => onCropClick(input.key)}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Images are stored privately in your workspace and reused when you
          reopen this ad. They are never added to the public gallery.
        </p>
      </section>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// ImageSlotControl — file picker + session-local preview.
// ---------------------------------------------------------------------------

function ImageSlotControl({
  input,
  dataUrl,
  defaultUrl,
  active,
  setFocusTarget,
  onFieldFocus,
  onImageChange,
  onCropClick,
}: {
  input: ImageInput;
  dataUrl: string | null;
  defaultUrl: string | null;
  active: boolean;
  setFocusTarget: (node: HTMLElement | null) => void;
  onFieldFocus: () => void;
  onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => void;
  onCropClick: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = input.acceptedTypes.length > 0 ? input.acceptedTypes.join(",") : "image/*";
  const displayUrl = dataUrl ?? defaultUrl;

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    // Keep a local preview while the browser uploads bytes directly to private
    // workspace storage. The editor state stores only the returned ref.
    const reader = new FileReader();
    reader.onload = () => {
    if (typeof reader.result === "string") onImageChange(input.key, { file, previewUrl: reader.result });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      data-active={active || undefined}
      className={cn(
        "-mx-2 rounded-(--r-card) p-2 transition-colors",
        active && "bg-primary/5 ring-2 ring-primary/35",
      )}
      onFocusCapture={onFieldFocus}
    >
      <span className="mb-1 flex items-center justify-between gap-2 text-sm font-medium text-foreground">
        <span>{input.label}</span>
        <span className="text-[11px] font-normal text-muted-foreground">{input.required === false ? "Optional" : "Required"}</span>
      </span>
      <input
        ref={fileRef}
        type="file"
        required={input.required !== false}
        accept={accept}
        className="hidden"
        aria-label={`Choose image for ${input.label}`}
        onChange={e => {
          handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      {displayUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayUrl}
            alt={dataUrl ? `${input.label} preview` : `${input.label} template image`}
            className="h-20 w-20 shrink-0 rounded-(--r-card) border border-border object-cover"
          />
          <div className="flex min-w-0 flex-wrap gap-2">
            {!dataUrl && <span className="w-full text-xs text-muted-foreground">Template image</span>}
            <Button
              ref={setFocusTarget}
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              className="min-h-11"
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCropClick}
              disabled={!dataUrl}
              className="min-h-11"
            >
              Crop…
            </Button>
            {dataUrl && <Button
              type="button"
              variant="ghost"
              onClick={() => onImageChange(input.key, null)}
              className="min-h-11 text-muted-foreground hover:text-destructive"
            >
              {defaultUrl ? "Use template image" : "Remove"}
            </Button>}
          </div>
        </div>
      ) : (
        <Button
          ref={setFocusTarget}
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          className="min-h-11 w-full rounded-(--r-ctl) border-dashed text-muted-foreground hover:text-primary"
        >
          Choose image…
        </Button>
      )}
    </div>
  );
}
