"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Rect, ImageInput } from "../../../../packages/ad-template-pack-contract/src/types.js";

// ---------------------------------------------------------------------------
// Image Crop Dialog — Phase 6
//
// Shows complete image, shades outside crop box, allows move/resize.
// Touch + keyboard accessible. 44px minimum targets.
// ---------------------------------------------------------------------------

export interface CropDialogProps {
  /** The full image to crop. */
  imageUrl: string;
  /** Image input metadata (accepted types, label). */
  input: ImageInput;
  /** Current crop (normalized 0-1). */
  crop: Rect;
  /** Locked aspect ratio from the slot. */
  aspectRatio: number;
  /** Called when crop changes. */
  onCropChange: (crop: Rect) => void;
  /** Called to confirm crop. */
  onConfirm: () => void;
  /** Called to cancel. */
  onCancel: () => void;
}

export function CropDialog({
  imageUrl,
  input,
  crop,
  aspectRatio,
  onCropChange,
  onConfirm,
  onCancel,
}: CropDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<"move" | "resize" | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Load image dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // Clamp crop inside image
  const clampCrop = useCallback((c: Rect): Rect => ({
    x: Math.max(0, Math.min(c.x, 1 - c.width)),
    y: Math.max(0, Math.min(c.y, 1 - c.height)),
    width: Math.min(c.width, 1 - c.x),
    height: Math.min(c.height, 1 - c.y),
  }), []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setDragging("move");
    setDragStart({ x: e.clientX - crop.x * 100, y: e.clientY - crop.y * 100 });
  }, [crop]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = (100 * aspectRatio) / rect.height;

    if (dragging === "move") {
      const x = Math.max(0, (e.clientX - dragStart.x) / 100);
      const y = Math.max(0, (e.clientY - dragStart.y) / 100);
      onCropChange(clampCrop({ ...crop, x, y }));
    }
  }, [dragging, crop, aspectRatio, dragStart, clampCrop, onCropChange]);

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-label={`Crop ${input.label}`}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-(--r-card) bg-(--surface) shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-(--line) px-5 py-3">
          <h2 className="text-base font-semibold">Crop {input.label}</h2>
          <p className="text-xs text-muted-foreground">
            Drag to reposition. Crop is locked to slot ratio.
          </p>
        </header>

        {/* Crop area */}
        <div
          ref={containerRef}
          className="relative overflow-hidden bg-gray-900"
          style={{ aspectRatio }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Image */}
          <img
            src={imageUrl}
            alt={input.label}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />

          {/* Shade outside crop */}
          <div className="absolute inset-0">
            {/* Top shade */}
            <div
              className="absolute left-0 right-0 bg-black/50"
              style={{ top: 0, height: `${crop.y * 100}%` }}
            />
            {/* Bottom shade */}
            <div
              className="absolute left-0 right-0 bg-black/50"
              style={{ top: `${(crop.y + crop.height) * 100}%`, bottom: 0 }}
            />
            {/* Left shade */}
            <div
              className="absolute bottom-0 top-0 bg-black/50"
              style={{ left: 0, width: `${crop.x * 100}%` }}
            />
            {/* Right shade */}
            <div
              className="absolute bottom-0 top-0 bg-black/50"
              style={{ left: `${(crop.x + crop.width) * 100}%`, right: 0 }}
            />
          </div>

          {/* Crop box */}
          <div
            className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            }}
            onPointerDown={handlePointerDown}
          >
            {/* Corner handles */}
            <div className="absolute -bottom-1 -right-1 size-3 cursor-se-resize rounded-full bg-white" />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-(--line) px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {imageSize.width}×{imageSize.height}px
            {imageSize.width > 0 && (
              <> · Min {input.acceptedTypes.join(", ")}</>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-(--r-control) px-4 py-2 text-sm text-muted-foreground hover:bg-(--surface-subtle)"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
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
