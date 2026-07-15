"use client";

import { Check, ChevronLeft, ChevronRight, ImagePlus, ListTree, Redo2, ScanEye, Sparkles, Undo2, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

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
const SLOW_EDIT_MS = 8000;

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

function expectedTextForKey(creative: AdStudioCreative, key: string): string {
  return creative.canvas.cloneQa?.copyChecks.find((item) => item.key === key)?.expected ?? "";
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
  const [stillWorking, setStillWorking] = useState(false);
  const [comparePrevious, setComparePrevious] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const elementListRef = useRef<HTMLDivElement | null>(null);
  const elementButtonRefs = useRef(new Map<string, HTMLButtonElement>());
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

  useEffect(() => setComparePrevious(false), [src]);

  const updateElementScrollState = useCallback(() => {
    const list = elementListRef.current;
    if (!list) return;
    const maximumScroll = Math.max(0, list.scrollWidth - list.clientWidth);
    setCanScrollBackward(list.scrollLeft > 1);
    setCanScrollForward(list.scrollLeft < maximumScroll - 1);
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
  }, [regions.length, updateElementScrollState]);

  const performMutation = useCallback(async (mutation: CreativeEditMutation, successMessage: string) => {
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
    }
  }, [cloneObject, creative, onCreativeChange, showToast]);

  function preferredScrollBehavior(): ScrollBehavior {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  }

  function scrollSelectedElementToEnd(key: string) {
    requestAnimationFrame(() => {
      const list = elementListRef.current;
      const button = elementButtonRefs.current.get(key);
      if (!list || !button) return;
      const listBounds = list.getBoundingClientRect();
      const buttonBounds = button.getBoundingClientRect();
      list.scrollTo({
        left: list.scrollLeft + buttonBounds.right - listBounds.right,
        behavior: preferredScrollBehavior(),
      });
    });
  }

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
    void performMutation({ action: "edit", fieldKey: selectedRegion.key, newValue: value }, "Text updated and checked");
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
      "Image updated and checked",
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
        "Image replaced and checked",
      );
    } catch {
      showToast("The image could not be read. Try another file.");
    }
  }

  function restoreVersion(action: "undo" | "redo") {
    if (busy) return;
    void performMutation(
      { action },
      action === "undo" ? "Previous version restored and checked" : "Next version restored and checked",
    );
  }

  if (regions.length === 0) {
    return (
      <div className="studio-clone-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI-designed ad creative" />
      </div>
    );
  }

  return (
    <div className="studio-inplace-stage" data-inspector-open={selectedRegion ? "true" : undefined}>
      <div className="studio-inplace-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={displaySrc} alt={comparePrevious ? "Previous ad version" : "AI-designed ad creative"} />
        {regions.map((region) => {
          const pending = pendingKey === region.key;
          const selected = selectedKey === region.key;
          return (
            <button
              key={`${region.kind}:${region.key}`}
              type="button"
              className={`studio-inplace-region ${region.kind}`}
              style={regionStyle(region)}
              data-pending={pending || undefined}
              data-selected={selected || undefined}
              disabled={comparePrevious || (busy && !pending)}
              aria-label={`Edit ${labelForRegionKey(region.key)}`}
              aria-pressed={selected}
              onClick={() => selectRegion(region)}
            >
              {pending ? (
                <span className="studio-inplace-status" role="status">
                  {stillWorking ? "Still working…" : "Updating…"}
                </span>
              ) : null}
            </button>
          );
        })}
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
                  {region.kind === "text" ? <Sparkles aria-hidden size={15} /> : <ImagePlus aria-hidden size={15} />}
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
              <small>Only this selected area can change. The rest of the ad is checked before saving.</small>
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
            The current finished ad stays as the reference. Nothing is saved unless the updated ad passes the copy and visual checks.
          </p>
          {busy ? (
            <div className="studio-inplace-progress" role="status" aria-live="polite">
              <Sparkles aria-hidden size={16} />
              {stillWorking ? "Checking the updated ad…" : "Creating the scoped edit…"}
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
