"use client";

// The embedded design editor for plate-backed clone creatives.
//
// Text lives as real Polotno layers over the AI-generated clean plate, so
// retyping a headline is instant and letter-perfect — the AI never re-renders
// text. Saves flatten the scene client-side and post to the deterministic
// editor-save route; only image-region "describe the change" edits still go
// through the image model, against the plate, from the panel here.

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ImagePlus,
  Minus,
  Plus,
  Redo2,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { createStore, type StoreType } from "polotno/model/store";
import { Workspace } from "polotno/canvas/workspace";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AdStudioBrandKit, AdStudioCreative } from "@/lib/adstudio/types.ts";
import { downscaleImageForUpload } from "@/lib/upload/asset-file";

import { requestCreativeEdit } from "./creative-edit-client";
import { buildEditorSeedLayout, extractSceneRegions, extractSceneText } from "./editor-scene";
import { requestEditorSave } from "./editor-save-client";

export type PolotnoAdEditorProps = {
  creative: AdStudioCreative;
  brandKit: AdStudioBrandKit;
  onCreativeChange: (next: AdStudioCreative) => void;
  showToast: (msg: string) => void;
};

const SAVE_DEBOUNCE_MS = 2000;
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// Vercel's request-body ceiling is ~4.5MB; fall back to JPEG when the PNG
// flatten of a photographic ad exceeds it.
const MAX_PNG_UPLOAD_CHARS = 5_000_000;

const BACKGROUND_ID = "clean_plate_background";

const FONT_CHOICES = ["Inter", "Roboto", "Montserrat", "Playfair Display", "Georgia", "Arial"];

function labelForRegionKey(key: string): string {
  return key.replace(/_/g, " ");
}

/** White or near-black, whichever survives on the plate region behind a layer. */
async function contrastFillForRegion(
  plateSrc: string,
  frame: { x: number; y: number; width: number; height: number },
  canvasSize: { width: number; height: number },
): Promise<string> {
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("plate load failed"));
      image.src = plateSrc;
    });
    // The stored plate may be a different pixel size than the creative canvas;
    // scale the sampled region into the plate's own coordinates.
    const scaleX = image.naturalWidth / Math.max(1, canvasSize.width);
    const scaleY = image.naturalHeight / Math.max(1, canvasSize.height);
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) return "#111827";
    context.drawImage(
      image,
      frame.x * scaleX,
      frame.y * scaleY,
      Math.max(1, frame.width * scaleX),
      Math.max(1, frame.height * scaleY),
      0,
      0,
      32,
      32,
    );
    const data = context.getImageData(0, 0, 32, 32).data;
    let luminance = 0;
    for (let index = 0; index < data.length; index += 4) {
      luminance += 0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!;
    }
    luminance /= data.length / 4;
    return luminance < 145 ? "#ffffff" : "#111827";
  } catch {
    return "#111827";
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function sceneImageFrame(element: { x: number; y: number; width: number; height: number }) {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

export const PolotnoAdEditor = observer(function PolotnoAdEditor({
  creative,
  brandKit,
  onCreativeChange,
  showToast,
}: PolotnoAdEditorProps) {
  const [store] = useState<StoreType>(() => createStore({
    key: process.env.NEXT_PUBLIC_POLOTNO_KEY ?? "",
    showCredit: false,
  }));
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving">("clean");
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [selectedImageKey, setSelectedImageKey] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number>(0);
  const seededForRef = useRef<string | null>(null);
  const suppressChangeRef = useRef(false);
  // The latest creative (CAS revision id) without re-running scene setup.
  const creativeRef = useRef(creative);
  creativeRef.current = creative;

  const cleanPlate = creative.canvas.cloneEdit?.cleanPlate ?? "";
  const imageRegions = useMemo(
    () => creative.canvas.cloneQa?.regions.filter((region) => region.kind === "image") ?? [],
    [creative.canvas.cloneQa],
  );

  // --- Scene setup: saved scene verbatim, else seed from plate + QA regions.
  useEffect(() => {
    if (!cleanPlate || seededForRef.current === creative.creativeId) return;
    seededForRef.current = creative.creativeId;
    suppressChangeRef.current = true;

    const setup = async () => {
      const savedScene = creative.canvas.cloneEdit?.editorScene;
      if (savedScene && Object.keys(savedScene).length > 0) {
        store.loadJSON(savedScene);
      } else {
        const seed = buildEditorSeedLayout({ creative, brandKit });
        store.setSize(creative.canvas.width, creative.canvas.height);
        const page = store.addPage();
        page.addElement({
          id: BACKGROUND_ID,
          type: "image",
          x: 0,
          y: 0,
          width: creative.canvas.width,
          height: creative.canvas.height,
          src: cleanPlate,
          selectable: false,
          alwaysOnTop: false,
          showInExport: true,
        });
        for (const layer of seed?.texts ?? []) {
          const fill = await contrastFillForRegion(cleanPlate, sceneImageFrame(layer), {
            width: creative.canvas.width,
            height: creative.canvas.height,
          });
          page.addElement({
            type: "text",
            x: layer.x,
            y: layer.y,
            width: layer.width,
            text: layer.text,
            fontSize: layer.fontSize,
            fontFamily: layer.fontFamily,
            fill,
            align: layer.align,
            custom: { fieldKey: layer.fieldKey },
          });
        }
      }
      store.history.clear();
      suppressChangeRef.current = false;
    };
    void setup();
  }, [brandKit, cleanPlate, creative, store]);

  // --- Debounced autosave on scene change.
  const flattenScene = useCallback(async (): Promise<string> => {
    const previousSelection = store.selectedElements.map((element) => element.id);
    store.selectElements([]);
    let dataUrl = await store.toDataURL({ pixelRatio: 1, mimeType: "image/png" });
    if (dataUrl.length > MAX_PNG_UPLOAD_CHARS) {
      dataUrl = await store.toDataURL({ pixelRatio: 1, mimeType: "image/jpeg" });
    }
    store.selectElements(previousSelection);
    return dataUrl;
  }, [store]);

  const saveScene = useCallback(async () => {
    const current = creativeRef.current;
    if (!current.activeRevisionId) {
      showToast("This ad changed. Reload it before editing.");
      return;
    }
    setSaveState("saving");
    try {
      const scene = store.toJSON() as unknown as Record<string, unknown>;
      const flattenedImage = await flattenScene();
      const next = await requestEditorSave({
        creative: current,
        editorScene: scene,
        flattenedImage,
        textByKey: extractSceneText(scene),
        regions: extractSceneRegions(scene, { width: current.canvas.width, height: current.canvas.height }),
        mutationId: crypto.randomUUID(),
      });
      onCreativeChange(next);
      setSaveState("clean");
    } catch (error) {
      setSaveState("dirty");
      showToast(error instanceof Error ? error.message : "The design could not be saved. It stays open - try again.");
    }
  }, [flattenScene, onCreativeChange, showToast, store]);

  useEffect(() => {
    const off = store.on("change", () => {
      if (suppressChangeRef.current) return;
      setSaveState("dirty");
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => void saveScene(), SAVE_DEBOUNCE_MS);
    });
    return () => {
      off?.();
      window.clearTimeout(saveTimerRef.current);
    };
  }, [saveScene, store]);

  // --- Selected-element helpers for the toolbar.
  const selected = store.selectedElements[0];
  const selectedText = selected?.type === "text" ? selected : null;

  function adjustFontSize(delta: number) {
    if (!selectedText) return;
    const size = Math.min(300, Math.max(8, Math.round((selectedText.fontSize ?? 24) + delta)));
    selectedText.set({ fontSize: size });
  }

  function cycleAlign() {
    if (!selectedText) return;
    const order = ["left", "center", "right"] as const;
    const current = (selectedText.align ?? "center") as (typeof order)[number];
    selectedText.set({ align: order[(order.indexOf(current) + 1) % order.length] });
  }

  function toggleBold() {
    if (!selectedText) return;
    selectedText.set({ fontWeight: selectedText.fontWeight === "bold" ? "normal" : "bold" });
  }

  // --- AI image edits against the plate.
  const selectedImageRegion = imageRegions.find((region) => region.key === selectedImageKey) ?? null;

  const swapPlate = useCallback((nextCreative: AdStudioCreative) => {
    onCreativeChange(nextCreative);
    const plate = nextCreative.canvas.cloneEdit?.cleanPlate;
    if (!plate) return;
    const background = store.getElementById(BACKGROUND_ID);
    if (background) {
      suppressChangeRef.current = true;
      background.set({ src: plate });
      suppressChangeRef.current = false;
    }
    // The plate changed under the text layers; persist a re-flatten.
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => void saveScene(), 400);
  }, [onCreativeChange, saveScene, store]);

  async function applyPlateInstruction() {
    if (!selectedImageRegion || aiBusy) return;
    const value = instruction.trim();
    if (!value) {
      showToast("Describe the image change first.");
      return;
    }
    if (value.length > MAX_INSTRUCTION_LENGTH) {
      showToast(`Keep the direction to ${MAX_INSTRUCTION_LENGTH} characters or less.`);
      return;
    }
    setAiBusy(true);
    try {
      const next = await requestCreativeEdit({
        creative: creativeRef.current,
        mutation: { fieldKey: selectedImageRegion.key, instruction: value, target: "plate" },
        mutationId: crypto.randomUUID(),
      });
      swapPlate(next);
      setInstruction("");
      showToast("Image updated");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The image edit could not be applied.");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleImageFile(file: File | null) {
    if (!file || !selectedImageRegion || aiBusy) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choose an image file.");
      return;
    }
    setAiBusy(true);
    try {
      const scaled = await downscaleImageForUpload(file);
      if (scaled.size > MAX_IMAGE_BYTES) {
        showToast("That image is too large. Use one under 4MB.");
        return;
      }
      const dataUrl = await readFileAsDataUrl(scaled);
      const next = await requestCreativeEdit({
        creative: creativeRef.current,
        mutation: {
          fieldKey: selectedImageRegion.key,
          newImage: dataUrl,
          instruction: instruction.trim() || undefined,
          target: "plate",
        },
        mutationId: crypto.randomUUID(),
      });
      swapPlate(next);
      setInstruction("");
      showToast("Image replaced");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "The image could not be replaced.");
    } finally {
      setAiBusy(false);
    }
  }

  if (!cleanPlate) return null;

  return (
    <div className="studio-design-editor" data-save-state={saveState}>
      <div className="studio-design-toolbar" aria-label="Design editor tools">
        <button
          type="button"
          onClick={() => store.history.undo()}
          disabled={!store.history.canUndo}
          aria-label="Undo"
        >
          <Undo2 aria-hidden size={15} />
        </button>
        <button
          type="button"
          onClick={() => store.history.redo()}
          disabled={!store.history.canRedo}
          aria-label="Redo"
        >
          <Redo2 aria-hidden size={15} />
        </button>
        <span className="studio-design-toolbar-divider" aria-hidden />
        {selectedText ? (
          <>
            <select
              aria-label="Font"
              value={String(selectedText.fontFamily ?? FONT_CHOICES[0])}
              onChange={(event) => selectedText.set({ fontFamily: event.target.value })}
            >
              {[String(selectedText.fontFamily ?? ""), ...FONT_CHOICES]
                .filter((font, index, list) => font && list.indexOf(font) === index)
                .map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
            </select>
            <button type="button" onClick={() => adjustFontSize(-2)} aria-label="Smaller text">
              <Minus aria-hidden size={15} />
            </button>
            <button type="button" onClick={() => adjustFontSize(2)} aria-label="Larger text">
              <Plus aria-hidden size={15} />
            </button>
            <button
              type="button"
              onClick={toggleBold}
              aria-pressed={selectedText.fontWeight === "bold"}
              aria-label="Bold"
            >
              <Bold aria-hidden size={15} />
            </button>
            <button type="button" onClick={cycleAlign} aria-label="Text alignment">
              {selectedText.align === "left" ? <AlignLeft aria-hidden size={15} />
                : selectedText.align === "right" ? <AlignRight aria-hidden size={15} />
                  : <AlignCenter aria-hidden size={15} />}
            </button>
            <input
              type="color"
              aria-label="Text colour"
              value={/^#[0-9a-f]{6}$/i.test(String(selectedText.fill ?? "")) ? String(selectedText.fill) : "#111827"}
              onChange={(event) => selectedText.set({ fill: event.target.value })}
            />
          </>
        ) : (
          <span className="studio-design-toolbar-hint">Select text on the ad to edit it</span>
        )}
        <span className="studio-design-toolbar-spacer" aria-hidden />
        {imageRegions.length > 0 ? (
          <button
            type="button"
            aria-pressed={imagePanelOpen}
            onClick={() => {
              setImagePanelOpen((open) => !open);
              setSelectedImageKey((key) => key ?? imageRegions[0]?.key ?? null);
            }}
          >
            <ImagePlus aria-hidden size={15} />
            Change images
          </button>
        ) : null}
        <button
          className="primary"
          type="button"
          onClick={() => {
            window.clearTimeout(saveTimerRef.current);
            void saveScene();
          }}
          disabled={saveState === "saving"}
        >
          <Check aria-hidden size={15} />
          {saveState === "saving" ? "Saving..." : saveState === "dirty" ? "Save" : "Saved"}
        </button>
      </div>

      <div className="studio-design-stage">
        <Workspace
          store={store}
          components={{ PageControls: () => null }}
        />
      </div>

      {imagePanelOpen ? (
        <aside className="studio-design-image-panel" aria-label="AI image edits">
          <header>
            <strong>Change an image</strong>
            <button
              type="button"
              onClick={() => setImagePanelOpen(false)}
              aria-label="Close image panel"
              disabled={aiBusy}
            >
              <X aria-hidden size={16} />
            </button>
          </header>
          <div className="studio-design-image-regions">
            {imageRegions.map((region) => (
              <button
                key={region.key}
                type="button"
                aria-pressed={selectedImageKey === region.key}
                onClick={() => setSelectedImageKey(region.key)}
                disabled={aiBusy}
              >
                {labelForRegionKey(region.key)}
              </button>
            ))}
          </div>
          <label htmlFor="studio-design-instruction">Describe the change</label>
          <textarea
            id="studio-design-instruction"
            value={instruction}
            rows={3}
            maxLength={MAX_INSTRUCTION_LENGTH}
            placeholder="For example: remove the car and brighten the front garden"
            disabled={aiBusy}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <button
            className="primary"
            type="button"
            onClick={() => void applyPlateInstruction()}
            disabled={aiBusy || !instruction.trim() || !selectedImageRegion}
          >
            <WandSparkles aria-hidden size={15} />
            Apply image edit
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={aiBusy || !selectedImageRegion}
          >
            <ImagePlus aria-hidden size={15} />
            Replace with another image
          </button>
          {aiBusy ? (
            <p className="studio-design-image-status" role="status" aria-live="polite">
              <Sparkles aria-hidden size={14} />
              Updating the background...
            </p>
          ) : (
            <p className="studio-design-image-note">
              Image changes use AI on the background only - your text stays exactly as written.
            </p>
          )}
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
});
