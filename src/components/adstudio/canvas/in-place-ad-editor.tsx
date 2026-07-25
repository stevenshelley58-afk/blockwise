"use client";

import { Check, ChevronLeft, ChevronRight, ImagePlus, ListTree, Redo2, ScanEye, Sparkles, Undo2, WandSparkles, X, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import type { AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types.ts";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";

import { requestCreativeEdit, type CreativeEditMutation } from "./creative-edit-client";

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
  return creative.canvas.cloneQa?.copyChecks.find((item) => item.key === key)?.expected ?? "";
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
  /** When a text edit is in flight, the new text is rendered immediately as a
   * CSS overlay positioned over the region, so the user sees their edit
   * instantly instead of waiting 10-30s for the image model. The overlay is
   * replaced by the model's actual typeset version when the edit completes. */
  const [pendingTextPreview, setPendingTextPreview] = useState<{ key: string; value: string } | null>(null);
  const [stillWorking, setStillWorking] = useState(false);
  const [comparePrevious, setComparePrevious] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const panPointerRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const elementButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const regionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const retryMutationRef = useRef<{ signature: string; mutationId: string } | null>(null);
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const cloneObject = creative.canvas.objects[0];
  const src = cloneObject?.content ?? cloneObject?.assetId ?? "";
  const regions = creative.canvas.cloneQa?.regions ?? [];
  const renderHistory = creative.canvas.renderHistory ?? [];
  const redoHistory = creative.canvas.redoHistory ?? [];
  const displaySrc = comparePrevious ? renderHistory.at(-1) ?? src : src;
  const busy = pendingKey !== null;
  const selectedRegion = useMemo(
    () => regions.find((region) => region.key === selectedKey),
    [regions, selectedKey],
  );
  // Copy checks that came back inexact get a quiet flag on their element pill,
  // pointing at the exact place a one-tap fix applies.
  const warningKeys = useMemo(
    () => new Set(
      (creative.canvas.cloneQa?.copyChecks ?? [])
        .filter((check) => !check.exact)
        .map((check) => check.key),
    ),
    [creative.canvas.cloneQa?.copyChecks],
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
    // For text edits, render the new value as an instant CSS overlay so the
    // user sees their change immediately. The model pass replaces it.
    if (mutation.action === "edit" && mutation.fieldKey && mutation.newValue) {
      setPendingTextPreview({ key: mutation.fieldKey, value: mutation.newValue });
    }
    try {
      const next = await requestCreativeEdit({ creative, mutation, mutationId });
      onCreativeChange(next);
      retryMutationRef.current = null;
      setInstruction("");
      showToast(successMessage);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The editor could not reach the server. Your previous version is unchanged.");
    } finally {
      setPendingKey(null);
      setPendingLabel(null);
      setPendingTextPreview(null);
    }
  }, [cloneObject, creative, onCreativeChange, showToast]);

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
    if (value.length > MAX_TEXT_LENGTH) {
      showToast(`Keep the replacement text to ${MAX_TEXT_LENGTH} characters or less.`);
      return;
    }
    void performMutation(
      { action: "edit", fieldKey: selectedRegion.key, newValue: value },
      "Text updated",
      `Writing "${truncateForStatus(value)}"…`,
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
              {pendingTextPreview ? (() => {
                const region = regions.find((r) => r.key === pendingTextPreview.key);
                if (!region) return null;
                return (
                  <div
                    className="studio-inplace-text-preview"
                    style={regionStyle(region)}
                    aria-hidden
                  >
                    <span>{pendingTextPreview.value}</span>
                  </div>
                );
              })() : null}
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
                  <i className="studio-inplace-thumb" style={regionThumbStyle(src, region.box)} aria-hidden />
                  {labelForRegionKey(region.key)}
                  {warningKeys.has(region.key) ? (
                    <em className="studio-inplace-flag" title="Check this text on the ad" aria-label="Needs review" />
                  ) : null}
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
                maxLength={MAX_TEXT_LENGTH}
                disabled={busy}
                onChange={(event) => setTextDraft(event.target.value)}
                onKeyDown={handleEditorKeyDown}
              />
              <small>{textDraft.length}/{MAX_TEXT_LENGTH}. Press Ctrl+Enter to apply.</small>
              <button className="primary" type="button" onClick={applyTextEdit} disabled={busy || !textDraft.trim()}>
                <Check aria-hidden size={16} />
                Replace text
              </button>
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
            Every change saves to your history — use Undo or Compare to step back. Anything that looks off after an edit is flagged for you.
          </p>
          {busy ? (
            <div className="studio-inplace-progress" role="status" aria-live="polite">
              <Sparkles aria-hidden size={16} />
              {stillWorking ? "Still working… this can take a minute." : "Creating the scoped edit…"}
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
