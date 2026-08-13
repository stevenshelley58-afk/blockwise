"use client";

import { useRef } from "react";
import type { ImageInput, TextInput } from "../../../../packages/ad-template-pack-contract/src/types.js";

// ---------------------------------------------------------------------------
// Inputs Panel — shared content inputs for a Frank pack.
//
// One field per declared textInput and one file control per imageInput.
// Values live in the shared editor state (use-editor-state), so Feed and Story
// both read the same values — one edit updates both placements. Saving embeds
// them in the AdDocument (sharedTextValues + sharedImageValues data URLs).
//
// Images are session-local only for now: picked files become data URLs held in
// browser state. No upload library yet — the label below says so honestly.
// ---------------------------------------------------------------------------

export interface InputsPanelProps {
  textInputs: TextInput[];
  imageInputs: ImageInput[];
  textValues: Record<string, string>;
  /** dataUrl per input key (null = not picked yet). */
  imageValues: Record<string, string | null>;
  onTextChange: (key: string, value: string) => void;
  onImageChange: (key: string, dataUrl: string | null) => void;
  /** Opens the crop dialog for the input's slot in the ACTIVE placement. */
  onCropClick: (key: string) => void;
}

export function InputsPanel({
  textInputs,
  imageInputs,
  textValues,
  imageValues,
  onTextChange,
  onImageChange,
  onCropClick,
}: InputsPanelProps) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-(--line) bg-(--surface) p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Content
      </h3>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        These values fill both the Feed and Story designs — edit once, both update.
      </p>

      <section aria-label="Text">
        <h4 className="mb-2 text-xs font-semibold text-foreground">Text</h4>
        {textInputs.length === 0 ? (
          <p className="mb-4 text-xs text-muted-foreground">This template has no text inputs.</p>
        ) : (
          <div className="mb-5 space-y-4">
            {textInputs.map(input => {
              const value = textValues[input.key] ?? "";
              return (
                <label key={input.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">
                    {input.label}
                  </span>
                  <input
                    type="text"
                    value={value}
                    placeholder={input.placeholder || undefined}
                    maxLength={input.maxLength}
                    onChange={e => onTextChange(input.key, e.target.value)}
                    className="w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-3 py-2 text-sm text-foreground outline-none transition focus:border-(--ui-primary) focus:ring-1 focus:ring-(--ui-primary)/40"
                  />
                  <span className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground">
                    {value.length}/{input.maxLength}
                  </span>
                </label>
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
            {imageInputs.map(input => (
              <ImageSlotControl
                key={input.key}
                input={input}
                dataUrl={imageValues[input.key] ?? null}
                onImageChange={onImageChange}
                onCropClick={() => onCropClick(input.key)}
              />
            ))}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Picked images stay in this browser session only — there is no upload
          library yet, so they are not stored on the server.
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
  onImageChange,
  onCropClick,
}: {
  input: ImageInput;
  dataUrl: string | null;
  onImageChange: (key: string, dataUrl: string | null) => void;
  onCropClick: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const accept = input.acceptedTypes.length > 0 ? input.acceptedTypes.join(",") : "image/*";

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    // Session-local only: read the file into a data URL that previews AND
    // travels inside the Save document (the save route fetches it server-side).
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onImageChange(input.key, reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-foreground">{input.label}</span>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        aria-label={`Choose image for ${input.label}`}
        onChange={e => {
          handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-picking the same file
        }}
      />
      {dataUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={dataUrl}
            alt={`${input.label} preview`}
            className="h-16 w-16 shrink-0 rounded-(--r-control) border border-(--line) object-cover"
          />
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-(--r-control) border border-(--line) px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-(--surface-subtle)"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onCropClick}
              className="rounded-(--r-control) border border-(--line) px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-(--surface-subtle)"
            >
              Crop…
            </button>
            <button
              type="button"
              onClick={() => onImageChange(input.key, null)}
              className="rounded-(--r-control) border border-(--line) px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-(--surface-subtle) hover:text-red-600"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-(--r-control) border border-dashed border-(--line) px-3 py-3 text-sm font-medium text-muted-foreground transition hover:border-(--ui-primary) hover:text-(--ui-primary)"
        >
          Choose image…
        </button>
      )}
    </div>
  );
}
