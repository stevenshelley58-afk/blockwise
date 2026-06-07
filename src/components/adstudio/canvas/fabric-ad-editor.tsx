"use client";

import { Bot, Image as ImageIcon, RotateCcw, RotateCw, ScanSearch } from "lucide-react";
import { Canvas, FabricImage, Rect, Textbox, type FabricObject } from "fabric";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  BLOCKWISE_FABRIC_META_KEY,
  FABRIC_JSON_EXTRA_KEYS,
  getCreativeDesignJson,
  saveCreativeDesignJson,
  type CreativeCopyFields,
  type CreativeDesignJson,
  type CreativeDesignObjectJson,
  type CreativeLayerMeta,
} from "@/lib/adstudio/creative-design-json.ts";
import { buildCreativeDesignJson } from "@/lib/adstudio/creative-design-builder.ts";
import type { AdStudioBrandKit, AdStudioCreative } from "@/lib/adstudio/types.ts";
import type { SelectedElement } from "../preview";
import { useCreativeHistory } from "./use-creative-history";

type BlockwiseFabricObject = FabricObject & {
  [BLOCKWISE_FABRIC_META_KEY]?: CreativeLayerMeta;
  text?: string;
};

export type FabricAdEditorProps = {
  creative: AdStudioCreative;
  brandKit: AdStudioBrandKit;
  copy: CreativeCopyFields;
  imageSrc: string;
  selectedElement: SelectedElement;
  onSelectedElementChange: (element: SelectedElement) => void;
  onCopyChange: (key: keyof CreativeCopyFields, value: string) => void;
  onImageChange: (src: string) => void;
  onCreativeChange: (creative: AdStudioCreative) => void;
  onRequestImageReplace: () => void;
  onPatchSelectedLayer: () => void | Promise<void>;
};

export function FabricAdEditor({
  creative,
  brandKit,
  copy,
  imageSrc,
  selectedElement,
  onSelectedElementChange,
  onCopyChange,
  onImageChange,
  onCreativeChange,
  onRequestImageReplace,
  onPatchSelectedLayer,
}: FabricAdEditorProps) {
  const canvasElementRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const creativeRef = useRef(creative);
  const copyRef = useRef(copy);
  const imageSrcRef = useRef(imageSrc);
  const historyRef = useRef<ReturnType<typeof useCreativeHistory> | null>(null);
  const callbacksRef = useRef({ onCopyChange, onCreativeChange, onImageChange, onSelectedElementChange });
  const suppressCommitRef = useRef(false);
  const mountedKeyRef = useRef("");
  const creativeKey = `${creative.creativeId}:${creative.format}`;
  // Captured once per creative/format. Live copy + image edits are applied to the
  // mounted canvas via the sync effects below, never by rebuilding the canvas.
  const initialDesign = useMemo(
    () => getCreativeDesignJson(creative) ?? buildCreativeDesignJson({ creative, brandKit, copy, imageSrc }),
    [brandKit, creativeKey],
  );
  const history = useCreativeHistory(initialDesign);

  // Keep the latest props in refs so canvas event handlers and the mount effect
  // stay identity-stable. Without this, parent re-renders (new handler identities)
  // disposed and rebuilt the canvas on every keystroke, reverting all edits.
  useEffect(() => {
    creativeRef.current = creative;
    copyRef.current = copy;
    imageSrcRef.current = imageSrc;
    historyRef.current = history;
    callbacksRef.current = { onCopyChange, onCreativeChange, onImageChange, onSelectedElementChange };
  });

  const commitCanvas = useCallback((options: { pushHistory?: boolean } = {}) => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;

    const activeCreative = creativeRef.current;
    const designJson = readCanvasJson(canvas, activeCreative);
    if (options.pushHistory !== false) historyRef.current?.push(designJson);
    const nextCreative = saveCreativeDesignJson(activeCreative, designJson);
    const callbacks = callbacksRef.current;
    callbacks.onCreativeChange(nextCreative);
    syncCopyFromCanvasJson(designJson, (key, value) => callbacks.onCopyChange(key, value));
    syncImageFromCanvasJson(designJson, (src) => callbacks.onImageChange(src));
  }, []);

  useEffect(() => {
    const canvasElement = canvasElementRef.current;
    if (!canvasElement) return;

    const key = creativeKey;
    mountedKeyRef.current = key;
    const mountCreative = creativeRef.current;
    const canvas = new Canvas(canvasElement, {
      width: mountCreative.canvas.width,
      height: mountCreative.canvas.height,
      backgroundColor: backgroundFill(mountCreative),
      preserveObjectStacking: true,
      selection: false,
      enableRetinaScaling: true,
    });
    fabricRef.current = canvas;
    suppressCommitRef.current = true;
    applyDisplaySize(canvas, mountCreative);

    let disposed = false;
    const resize = () => applyDisplaySize(canvas, creativeRef.current);
    window.addEventListener("resize", resize);
    const selectElement = (element: SelectedElement) => callbacksRef.current.onSelectedElementChange(element);
    const disposers = [
      canvas.on("selection:created", () => syncSelection(canvas, selectElement)),
      canvas.on("selection:updated", () => syncSelection(canvas, selectElement)),
      canvas.on("selection:cleared", () => selectElement("headline")),
      canvas.on("object:modified", () => commitCanvas()),
      canvas.on("text:changed", () => commitCanvas()),
    ];

    void loadDesign(canvas, initialDesign, brandKit).then(async () => {
      if (disposed || mountedKeyRef.current !== key) return;
      addSafeAreaOverlay(canvas, creativeRef.current);
      // Apply state that changed while the design was loading (e.g. an upload or
      // copy edit in flight), so nothing is swallowed by the suppress window.
      updateTextRole(canvas, "headline", copyRef.current.headline);
      updateTextRole(canvas, "subheadline", copyRef.current.description);
      updateTextRole(canvas, "cta_text", copyRef.current.cta);
      await replaceImageLayerIfNeeded(canvas, imageSrcRef.current, { select: false });
      if (disposed || mountedKeyRef.current !== key) return;
      canvas.requestRenderAll();
      const designJson = readCanvasJson(canvas, creativeRef.current);
      historyRef.current?.reset(designJson);
      suppressCommitRef.current = false;
    });

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      disposers.forEach((dispose) => dispose());
      fabricRef.current = null;
      void canvas.dispose();
    };
  }, [brandKit, commitCanvas, creativeKey, initialDesign]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;
    updateTextRole(canvas, "headline", copy.headline);
    updateTextRole(canvas, "subheadline", copy.description);
    updateTextRole(canvas, "cta_text", copy.cta);
    canvas.requestRenderAll();
    commitCanvas({ pushHistory: false });
  }, [commitCanvas, copy.cta, copy.description, copy.headline]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || suppressCommitRef.current) return;
    void replaceImageLayerIfNeeded(canvas, imageSrc).then((changed) => {
      if (!changed || fabricRef.current !== canvas) return;
      canvas.requestRenderAll();
      commitCanvas({ pushHistory: false });
    });
  }, [commitCanvas, imageSrc]);

  const applyHistory = useCallback((json: CreativeDesignJson | null) => {
    const canvas = fabricRef.current;
    if (!canvas || !json) return;
    suppressCommitRef.current = true;
    void loadDesign(canvas, json, brandKit).then(() => {
      if (fabricRef.current !== canvas) return;
      addSafeAreaOverlay(canvas, creativeRef.current);
      canvas.requestRenderAll();
      suppressCommitRef.current = false;
      commitCanvas({ pushHistory: false });
    });
  }, [brandKit, commitCanvas]);

  return (
    <div className="studio-fabric-editor">
      <div className="studio-fabric-toolbar" aria-label="Creative editor tools">
        <button aria-label="Undo" disabled={!history.canUndo} type="button" onClick={() => applyHistory(history.undo())}>
          <RotateCcw aria-hidden size={16} />
        </button>
        <button aria-label="Redo" disabled={!history.canRedo} type="button" onClick={() => applyHistory(history.redo())}>
          <RotateCw aria-hidden size={16} />
        </button>
        <button aria-label="Replace selected image" type="button" onClick={onRequestImageReplace}>
          <ImageIcon aria-hidden size={16} />
        </button>
        <button
          aria-label="Fit selected image"
          type="button"
          onClick={() => {
            fitSelectedImage(fabricRef.current);
            commitCanvas();
          }}
        >
          <ScanSearch aria-hidden size={16} />
        </button>
        <button aria-label="AI patch selected layer" type="button" onClick={() => void onPatchSelectedLayer()}>
          <Bot aria-hidden size={16} />
        </button>
      </div>
      <div className="studio-fabric-shell" data-format={creative.format} data-selected={selectedElement}>
        <canvas ref={canvasElementRef} />
      </div>
    </div>
  );
}

async function loadDesign(canvas: Canvas, designJson: CreativeDesignJson, brandKit: AdStudioBrandKit) {
  canvas.clear();
  canvas.backgroundColor = "#FFFFFF";

  for (const object of designJson.objects) {
    const meta = object[BLOCKWISE_FABRIC_META_KEY];
    if (!meta) continue;
    if (meta.type === "image") {
      await addImageObject(canvas, object, meta);
    } else if (meta.type === "text") {
      addTextObject(canvas, object, meta);
    } else if (meta.type === "logo") {
      addLogoObject(canvas, object, meta, brandKit);
    } else {
      addRectObject(canvas, object, meta);
    }
  }
}

function addTextObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const text = new Textbox(typeof object.text === "string" ? object.text : "", {
    ...interactiveOptions(meta),
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 320),
    height: numberOr(object.height, undefined),
    originX: "left",
    originY: "top",
    fill: typeof object.fill === "string" ? object.fill : "#131B2E",
    fontFamily: typeof object.fontFamily === "string" ? object.fontFamily : "Inter",
    fontSize: numberOr(object.fontSize, 36),
    fontWeight: typeof object.fontWeight === "number" || typeof object.fontWeight === "string" ? object.fontWeight : 600,
    lineHeight: numberOr(object.lineHeight, 1.18),
  });
  attachMeta(text, meta);
  canvas.add(text);
}

function addRectObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const rect = new Rect({
    ...interactiveOptions(meta),
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 100),
    height: numberOr(object.height, 100),
    originX: "left",
    originY: "top",
    fill: typeof object.fill === "string" ? object.fill : "#123E75",
    rx: numberOr(object.rx, 0),
    ry: numberOr(object.ry, 0),
    strokeWidth: 0,
  });
  attachMeta(rect, meta);
  canvas.add(rect);
}

async function addImageObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta) {
  const src = typeof object.src === "string" && object.src ? object.src : "";
  const frame = {
    left: numberOr(object.left, 0),
    top: numberOr(object.top, 0),
    width: numberOr(object.width, 320),
    height: numberOr(object.height, 240),
  };

  if (!src) {
    addImagePlaceholder(canvas, frame, meta);
    return;
  }

  try {
    const image = await FabricImage.fromURL(src, { crossOrigin: "anonymous" });
    image.set({
      ...interactiveOptions(meta),
      left: frame.left,
      top: frame.top,
      originX: "left",
      originY: "top",
      clipPath: clipRect(frame),
    });
    fitImageToFrame(image, frame.width, frame.height);
    attachMeta(image, meta);
    canvas.add(image);
  } catch {
    addImagePlaceholder(canvas, frame, meta);
  }
}

function addImagePlaceholder(canvas: Canvas, frame: { left: number; top: number; width: number; height: number }, meta: CreativeLayerMeta) {
  const rect = new Rect({
    ...interactiveOptions(meta),
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    originX: "left",
    originY: "top",
    fill: "#D9E7E3",
    rx: 22,
    ry: 22,
    strokeWidth: 0,
  });
  attachMeta(rect, meta);
  canvas.add(rect);
}

function addLogoObject(canvas: Canvas, object: CreativeDesignObjectJson, meta: CreativeLayerMeta, brandKit: AdStudioBrandKit) {
  addRectObject(canvas, object, meta);
  const height = numberOr(object.height, 64);
  const label = new Textbox(brandKit.identity.tradingName || brandKit.identity.businessName || "BRAND", {
    left: numberOr(object.left, 0) + 16,
    top: numberOr(object.top, 0) + Math.max(8, height * 0.24),
    width: Math.max(80, numberOr(object.width, 180) - 28),
    originX: "left",
    originY: "top",
    fill: "#FFFFFF",
    fontFamily: "Inter",
    fontSize: Math.max(16, Math.round(height * 0.28)),
    fontWeight: 800,
    selectable: false,
    evented: false,
  });
  canvas.add(label);
}

function addSafeAreaOverlay(canvas: Canvas, creative: AdStudioCreative) {
  if (!creative.safeZones.metaStory) return;
  const top = new Rect({
    left: 0,
    top: 0,
    width: creative.canvas.width,
    height: 250,
    originX: "left",
    originY: "top",
    fill: "rgba(255,255,255,0.08)",
    stroke: "rgba(255,255,255,0.5)",
    strokeDashArray: [18, 14],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  const bottom = new Rect({
    left: 0,
    top: creative.canvas.height - 340,
    width: creative.canvas.width,
    height: 340,
    originX: "left",
    originY: "top",
    fill: "rgba(255,255,255,0.08)",
    stroke: "rgba(255,255,255,0.5)",
    strokeDashArray: [18, 14],
    selectable: false,
    evented: false,
    excludeFromExport: true,
  });
  canvas.add(top, bottom);
}

function normalizeSrc(value: string): string {
  if (!value) return value;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

/** Replaces the primary image only when the canvas shows a different source. */
async function replaceImageLayerIfNeeded(
  canvas: Canvas,
  src: string,
  options: { select?: boolean } = {},
): Promise<boolean> {
  if (!src) return false;
  const current = canvas.getObjects().find((object) => getMeta(object)?.role === "primary_image");
  if (!current) return false;
  if (current instanceof FabricImage && normalizeSrc(current.getSrc()) === normalizeSrc(src)) return false;
  await replaceImageLayer(canvas, src, options);
  return true;
}

async function replaceImageLayer(canvas: Canvas, src: string, options: { select?: boolean } = {}) {
  const current = canvas.getObjects().find((object) => getMeta(object)?.role === "primary_image");
  const meta = current ? getMeta(current) : null;
  if (!current || !meta) return;
  const frame = {
    left: numberOr(current.left, 0),
    top: numberOr(current.top, 0),
    width: Math.round(numberOr(current.width, 320) * numberOr(current.scaleX, 1)),
    height: Math.round(numberOr(current.height, 240) * numberOr(current.scaleY, 1)),
  };
  canvas.remove(current);

  try {
    const image = await FabricImage.fromURL(src, { crossOrigin: "anonymous" });
    image.set({
      ...interactiveOptions(meta),
      left: frame.left,
      top: frame.top,
      originX: "left",
      originY: "top",
      clipPath: clipRect(frame),
    });
    fitImageToFrame(image, frame.width, frame.height);
    attachMeta(image, meta);
    canvas.add(image);
    if (options.select !== false) canvas.setActiveObject(image);
  } catch {
    addImagePlaceholder(canvas, frame, meta);
  }
}

function fitSelectedImage(canvas: Canvas | null) {
  if (!canvas) return;
  const object = canvas.getActiveObject() as BlockwiseFabricObject | undefined;
  const meta = object ? getMeta(object) : null;
  if (!object || meta?.editableKind !== "image") return;
  const width = Math.round(numberOr(object.width, 320) * numberOr(object.scaleX, 1));
  const height = Math.round(numberOr(object.height, 240) * numberOr(object.scaleY, 1));
  fitImageToFrame(object, width, height);
  canvas.requestRenderAll();
}

function fitImageToFrame(object: BlockwiseFabricObject, frameWidth: number, frameHeight: number) {
  const sourceWidth = numberOr(object.width, frameWidth);
  const sourceHeight = numberOr(object.height, frameHeight);
  const scale = Math.max(frameWidth / sourceWidth, frameHeight / sourceHeight);
  object.set({
    scaleX: scale,
    scaleY: scale,
  });
}

function clipRect(frame: { left: number; top: number; width: number; height: number }) {
  return new Rect({
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    originX: "left",
    originY: "top",
    absolutePositioned: true,
  });
}

function readCanvasJson(canvas: Canvas, creative: AdStudioCreative): CreativeDesignJson {
  const json = (canvas.toJSON as (propertiesToInclude?: string[]) => unknown)([
    ...FABRIC_JSON_EXTRA_KEYS,
  ]) as Record<string, unknown>;
  const objects = Array.isArray(json.objects)
    ? (json.objects as CreativeDesignObjectJson[]).filter((object) => object[BLOCKWISE_FABRIC_META_KEY])
    : [];
  return {
    ...json,
    version: "blockwise-fabric-v1",
    width: creative.canvas.width,
    height: creative.canvas.height,
    objects,
  };
}

function syncCopyFromCanvasJson(designJson: CreativeDesignJson, onCopyChange: FabricAdEditorProps["onCopyChange"]) {
  for (const object of designJson.objects) {
    const meta = object[BLOCKWISE_FABRIC_META_KEY];
    if (!meta || typeof object.text !== "string") continue;
    if (meta.role === "headline") onCopyChange("headline", object.text);
    if (meta.role === "subheadline") onCopyChange("description", object.text);
    if (meta.role === "cta_text") onCopyChange("cta", object.text);
  }
}

function syncImageFromCanvasJson(designJson: CreativeDesignJson, onImageChange: (src: string) => void) {
  const image = designJson.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "primary_image");
  if (typeof image?.src === "string" && image.src) onImageChange(image.src);
}

function updateTextRole(canvas: Canvas, role: string, text: string) {
  const object = canvas.getObjects().find((candidate) => getMeta(candidate)?.role === role) as BlockwiseFabricObject | undefined;
  if (object && typeof object.set === "function" && object.text !== text) {
    object.set("text", text);
  }
}

function syncSelection(canvas: Canvas, onSelectedElementChange: FabricAdEditorProps["onSelectedElementChange"]) {
  const active = canvas.getActiveObject();
  const meta = active ? getMeta(active) : null;
  if (!meta) return;
  if (meta.editableKind === "headline") onSelectedElementChange("headline");
  if (meta.editableKind === "description") onSelectedElementChange("description");
  if (meta.editableKind === "cta") onSelectedElementChange("cta");
  if (meta.editableKind === "image") onSelectedElementChange("image");
}

function attachMeta(object: FabricObject, meta: CreativeLayerMeta) {
  (object as BlockwiseFabricObject)[BLOCKWISE_FABRIC_META_KEY] = meta;
}

function getMeta(object: FabricObject): CreativeLayerMeta | null {
  return (object as BlockwiseFabricObject)[BLOCKWISE_FABRIC_META_KEY] ?? null;
}

function interactiveOptions(meta: CreativeLayerMeta) {
  const unlocked = !meta.locked;
  return {
    selectable: unlocked,
    evented: unlocked,
    hasControls: unlocked,
    lockMovementX: meta.locked,
    lockMovementY: meta.locked,
    lockScalingX: meta.locked,
    lockScalingY: meta.locked,
    lockRotation: meta.locked,
    editable: unlocked && meta.type === "text",
  };
}

function backgroundFill(creative: AdStudioCreative) {
  return creative.canvas.objects.find((object) => object.role === "background_shape")?.fill ?? "#F1F5F9";
}

function applyDisplaySize(canvas: Canvas, creative: AdStudioCreative) {
  const maxWidthByFormat: Record<string, number> = {
    "9:16": 350,
    "4:5": 475,
    "1:1": 520,
    "1.91:1": 560,
  };
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  const maxWidth = maxWidthByFormat[creative.format] ?? 520;
  const maxHeight = Math.max(360, viewportHeight - 250);
  const scale = Math.min(maxWidth / creative.canvas.width, maxHeight / creative.canvas.height, 1);
  canvas.setDimensions(
    {
      width: `${Math.round(creative.canvas.width * scale)}px`,
      height: `${Math.round(creative.canvas.height * scale)}px`,
    },
    { cssOnly: true },
  );
}

function numberOr(value: unknown, fallback: number): number;
function numberOr(value: unknown, fallback: undefined): undefined;
function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
