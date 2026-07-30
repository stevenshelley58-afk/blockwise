"use client";

import { Check, ChevronLeft, ChevronRight, ImagePlus, ListTree, Redo2, ScanEye, Sparkles, Undo2, WandSparkles, X, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import type { AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types.ts";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";

import {
  CreativeEditError,
  requestCreativeEdit,
  requestCreativeLayers,
  type CreativeEditMutation,
} from "./creative-edit-client";
import {
  loadPatchFonts,
  loadPatchImage,
  PATCH_PADDING,
  renderTextPatch,
} from "./text-patch";

export type InPlaceAdEditorProps = {
  creative: AdStudioCreative;
  onCreativeChange: (next: AdStudioCreative) => void;
  showToast: (msg: string) => void;
};

const MAX_TEXT_LENGTH = 200;
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SLOW_EDIT_MS = 60000;
const ZOOM_LEVELS = [1, 2, 3] as const;

function labelForRegionKey(key: string): string {
  return key.replace(/_/g, " ");
}

function regionStyle(region: AdStudioCloneRegion): CSSProperties {
  const { x, y, width, height } = region.box;
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
    zIndex: region.kind === "text" ? 2 : 1,
  };
}

/** The optimistic patch sits exactly on the region's padded composite rect. */
function optimisticPatchStyle(box: AdStudioCloneRegion["box"]): CSSProperties {
  const left = Math.max(0, box.x - PATCH_PADDING);
  const top = Math.max(0, box.y - PATCH_PADDING);
  const right = Math.min(1, box.x + box.width + PATCH_PADDING);
  const bottom = Math.min(1, box.y + box.height + PATCH_PADDING);
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${(right - left) * 100}%`,
    height: `${(bottom - top) * 100}%`,
  };
}

/**
 * Crop the full ad image down to one region for the element-list thumbnail,
 * using background scaling only — no canvas work, stays crisp on data URLs.
 */
function regionThumbStyle(src: string, box: AdStudioCloneRegion["box"]): CSSProperties {
  const width = Math.min(Math.max(box.width, 0.05), 1);
  const height = Math.min(Math.max(box.height, 0.05), 1);
  const positionX = width >= 1 ? 50 : (Math.min(box.x, 1 - width) / (1 - width)) * 100;
  const positionY = height >= 1 ? 50 : (Math.min(box.y, 1 - height) / (1 - height)) * 100;
  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${100 / width}% ${100 / height}%`,
    backgroundPosition: `${positionX}% ${positionY}%`,
  };
}

function truncateForStatus(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function expectedTextForKey(creative: AdStudioCreative, key: string): string {
  return creative.canvas.cloneQa?.copyValues?.[key] ?? "";
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

export function InPlaceAdEditor({ creative, onCreativeChange, showToast }: InPlaceAdEditorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [instruction, setInstruction] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [stillWorking, setStillWorking] = useState(false);
  const [comparePrevious, setComparePrevious] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  // Finished pixels straight from the edit response — painted immediately so
  // the customer never waits on the media proxy for a render they already own.
  const [freshPreview, setFreshPreview] = useState<{ ref: string; dataUrl: string } | null>(null);
  // The text patch drawn the moment the customer applies a text edit. It IS
  // the final pixels, so the edit reads as instant while the server saves.
  const [optimisticPatch, setOptimisticPatch] = useState<{ key: string; dataUrl: string; box: AdStudioCloneRegion["box"] } | null>(null);
  const [loadedFontIds, setLoadedFontIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const panPointerRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const elementButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const regionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const retryMutationRef = useRef<{ signature: string; mutationId: string } | null>(null);
  const layersRequestedForRef = useRef<string | null>(null);
  const plateImagesRef = useRef(new Map<string, HTMLImageElement>());
  const creativeRef = useRef(creative);
  creativeRef.current = creative;
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const cloneObject = creative.canvas.objects[0];
  const src = cloneObject?.content ?? cloneObject?.assetId ?? "";
  const regions = creative.canvas.cloneQa?.regions ?? [];
  const renderHistory = creative.canvas.renderHistory ?? [];
  const redoHistory = creative.canvas.redoHistory ?? [];
  const textLayers = creative.canvas.textLayers;
  const layersReady = textLayers?.status === "ready" && textLayers.validFor.includes(src);
  // Prefer the inlined finished pixels over a refetch of the same render.
  const stableSrc = freshPreview && freshPreview.ref === src ? freshPreview.dataUrl : src;
  const displaySrc = comparePrevious ? renderHistory.at(-1) ?? stableSrc : stableSrc;
  const busy = pendingKey !== null;
  const selectedRegion = useMemo(
    () => regions.find((region) => region.key === selectedKey),
    [regions, selectedKey],
  );

  useEffect(() => {
    if (!busy) {
      setStillWorking(false);
      return;
    }
    const timer = setTimeout(() => setStillWorking(true), SLOW_EDIT_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (selectedRegion?.kind === "text") textInputRef.current?.focus();
  }, [selectedRegion]);

  useEffect(() => {
    setComparePrevious(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [src]);

  // Background decomposition: build the text-free plate + type treatments the
  // moment the editor opens (or a render invalidates them), so by the time the
  // customer edits text the instant path is ready. Failures are silent — the
  // model path keeps working either way.
  useEffect(() => {
    if (regions.length === 0 || busy) return;
    if (!src || src.startsWith("data:")) return;
    const current = creativeRef.current.canvas.textLayers;
    if (current?.status === "ready" && current.validFor.includes(src)) return;
    if (layersRequestedForRef.current === src) return;
    layersRequestedForRef.current = src;
    let cancelled = false;
    void requestCreativeLayers(creative.creativeId).then((built) => {
      if (cancelled || !built) return;
      const latest = creativeRef.current;
      const latestSrc = latest.canvas.objects[0]?.content ?? latest.canvas.objects[0]?.assetId ?? "";
      if (!built.validFor.includes(latestSrc)) return;
      onCreativeChange({ ...latest, canvas: { ...latest.canvas, textLayers: built } });
    });
    return () => { cancelled = true; };
  }, [busy, creative.creativeId, onCreativeChange, regions.length, src]);

  // Keep the plate decoded and ready so text patches render synchronously.
  useEffect(() => {
    const plate = textLayers?.plate;
    if (!plate || plateImagesRef.current.has(plate)) return;
    let cancelled = false;
    void loadPatchImage(plate)
      .then((image) => { if (!cancelled) plateImagesRef.current.set(plate, image); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [textLayers?.plate]);

  useEffect(() => {
    if (!textLayers) return;
    let cancelled = false;
    void loadPatchFonts(Object.values(textLayers.styles)).then((loaded) => {
      if (!cancelled) setLoadedFontIds(loaded);
    });
    return () => { cancelled = true; };
  }, [textLayers]);

  const updateElementScrollState = useCallback(() => {
    const list = elementListRef.current;
    if (!list) return;
    const maximumScroll = Math.max(0, list.scrollWidth - list.clientWidth);
    setCanScrollBackward(list.scrollLeft > 1);
    setCanScrollForward(list.scrollLeft < maximumScroll - 1);
  }, []);

  const scrollSelectedElementToEnd = useCallback((key: string) => {
    const list = elementListRef.current;
    const button = elementButtonRefs.current.get(key);
    if (!list || !button) return;
    list.scrollTo({
      left: button.offsetLeft + button.offsetWidth - list.clientWidth,
      behavior: preferredScrollBehavior(),
    });
  }, []);

  useEffect(() => {
    const list = elementListRef.current;
    if (!list) return;
    updateElementScrollState();
    list.addEventListener("scroll", updateElementScrollState, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateElementScrollState);
    resizeObserver?.observe(list);
    return () => {
      list.removeEventListener("scroll", updateElementScrollState);
      resizeObserver?.disconnect();
    };
  }, [regions.length, selectedRegion?.key, updateElementScrollState]);

  useEffect(() => {
    if (!selectedKey) return;
    const frame = requestAnimationFrame(() => scrollSelectedElementToEnd(selectedKey));
    return () => cancelAnimationFrame(frame);
  }, [scrollSelectedElementToEnd, selectedKey]);

  const performMutation = useCallback(async (
    mutation: CreativeEditMutation,
    successMessage: string,
    progressLabel?: string,
  ) => {
    if (!creative.activeRevisionId) {
      showToast("This ad changed. Reload it before editing.");
      return;
    }
    const signature = JSON.stringify({
      creativeId: creative.creativeId,
      expectedRevisionId: creative.activeRevisionId,
      mutation,
    });
    const mutationId = retryMutationRef.current?.signature === signature
      ? retryMutationRef.current.mutationId
      : crypto.randomUUID();
    retryMutationRef.current = { signature, mutationId };
    setPendingKey(mutation.fieldKey ?? mutation.action ?? "edit");
    setPendingLabel(progressLabel ?? null);
    try {
      let result;
      try {
        result = await requestCreativeEdit({ creative, mutation, mutationId });
      } catch (error) {
        // The instant path can go stale mid-flight (another device edited, or
        // the plate is still building). Fall back to the model path once —
        // the customer keeps their edit either way.
        if (!(error instanceof CreativeEditError && error.code === "layers_stale" && mutation.patchImage)) {
          throw error;
        }
        setOptimisticPatch(null);
        setPendingLabel("Taking the long way…");
        const fallback: CreativeEditMutation = { ...mutation, patchImage: undefined };
        const fallbackId = crypto.randomUUID();
        retryMutationRef.current = {
          signature: JSON.stringify({
            creativeId: creative.creativeId,
            expectedRevisionId: creative.activeRevisionId,
            mutation: fallback,
          }),
          mutationId: fallbackId,
        };
        result = await requestCreativeEdit({ creative, mutation: fallback, mutationId: fallbackId });
      }
      const nextObject = result.creative.canvas.objects[0];
      const nextRef = nextObject?.content ?? nextObject?.assetId ?? "";
      setFreshPreview(result.previewImage && nextRef ? { ref: nextRef, dataUrl: result.previewImage } : null);
      onCreativeChange(result.creative);
      retryMutationRef.current = null;
      setInstruction("");
      showToast(successMessage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The editor could not reach the server. Your previous version is unchanged.");
    } finally {
      setOptimisticPatch(null);
      setPendingKey(null);
      setPendingLabel(null);
    }
  }, [creative, onCreativeChange, showToast]);

  function scrollElementList(direction: -1 | 1) {
    const list = elementListRef.current;
    if (!list) return;
    list.scrollBy({
      left: direction * Math.max(120, list.clientWidth * 0.8),
      behavior: preferredScrollBehavior(),
    });
  }

  function selectRegion(region: AdStudioCloneRegion) {
    if (busy) return;
    setSelectedKey(region.key);
    setInstruction("");
    setTextDraft(region.kind === "text" ? expectedTextForKey(creative, region.key) : "");
    scrollSelectedElementToEnd(region.key);
  }

  function closeInspector() {
    if (busy) return;
    setSelectedKey(null);
    setInstruction("");
  }

  // Arrow keys walk the ad's elements in place; Escape releases the selection.
  function handleRegionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeInspector();
      return;
    }
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (delta === 0 || busy) return;
    event.preventDefault();
    const next = regions[(index + delta + regions.length) % regions.length];
    if (!next) return;
    selectRegion(next);
    regionButtonRefs.current.get(next.key)?.focus();
  }

  /** Outer transforms (PreviewFit) scale client px; convert back to local px. */
  function frameScaleFactor(): number {
    const frame = frameRef.current;
    if (!frame || frame.clientWidth === 0) return 1;
    return frame.getBoundingClientRect().width / frame.clientWidth;
  }

  const clampPan = useCallback((value: { x: number; y: number }, zoomLevel: number) => {
    const frame = frameRef.current;
    if (!frame || zoomLevel <= 1) return { x: 0, y: 0 };
    const maxX = ((zoomLevel - 1) * frame.clientWidth) / 2;
    const maxY = ((zoomLevel - 1) * frame.clientHeight) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, value.x)),
      y: Math.min(maxY, Math.max(-maxY, value.y)),
    };
  }, []);

  function cycleZoom() {
    const currentIndex = ZOOM_LEVELS.indexOf(zoom as (typeof ZOOM_LEVELS)[number]);
    const next = ZOOM_LEVELS[(currentIndex + 1) % ZOOM_LEVELS.length] ?? 1;
    setZoom(next);
    setPan((current) => clampPan(current, next));
  }

  // Double-click zooms in keeping the clicked detail under the cursor;
  // double-click again to step back out.
  function handleZoomDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName !== "IMG") return;
    if (zoom > 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const scale = frameScaleFactor();
    const localX = (event.clientX - rect.left - rect.width / 2) / scale;
    const localY = (event.clientY - rect.top - rect.height / 2) / scale;
    setZoom(2);
    setPan(clampPan({ x: localX * (1 - 2), y: localY * (1 - 2) }, 2));
  }

  function handlePanPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return;
    if ((event.target as HTMLElement).tagName !== "IMG") return;
    panPointerRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }

  function handlePanPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = panPointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const scale = frameScaleFactor();
    const deltaX = (event.clientX - active.lastX) / scale;
    const deltaY = (event.clientY - active.lastY) / scale;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    setPan((current) => clampPan({ x: current.x + deltaX, y: current.y + deltaY }, zoom));
  }

  function handlePanPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (panPointerRef.current?.pointerId !== event.pointerId) return;
    panPointerRef.current = null;
    setPanning(false);
  }

  function applyTextEdit() {
    if (!selectedRegion || selectedRegion.kind !== "text") return;
    const value = textDraft.trim();
    if (!value) {
      showToast("Type the replacement text first.");
      return;
    }
    const style = textLayers?.styles[selectedRegion.key];
    const maxLength = style?.maxLength ?? MAX_TEXT_LENGTH;
    if (value.length > maxLength) {
      showToast(`Keep the replacement text to ${maxLength} characters or less.`);
      return;
    }

    // Instant path: re-typeset the exact copy over the plate crop right here
    // in the browser. The patch is shown immediately and sent to the server,
    // which composites it deterministically — no image model, ~1s to saved.
    let patchImage: string | undefined;
    if (
      layersReady
      && textLayers
      && style?.mode === "live"
      && loadedFontIds.has(style.fontId)
    ) {
      const plate = plateImagesRef.current.get(textLayers.plate);
      if (plate) {
        patchImage = renderTextPatch({
          plate,
          box: selectedRegion.box,
          style,
          text: value,
        }) ?? undefined;
      }
    }
    if (patchImage) {
      setOptimisticPatch({ key: selectedRegion.key, dataUrl: patchImage, box: selectedRegion.box });
    }
    void performMutation(
      { action: "edit", fieldKey: selectedRegion.key, newValue: value, patchImage },
      "Text updated",
      patchImage ? "Saving…" : `Re-rendering "${truncateForStatus(value)}"…`,
    );
  }

  function applyImageInstruction() {
    if (!selectedRegion || selectedRegion.kind !== "image") return;
    const value = instruction.trim();
    if (!value) {
      showToast("Describe the image change first.");
      return;
    }
    if (value.length > MAX_INSTRUCTION_LENGTH) {
      showToast(`Keep the direction to ${MAX_INSTRUCTION_LENGTH} characters or less.`);
      return;
    }
    void performMutation(
      { action: "edit", fieldKey: selectedRegion.key, instruction: value },
      "Image updated",
      "Repainting this area…",
    );
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (selectedRegion?.kind === "text") applyTextEdit();
      else applyImageInstruction();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeInspector();
    }
  }

  async function handleImageFile(file: File | null) {
    if (!file || !selectedRegion || selectedRegion.kind !== "image") return;
    if (!file.type.startsWith("image/")) {
      showToast("Choose an image file.");
      return;
    }
    try {
      const scaled = await downscaleImageForUpload(file);
      if (scaled.size > MAX_IMAGE_BYTES) {
        showToast("That image is too large. Use one under 4MB.");
        return;
      }
      const dataUrl = await readFileAsDataUrl(scaled);
      await performMutation(
        {
          action: "edit",
          fieldKey: selectedRegion.key,
          newImage: dataUrl,
          instruction: instruction.trim() || undefined,
        },
        "Image replaced",
        "Placing your image…",
      );
    } catch {
      showToast("The image could not be read. Try another file.");
    }
  }

  function restoreVersion(action: "undo" | "redo") {
    if (busy) return;
    void performMutation(
      { action },
      action === "undo" ? "Previous version restored" : "Next version restored",
    );
  }

  if (regions.length === 0) {
    // The finished render shows the moment it persists; editor regions are
    // detected in the background and unlock editing once they land. Until
    // then the ad is shown plainly with no overlay or spinner.
    return (
      <div className="studio-clone-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI-designed ad creative" />
      </div>
    );
  }

  return (
    <div className="studio-inplace-stage" data-inspector-open={selectedRegion ? "true" : undefined}>
      <div className="studio-inplace-frame" ref={frameRef}>
        <div
          className="studio-inplace-zoom"
          data-zoomed={zoom > 1 || undefined}
          data-panning={panning || undefined}
          style={zoom > 1 ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` } : undefined}
          onDoubleClick={handleZoomDoubleClick}
          onPointerDown={handlePanPointerDown}
          onPointerMove={handlePanPointerMove}
          onPointerUp={handlePanPointerEnd}
          onPointerCancel={handlePanPointerEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={displaySrc} alt={comparePrevious ? "Previous ad version" : "AI-designed ad creative"} draggable={false} />
          {optimisticPatch && !comparePrevious ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="studio-inplace-optimistic"
              src={optimisticPatch.dataUrl}
              style={optimisticPatchStyle(optimisticPatch.box)}
              alt=""
              aria-hidden
              draggable={false}
            />
          ) : null}
          {regions.map((region, index) => {
            const pending = pendingKey === region.key;
            const selected = selectedKey === region.key;
            return (
              <button
                key={`${region.kind}:${region.key}`}
                ref={(node) => {
                  if (node) regionButtonRefs.current.set(region.key, node);
                  else regionButtonRefs.current.delete(region.key);
                }}
                type="button"
                className={`studio-inplace-region ${region.kind}`}
                style={regionStyle(region)}
                data-label={labelForRegionKey(region.key)}
                data-pending={pending || undefined}
                data-quiet={(pending && optimisticPatch?.key === region.key) || undefined}
                data-selected={selected || undefined}
                disabled={comparePrevious || (busy && !pending)}
                aria-label={`Edit ${labelForRegionKey(region.key)}`}
                aria-pressed={selected}
                onClick={() => selectRegion(region)}
                onKeyDown={(event) => handleRegionKeyDown(event, index)}
              >
                {selected ? <span className="studio-inplace-handles" aria-hidden /> : null}
                {pending ? (
                  <span className="studio-inplace-status" role="status">
                    {stillWorking ? "Still working… this can take a minute." : pendingLabel ?? "Updating…"}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="studio-inplace-toolbar" aria-label="Edit history">
        <button type="button" onClick={() => restoreVersion("undo")} disabled={busy || renderHistory.length === 0}>
          <Undo2 aria-hidden size={15} />
          Undo
        </button>
        <button type="button" onClick={() => restoreVersion("redo")} disabled={busy || redoHistory.length === 0}>
          <Redo2 aria-hidden size={15} />
          Redo
        </button>
        <button
          type="button"
          aria-pressed={comparePrevious}
          onClick={() => {
            setComparePrevious((current) => !current);
            setSelectedKey(null);
          }}
          disabled={busy || renderHistory.length === 0}
        >
          <ScanEye aria-hidden size={15} />
          {comparePrevious ? "Current" : "Compare"}
        </button>
        <button
          type="button"
          aria-label={`Zoom, currently ${zoom}x`}
          aria-pressed={zoom > 1}
          onClick={cycleZoom}
        >
          <ZoomIn aria-hidden size={15} />
          {zoom}×
        </button>
        <button
          type="button"
          onClick={() => selectRegion(regions.find((region) => region.kind === "text") ?? regions[0]!)}
          disabled={busy || comparePrevious}
        >
          <ListTree aria-hidden size={15} />
          Edit elements
        </button>
      </div>

      {selectedRegion ? (
        <aside className="studio-inplace-inspector" aria-label="Edit selected element">
          <header>
            <div>
              <span>{selectedRegion.kind === "text" ? "Text" : "Image"}</span>
              <strong>{labelForRegionKey(selectedRegion.key)}</strong>
            </div>
            <button type="button" onClick={closeInspector} aria-label="Close editor" disabled={busy}>
              <X aria-hidden size={18} />
            </button>
          </header>

          <div className="studio-inplace-element-picker">
            <button
              className="studio-inplace-element-nav"
              type="button"
              aria-label="Show previous elements"
              aria-controls="studio-editable-elements"
              onClick={() => scrollElementList(-1)}
              disabled={busy || !canScrollBackward}
            >
              <ChevronLeft aria-hidden size={20} />
            </button>
            <div
              id="studio-editable-elements"
              ref={elementListRef}
              className="studio-inplace-element-list"
              aria-label="Editable elements"
            >
              {regions.map((region) => (
                <button
                  key={`list:${region.kind}:${region.key}`}
                  ref={(node) => {
                    if (node) elementButtonRefs.current.set(region.key, node);
                    else elementButtonRefs.current.delete(region.key);
                  }}
                  type="button"
                  aria-pressed={selectedKey === region.key}
                  onClick={() => selectRegion(region)}
                  disabled={busy}
                >
                  <i className="studio-inplace-thumb" style={regionThumbStyle(stableSrc, region.box)} aria-hidden />
                  {labelForRegionKey(region.key)}
                </button>
              ))}
            </div>
            <button
              className="studio-inplace-element-nav"
              type="button"
              aria-label="Show more elements"
              aria-controls="studio-editable-elements"
              onClick={() => scrollElementList(1)}
              disabled={busy || !canScrollForward}
            >
              <ChevronRight aria-hidden size={20} />
            </button>
          </div>

          {selectedRegion.kind === "text" ? (
            <div className="studio-inplace-field">
              <label htmlFor={`studio-text-${selectedRegion.key}`}>Replacement text</label>
              <textarea
                id={`studio-text-${selectedRegion.key}`}
                ref={textInputRef}
                value={textDraft}
                rows={4}
                maxLength={textLayers?.styles[selectedRegion.key]?.maxLength ?? MAX_TEXT_LENGTH}
                disabled={busy}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <small>
                {textDraft.length}/{textLayers?.styles[selectedRegion.key]?.maxLength ?? MAX_TEXT_LENGTH}. Press Ctrl+Enter to apply.
              </small>
              <button className="primary" type="button" onClick={applyTextEdit} disabled={busy || !textDraft.trim()}>
                <Check aria-hidden size={16} />
                Replace text
              </button>
              {layersReady
                && textLayers?.styles[selectedRegion.key]?.mode === "live"
                && loadedFontIds.has(textLayers.styles[selectedRegion.key]!.fontId) ? (
                <small className="studio-inplace-instant" aria-live="polite">
                  <Sparkles aria-hidden size={12} />
                  Instant editing ready — text changes apply in about a second.
                </small>
              ) : null}
            </div>
          ) : (
            <div className="studio-inplace-field">
              <label htmlFor={`studio-image-${selectedRegion.key}`}>Describe the change</label>
              <textarea
                id={`studio-image-${selectedRegion.key}`}
                value={instruction}
                rows={4}
                maxLength={MAX_INSTRUCTION_LENGTH}
                placeholder="For example: remove the car and brighten the front garden"
                disabled={busy}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <small>Only this selected area can change. The rest of the ad is preserved pixel-for-pixel.</small>
              <button className="primary" type="button" onClick={applyImageInstruction} disabled={busy || !instruction.trim()}>
                <WandSparkles aria-hidden size={16} />
                Apply image edit
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <ImagePlus aria-hidden size={16} />
                Replace with another image
              </button>
            </div>
          )}

          <p className="studio-inplace-preserve-note">
            Every change saves to your history — use Undo or Compare to step back.
          </p>
          {busy ? (
            <div className="studio-inplace-progress" role="status" aria-live="polite">
              <Sparkles aria-hidden size={16} />
              {stillWorking ? "Still working… this can take a minute." : pendingLabel ?? "Creating the scoped edit…"}
            </div>
          ) : null}
        </aside>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void handleImageFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
    </div>
  );
}
