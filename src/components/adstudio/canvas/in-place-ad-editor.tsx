"use client";

import { Check, Pencil, Sparkles, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import type { AdStudioCloneRegion, AdStudioCreative } from "@/lib/adstudio/types.ts";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";

export type InPlaceAdEditorProps = {
  creative: AdStudioCreative;
  onCreativeChange: (next: AdStudioCreative) => void;
  showToast: (msg: string) => void;
};

type EditResponse = {
  image?: string;
  qa?: AdStudioCreative["canvas"]["cloneQa"];
  renderHistory?: string[];
  error?: string;
};

// Matches the server-side limit in /api/adstudio/creatives/[id]/edit.
const MAX_TEXT_LENGTH = 200;
// Replacement images travel as data URLs in the edit request body; cap them.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// After this long an in-flight edit switches to the "Still working…" label.
const SLOW_EDIT_MS = 8000;

function labelForRegionKey(key: string): string {
  return key.replace(/_/g, " ");
}

/** Percentage placement from the region's normalized 0-1 box. */
function regionStyle(region: AdStudioCloneRegion): CSSProperties {
  const { x, y, width, height } = region.box;
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}

function expectedTextForKey(creative: AdStudioCreative, key: string): string {
  const check = creative.canvas.cloneQa?.copyChecks.find((item) => item.key === key);
  return check?.expected ?? "";
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
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [stillWorking, setStillWorking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageKeyRef = useRef<string | null>(null);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);

  const cloneObject = creative.canvas.objects[0];
  const src = cloneObject?.content ?? cloneObject?.assetId ?? "";
  const regions = creative.canvas.cloneQa?.regions ?? [];
  const renderHistory = creative.canvas.renderHistory ?? [];
  const busy = pendingKey !== null;

  useEffect(() => {
    if (!busy) {
      setStillWorking(false);
      return;
    }
    const timer = setTimeout(() => setStillWorking(true), SLOW_EDIT_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  useEffect(() => {
    if (editingKey) draftInputRef.current?.focus();
  }, [editingKey]);

  const submitEdit = useCallback(
    async (fieldKey: string, payload: { newValue?: string; newImage?: string }) => {
      setPendingKey(fieldKey);
      setEditingKey(null);
      try {
        const response = await fetch(`/api/adstudio/creatives/${creative.creativeId}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fieldKey, ...payload }),
        });
        const data = (await response.json().catch(() => ({}))) as EditResponse;
        if (!response.ok || !data.image) {
          // Keep the old image; the failure is surfaced, never silently shipped.
          showToast(data.error || "The edit did not render correctly. Try again.");
          return;
        }
        const next: AdStudioCreative = {
          ...creative,
          canvas: {
            ...creative.canvas,
            objects: [{ ...cloneObject, content: data.image, assetId: data.image }],
            cloneQa: data.qa ?? creative.canvas.cloneQa,
            renderHistory: data.renderHistory ?? creative.canvas.renderHistory,
          },
        };
        onCreativeChange(next);
        showToast("Updated");
      } catch {
        showToast("The edit could not reach the server. Try again.");
      } finally {
        setPendingKey(null);
      }
    },
    [cloneObject, creative, onCreativeChange, showToast],
  );

  function openTextEditor(region: AdStudioCloneRegion) {
    if (busy) return;
    setDraft(expectedTextForKey(creative, region.key));
    setEditingKey(region.key);
  }

  function confirmTextEdit() {
    if (!editingKey) return;
    const value = draft.trim();
    if (!value) {
      showToast("Type the new text first.");
      return;
    }
    if (value.length > MAX_TEXT_LENGTH) {
      showToast(`Keep the new text to ${MAX_TEXT_LENGTH} characters or less.`);
      return;
    }
    void submitEdit(editingKey, { newValue: value });
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      confirmTextEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditingKey(null);
    }
  }

  function openImagePicker(region: AdStudioCloneRegion) {
    if (busy) return;
    pendingImageKeyRef.current = region.key;
    fileInputRef.current?.click();
  }

  async function handleImageFile(file: File | null) {
    const fieldKey = pendingImageKeyRef.current;
    pendingImageKeyRef.current = null;
    if (!file || !fieldKey) return;
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
      await submitEdit(fieldKey, { newImage: dataUrl });
    } catch {
      showToast("The image could not be read. Try another file.");
    }
  }

  // Client-side undo: restore the previous render; the QA verdict stays as-is
  // (stale) — server-side undo verification is a later task.
  function undoLastEdit() {
    if (busy || renderHistory.length === 0) return;
    const previous = renderHistory[renderHistory.length - 1];
    const next: AdStudioCreative = {
      ...creative,
      canvas: {
        ...creative.canvas,
        objects: [{ ...cloneObject, content: previous, assetId: previous }],
        renderHistory: renderHistory.slice(0, -1),
      },
    };
    onCreativeChange(next);
    showToast("Restored the previous render");
  }

  // Older creatives without QA regions: nothing is safely editable in place,
  // so fall back to the honest badge instead of dead hit-targets.
  if (regions.length === 0) {
    return (
      <div className="studio-clone-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI-designed ad creative" />
        <span className="studio-clone-badge">
          <Sparkles aria-hidden size={13} />
          AI-designed — the text is part of the image. Create a new ad to change it.
        </span>
      </div>
    );
  }

  const editingRegion = editingKey ? regions.find((region) => region.key === editingKey) : undefined;

  return (
    <div className="studio-inplace-stage">
      <div className="studio-inplace-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="AI-designed ad creative" />
        {renderHistory.length > 0 && (
          <button
            type="button"
            className="studio-inplace-undo"
            onClick={undoLastEdit}
            disabled={busy}
            aria-label="Undo last edit"
          >
            <Undo2 aria-hidden size={13} />
            Undo
          </button>
        )}
        {regions.map((region) => {
          const pending = pendingKey === region.key;
          return (
            <button
              key={region.key}
              type="button"
              className={`studio-inplace-region ${region.kind}`}
              style={regionStyle(region)}
              data-pending={pending || undefined}
              disabled={busy && !pending}
              aria-label={`Edit ${labelForRegionKey(region.key)}`}
              onClick={() => (region.kind === "image" ? openImagePicker(region) : openTextEditor(region))}
            >
              {pending ? (
                <span className="studio-inplace-status" role="status">
                  {stillWorking ? "Still working…" : "Updating…"}
                </span>
              ) : (
                <span className="studio-inplace-chip" aria-hidden>
                  <Pencil size={12} />
                </span>
              )}
            </button>
          );
        })}
        {editingRegion && (
          <div
            className="studio-inplace-editor"
            style={{
              left: `${editingRegion.box.x * 100}%`,
              top: `${editingRegion.box.y * 100}%`,
              minWidth: `${Math.max(editingRegion.box.width * 100, 42)}%`,
            }}
          >
            <textarea
              ref={draftInputRef}
              value={draft}
              rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 32)))}
              maxLength={MAX_TEXT_LENGTH}
              aria-label={`New text for ${labelForRegionKey(editingRegion.key)}`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleEditorKeyDown}
            />
            <div className="studio-inplace-editor-actions">
              <button type="button" className="cancel" onClick={() => setEditingKey(null)} aria-label="Cancel edit">
                <X aria-hidden size={14} />
              </button>
              <button type="button" className="confirm" onClick={confirmTextEdit} aria-label="Confirm edit">
                <Check aria-hidden size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="studio-inplace-hint">
        <Sparkles aria-hidden size={13} />
        Click any text on the ad to edit it
      </span>
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
