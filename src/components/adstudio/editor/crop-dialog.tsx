"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Rect, ImageInput } from "../../../../packages/ad-template-pack-contract/src/types";

// ---------------------------------------------------------------------------
// Image Crop Dialog — Phase 6
//
// Shows the complete image letterboxed inside the slot's aspect ratio,
// shades everything outside the crop box, and lets the user move/resize the
// box. The box aspect is LOCKED to the slot, so the crop region maps into
// the slot without distortion (the renderer draws cropOverrides[inputKey]
// — normalized [0,1] over the source image — straight into the slot rect).
// Touch + keyboard accessible (Escape cancels), 44px minimum targets.
// Cancel/Apply: Apply reports the final normalized rect via onConfirm.
// ---------------------------------------------------------------------------

export interface CropDialogProps {
  /** The full image to crop. */
  imageUrl: string;
  /** Image input metadata (accepted types, label). */
  input: ImageInput;
  /** Current crop (normalized 0-1 over the image) — override or default. */
  crop: Rect;
  /** Locked aspect ratio from the slot (geometry width / height). */
  aspectRatio: number;
  /** Called with the confirmed crop (normalized 0-1). */
  onConfirm: (crop: Rect) => void;
  /** Called to cancel. */
  onCancel: () => void;
}

/** Letterboxed image display rect, in container pixels. */
interface ImageDisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MIN_CROP_SIZE = 0.05;

/**
 * Fit a crop rect to the slot aspect ratio.
 * A rect whose display aspect already matches is kept (clamped into the
 * image); anything else becomes the largest centered box with the target
 * aspect that fits inside the image display rect.
 */
function fitCropToAspect(crop: Rect, aspectRatio: number, rect: ImageDisplayRect): Rect {
  const displayWidth = crop.width * rect.width;
  const displayHeight = crop.height * rect.height;
  const displayAspect = displayWidth / displayHeight;

  let box: { x: number; y: number; width: number; height: number };
  if (Math.abs(displayAspect - aspectRatio) < 1e-6) {
    box = {
      x: rect.x + crop.x * rect.width,
      y: rect.y + crop.y * rect.height,
      width: displayWidth,
      height: displayHeight,
    };
  } else if (aspectRatio >= rect.width / rect.height) {
    // Box is wider than the image — fit by width, letterbox vertically.
    const width = rect.width;
    const height = width / aspectRatio;
    box = { x: rect.x, y: rect.y + (rect.height - height) / 2, width, height };
  } else {
    // Box is taller than the image — fit by height, letterbox horizontally.
    const height = rect.height;
    const width = height * aspectRatio;
    box = { x: rect.x + (rect.width - width) / 2, y: rect.y, width, height };
  }

  return {
    x: clamp((box.x - rect.x) / rect.width, 0, 1 - clamp(box.width / rect.width, 0, 1)),
    y: clamp((box.y - rect.y) / rect.height, 0, 1 - clamp(box.height / rect.height, 0, 1)),
    width: clamp(box.width / rect.width, MIN_CROP_SIZE, 1),
    height: clamp(box.height / rect.height, MIN_CROP_SIZE, 1),
  };
}

export function CropDialog({
  imageUrl,
  input,
  crop: initialCrop,
  aspectRatio,
  onConfirm,
  onCancel,
}: CropDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [imgRect, setImgRect] = useState<ImageDisplayRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [crop, setCrop] = useState<Rect>(initialCrop);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; startCrop: Rect } | null>(null);
  const aspectFitted = useRef(false);

  // Capture the control that opened the modal, move focus into the dialog,
  // and return focus when the dialog closes. This keeps keyboard users in the
  // editor instead of dropping them back at the document root.
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const initialFocus = cancelButtonRef.current ?? dialogRef.current;
    initialFocus?.focus();
    return () => {
      const returnFocus = returnFocusRef.current;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  // Load image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  const handleDialogKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onCancel]);

  // Measure the letterboxed image display rect; fit the initial crop once.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || imageSize.width === 0) return;
    const containerWidth = el.clientWidth;
    const containerHeight = el.clientHeight;
    const imageAspect = imageSize.width / imageSize.height;
    let rect: ImageDisplayRect;
    if (imageAspect > aspectRatio) {
      const height = containerWidth / imageAspect;
      rect = { x: 0, y: (containerHeight - height) / 2, width: containerWidth, height };
    } else {
      const width = containerHeight * imageAspect;
      rect = { x: (containerWidth - width) / 2, y: 0, width, height: containerHeight };
    }
    setImgRect(rect);
    if (!aspectFitted.current) {
      aspectFitted.current = true;
      setCrop(fitCropToAspect(initialCrop, aspectRatio, rect));
    }
  }, [imageSize, aspectRatio, initialCrop]);

  const beginDrag = useCallback(
    (e: React.PointerEvent, mode: "move" | "resize") => {
      e.preventDefault();
      e.stopPropagation();
      if (!containerRef.current) return;
      containerRef.current.setPointerCapture(e.pointerId);
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startCrop: crop };
    },
    [crop],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || imgRect.width === 0 || imgRect.height === 0) return;
      const dx = (e.clientX - drag.startX) / imgRect.width;
      const dy = (e.clientY - drag.startY) / imgRect.height;

      if (drag.mode === "move") {
        const x = clamp(drag.startCrop.x + dx, 0, 1 - drag.startCrop.width);
        const y = clamp(drag.startCrop.y + dy, 0, 1 - drag.startCrop.height);
        setCrop({ ...drag.startCrop, x, y });
        return;
      }

      // Resize from the bottom-right handle, anchored at the top-left.
      // Normalized width w and height h relate to display pixels as
      // w*rect.width / (h*rect.height) — the aspect lock means that ratio
      // must equal the slot aspectRatio, so w = h * ratio.
      const ratio = aspectRatio * (imgRect.height / imgRect.width);
      const newWidth = drag.startCrop.width + dx;
      const newHeight = drag.startCrop.height + dy;
      // Scale by whichever axis the pointer moved most, then derive the other.
      const width =
        Math.abs(dx) >= Math.abs(dy * ratio) ? newWidth : newHeight * ratio;
      const maxWidth = Math.min(1 - drag.startCrop.x, (1 - drag.startCrop.y) * ratio);
      const bounded = clamp(width, MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, maxWidth));
      setCrop({
        x: drag.startCrop.x,
        y: drag.startCrop.y,
        width: bounded,
        height: bounded / ratio,
      });
    },
    [aspectRatio, imgRect],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Pointer dragging is convenient, but these numeric controls make the
  // crop's move/resize operations fully keyboard accessible and precise.
  const updateNumericCrop = useCallback((axis: "x" | "y" | "width", value: number) => {
    if (!Number.isFinite(value)) return;
    if (axis === "x") {
      setCrop(current => ({ ...current, x: clamp(value / 100, 0, 1 - current.width) }));
      return;
    }
    if (axis === "y") {
      setCrop(current => ({ ...current, y: clamp(value / 100, 0, 1 - current.height) }));
      return;
    }
    const ratio = aspectRatio * (imgRect.height / Math.max(1, imgRect.width));
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setCrop(current => {
      const maxWidth = Math.min(1 - current.x, (1 - current.y) * ratio);
      const width = clamp(value / 100, MIN_CROP_SIZE, Math.max(MIN_CROP_SIZE, maxWidth));
      return { ...current, width, height: Math.min(1 - current.y, width / ratio) };
    });
  }, [aspectRatio, imgRect]);

  const boxStyle = imgRect.width > 0
    ? {
        left: imgRect.x + crop.x * imgRect.width,
        top: imgRect.y + crop.y * imgRect.height,
        width: crop.width * imgRect.width,
        height: crop.height * imgRect.height,
      }
    : undefined;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Crop ${input.label}`}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-(--r-card) bg-(--surface) shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 border-b border-(--line) px-5 py-3">
          <div>
            <h2 id="crop-dialog-title" className="text-base font-semibold">Crop {input.label}</h2>
            <p id="crop-dialog-description" className="text-xs text-muted-foreground">
              Drag to reposition · handle to resize · locked to slot ratio.
            </p>
          </div>
          <SlotPreview
            imageUrl={imageUrl}
            alt={input.label}
            crop={crop}
            aspectRatio={aspectRatio}
            imageSize={imageSize}
          />
        </header>

        {/* Crop area — live preview of the slot (image letterboxed to slot ratio) */}
        <div
          ref={containerRef}
          className="relative overflow-hidden bg-gray-900 select-none"
          style={{ aspectRatio, touchAction: "none" }}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={input.label}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />

          {/* Crop box — shadow shades everything outside it (incl. letterbox) */}
          {boxStyle && (
            <div
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
              style={boxStyle}
              onPointerDown={e => beginDrag(e, "move")}
              aria-label="Crop region — drag to reposition"
            >
              {/* Corner handle */}
              <div
                className="absolute -bottom-2 -right-2 size-4 cursor-se-resize rounded-full border-2 border-white bg-(--ui-primary)"
                onPointerDown={e => beginDrag(e, "resize")}
                aria-label="Resize crop"
              />
            </div>
          )}
        </div>

        <fieldset className="grid grid-cols-3 gap-2 border-b border-(--line) px-5 py-3" aria-label="Keyboard crop controls">
          <legend className="sr-only">Keyboard crop controls</legend>
          <label className="text-[11px] text-muted-foreground">
            Left (%)
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(crop.x * 100)}
              onChange={event => updateNumericCrop("x", Number(event.target.value))}
              aria-label="Crop left position (%)"
              disabled={imgRect.width === 0}
              className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Top (%)
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={Math.round(crop.y * 100)}
              onChange={event => updateNumericCrop("y", Number(event.target.value))}
              aria-label="Crop top position (%)"
              disabled={imgRect.width === 0}
              className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Width (%)
            <input
              type="number"
              min="5"
              max="100"
              step="1"
              value={Math.round(crop.width * 100)}
              onChange={event => updateNumericCrop("width", Number(event.target.value))}
              aria-label="Crop width (%)"
              disabled={imgRect.width === 0}
              className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--surface-subtle) px-2 py-1.5 text-sm text-foreground"
            />
          </label>
        </fieldset>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-(--line) px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {imageSize.width > 0 ? (
              <>
                {imageSize.width}×{imageSize.height}px ·{" "}
                {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}% of image
              </>
            ) : (
              "Loading image…"
            )}
          </p>
          <div className="flex gap-2">
            <button
              ref={cancelButtonRef}
              onClick={onCancel}
              className="rounded-(--r-control) px-4 py-2 text-sm text-muted-foreground hover:bg-(--surface-subtle)"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(crop)}
              className="rounded-(--r-control) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Apply crop
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SlotPreview — miniature of the slot: image letterboxed to the slot ratio
// with the crop region outlined. Updates live as the box moves/resizes.
// ---------------------------------------------------------------------------

function SlotPreview({
  imageUrl,
  alt,
  crop,
  aspectRatio,
  imageSize,
}: {
  imageUrl: string;
  alt: string;
  crop: Rect;
  aspectRatio: number;
  imageSize: { width: number; height: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<ImageDisplayRect>({ x: 0, y: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || imageSize.width === 0) return;
    const containerWidth = el.clientWidth;
    const containerHeight = el.clientHeight;
    const imageAspect = imageSize.width / imageSize.height;
    if (imageAspect > aspectRatio) {
      const height = containerWidth / imageAspect;
      setRect({ x: 0, y: (containerHeight - height) / 2, width: containerWidth, height });
    } else {
      const width = containerHeight * imageAspect;
      setRect({ x: (containerWidth - width) / 2, y: 0, width, height: containerHeight });
    }
  }, [imageSize, aspectRatio]);

  return (
    <div
      ref={ref}
      className="relative w-24 shrink-0 overflow-hidden rounded-(--r-control) border border-(--line) bg-gray-900"
      style={{ aspectRatio }}
      aria-hidden="true"
      title="Live slot preview"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={alt} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      {rect.width > 0 && (
        <div
          className="absolute border-2 border-white/90"
          style={{
            left: rect.x + crop.x * rect.width,
            top: rect.y + crop.y * rect.height,
            width: crop.width * rect.width,
            height: crop.height * rect.height,
          }}
        />
      )}
    </div>
  );
}
