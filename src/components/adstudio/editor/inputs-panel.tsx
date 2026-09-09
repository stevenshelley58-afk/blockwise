"use client";

import { useEffect, useRef } from "react";
import type { ImageInput, TextInput } from "../../../../packages/ad-template-contract/src/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  /**
   * "Use template copy" checkbox. ON fills EMPTY fields with the template's
   * suggestions; OFF clears only still-unedited template-filled fields —
   * customer copy is never destroyed unpredictably.
   */
  templateCopyApplied?: boolean;
  /** Whether the template offers any suggested copy worth inserting. */
  templateCopyAvailable?: boolean;
  onTemplateCopyChange?: (enabled: boolean) => void;
  /**
   * Customer-facing display name used in Meta previews. Defaults to the
   * workspace Brand Pack's business name; an explicit value here wins.
   */
  businessName?: string;
  businessNameDefault?: string;
  onBusinessNameChange?: (value: string) => void;
  /** Workspace library assets (Brand Studio uploads) available to pick. */
  libraryAssets?: Array<{ id?: string; url: string; label: string }>;
  /** Picks a library asset for an image slot. */
  onLibraryPick?: (key: string, sourceAssetId: string) => void | Promise<void>;
  showTextInputs?: boolean;
  showImageInputs?: boolean;
  showTemplateControls?: boolean;
  showBusinessName?: boolean;
  focusRequest?: { inputKey: string; requestId: string | number } | null;
  /** Logical input selected from either placement's preview. */
  activeInputKey?: string | null;
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
  templateCopyApplied = false,
  templateCopyAvailable = false,
  onTemplateCopyChange,
  businessName,
  businessNameDefault = "",
  onBusinessNameChange,
  libraryAssets,
  onLibraryPick,
  showTextInputs = true,
  showImageInputs = true,
  showTemplateControls = true,
  showBusinessName = true,
  focusRequest = null,
  activeInputKey = null,
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
    <aside aria-label="Creative" className={cn("w-full shrink-0 overflow-y-auto bg-card p-4 xl:w-auto", className)}>
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        {showImageInputs && !showTextInputs ? "Images" : "Content"}
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        These values fill both the Feed and Story designs — edit once, both update.
      </p>

      {showTemplateControls && templateCopyAvailable && onTemplateCopyChange ? (
        <div className="mb-4 flex min-h-11 items-start gap-2.5 rounded-(--r-card) border border-border px-3 py-2.5">
          <Checkbox
            id="use-template-copy"
            checked={templateCopyApplied}
            onCheckedChange={checked => onTemplateCopyChange(checked === true)}
            className="mt-0.5"
            aria-describedby="use-template-copy-description"
          />
          <div className="min-w-0">
            <Label htmlFor="use-template-copy" className="text-sm font-medium">
              Use template copy
            </Label>
            <p id="use-template-copy-description" className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {templateCopyApplied
                ? "Fills empty fields with the template's suggestions. Unchecking clears only fields you haven't edited."
                : "Start from the template's suggested wording — every filled field stays editable."}
            </p>
          </div>
        </div>
      ) : null}

      {showBusinessName && onBusinessNameChange ? (
        <div className="mb-5">
          <Label htmlFor="creative-business-name" className="mb-1 block text-sm font-medium">
            Business name
          </Label>
          <Input
            id="creative-business-name"
            type="text"
            value={businessName ?? ""}
            placeholder={businessNameDefault || "Your business name"}
            maxLength={80}
            onChange={e => onBusinessNameChange(e.target.value)}
            className="min-h-11 rounded-(--r-card) bg-muted/30"
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
            {businessNameDefault
              ? `Shown with your ad on Facebook and Instagram. Defaults to “${businessNameDefault}” from your Brand Pack.`
              : "Shown with your ad on Facebook and Instagram."}
          </span>
        </div>
      ) : null}

      {showTextInputs ? <section aria-label="Text">
        <h4 className="mb-2 text-xs font-semibold text-foreground">Text</h4>
        {textInputs.length === 0 ? (
          <p className="mb-4 text-xs text-muted-foreground">This template has no text inputs.</p>
        ) : (
          <div className="mb-5 space-y-4">
            {textInputs.map(input => {
              const value = textValues[input.key] ?? "";
              const active = activeInputKey === input.key;
              const multiline = shouldUseMultilineTextInput(input, value);
              return (
                <div key={input.key} className="block">
                  <Label htmlFor={`creative-${input.key}`} className="mb-1 block text-sm font-medium">{input.label}</Label>
                  <Input
                    id={`creative-${input.key}`}
                    type="text"
                    value={value}
                    placeholder={input.placeholder || undefined}
                    maxLength={input.maxLength}
                    onChange={e => onTextChange(input.key, e.target.value)}
                    className="min-h-11 rounded-(--r-card) bg-muted/30"
                    aria-describedby={`creative-${input.key}-count`}
                  />
                  <span id={`creative-${input.key}-count`} className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
                    {value.length}/{input.maxLength}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section> : null}

      {showImageInputs ? <section aria-label="Images">
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
                libraryAssets={libraryAssets}
                onLibraryPick={onLibraryPick}
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
                      libraryAssets={libraryAssets}
                      onLibraryPick={onLibraryPick}
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
      </section> : null}
    </aside>
  );
}

/** Long authored fields and generated line-broken lists must stay editable as written. */
export function shouldUseMultilineTextInput(input: Pick<TextInput, "maxLength" | "placeholder">, value: string): boolean {
  return input.maxLength > 100 || /[\r\n]/u.test(value) || /[\r\n]/u.test(input.placeholder ?? "");
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
  libraryAssets,
  onLibraryPick,
}: {
  input: ImageInput;
  dataUrl: string | null;
  defaultUrl: string | null;
  active: boolean;
  setFocusTarget: (node: HTMLElement | null) => void;
  onFieldFocus: () => void;
  onImageChange: (key: string, change: { file: File; previewUrl: string } | null) => void;
  onCropClick: () => void;
  libraryAssets?: Array<{ id?: string; url: string; label: string }>;
  onLibraryPick?: (key: string, sourceAssetId: string) => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLDetailsElement>(null);
  const accept = input.acceptedTypes.length > 0 ? input.acceptedTypes.join(",") : "image/*";
  const displayUrl = dataUrl ?? defaultUrl;
  const hasLibrary = !!libraryAssets && libraryAssets.length > 0 && !!onLibraryPick;

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

  const pickFromLibrary = (sourceAssetId: string) => {
    void onLibraryPick?.(input.key, sourceAssetId);
    if (libraryRef.current) libraryRef.current.open = false;
  };

  const libraryPicker = hasLibrary ? (
    <details ref={libraryRef} className="w-full rounded-(--r-ctl) border border-border bg-muted/20">
      <summary className="cursor-pointer select-none px-3 py-2.5 text-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Library…
      </summary>
      <div className="grid grid-cols-3 gap-2 border-t border-border p-2">
        {libraryAssets!.map(asset => (
          <button
            key={asset.id ?? asset.url}
            type="button"
            onClick={() => asset.id && pickFromLibrary(asset.id)}
            className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-(--r-ctl)"
            aria-label={`Use library image ${asset.label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.url}
              alt={asset.label}
              className="h-16 w-full rounded-(--r-ctl) border border-border object-cover transition group-hover:border-primary"
            />
          </button>
        ))}
      </div>
    </details>
  ) : null;

  return (
    <div id={`creative-${input.key}`} tabIndex={-1}>
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
            {libraryPicker}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            className="min-h-11 w-full rounded-(--r-ctl) border-dashed text-muted-foreground hover:text-primary"
          >
            Choose image…
          </Button>
          {libraryPicker}
        </div>
      )}
    </div>
  );
}
