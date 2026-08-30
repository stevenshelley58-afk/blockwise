"use client";

import { useEffect, useRef, useState } from "react";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

import type {
  ImageSlotLayer,
  Layout,
  LayoutLayer,
  Rect,
  AdTemplate,
} from "../../../../packages/ad-template-contract/src/types";
import { PLACEMENT_DIMENSIONS } from "../../../../packages/ad-template-contract/src/types";
import { templateAssetProxyUrl } from "@/lib/adstudio/pack-gallery";
import { cn } from "@/lib/utils";
import { editorTargetForLayer, type EditorLayerTarget } from "./editor-target";

type LayerTarget = { layer: LayoutLayer; object: FabricObject };

const loadedFontFaces = new Map<string, Promise<void>>();

function fontStem(file: string): string {
  return file.split("/").pop()?.replace(/\.[^.]+$/u, "") || "BlockwiseAdFont";
}

function ensureLocalFont(font: { file: string }): Promise<void> {
  const family = fontStem(font.file);
  const existing = loadedFontFaces.get(family);
  if (existing) return existing;
  const task = typeof document === "undefined" || typeof FontFace === "undefined"
    ? Promise.resolve()
    : new FontFace(family, `url(/fonts/adstudio/${font.file.split("/").pop()})`).load().then(face => {
      document.fonts.add(face);
    }).catch(() => undefined);
  loadedFontFaces.set(family, task);
  return task;
}

export interface LayeredCanvasProps {
  templateId: string;
  layout: Layout;
  colours: AdTemplate["semanticColours"];
  imageValues?: Record<string, string | null | undefined>;
  textValues?: Record<string, string | null | undefined>;
  cropOverrides?: Record<string, Rect | null | undefined>;
  selectedLayerId?: string | null;
  /** @deprecated Use onTargetSelect so the inspector can focus the matching input. */
  onSelect?: (layerId: string) => void;
  onTargetSelect?: (target: EditorLayerTarget) => void;
  /** @deprecated Image selection now focuses its control; cropping is an explicit action there. */
  onCropImage?: (layer: ImageSlotLayer) => void;
  className?: string;
}

/**
 * Fabric is the headless interaction engine only. Blockwise owns every visible
 * control and style; this canvas paints the signed pack's real ordered layers
 * and provides hit-testing without exposing a second editor UI.
 */
export function LayeredCanvas({
  templateId,
  layout,
  colours,
  imageValues = {},
  textValues = {},
  cropOverrides = {},
  selectedLayerId,
  onSelect,
  onTargetSelect,
  className,
}: LayeredCanvasProps) {
  const elementRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const layerTargetsRef = useRef(new Map<string, LayerTarget>());
  const targetIdsRef = useRef(new Map<FabricObject, string>());
  const renderVersionRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  const onTargetSelectRef = useRef(onTargetSelect);
  const selectedLayerIdRef = useRef(selectedLayerId);
  const [ready, setReady] = useState(false);
  const [isRendering, setIsRendering] = useState(true);
  const [hasRendered, setHasRendered] = useState(false);

  onSelectRef.current = onSelect;
  onTargetSelectRef.current = onTargetSelect;
  selectedLayerIdRef.current = selectedLayerId;
  const selectedLayer = selectedLayerId
    ? layout.layers.find(layer => layer.layerId === selectedLayerId)
    : null;
  const selectedTarget = selectedLayer ? editorTargetForLayer(selectedLayer) : null;

  useEffect(() => {
    let cancelled = false;
    let canvas: FabricCanvas | null = null;
    void import("fabric").then(({ Canvas }) => {
      if (cancelled || !elementRef.current) return;
      canvas = new Canvas(elementRef.current, {
        preserveObjectStacking: true,
        selection: false,
        renderOnAddRemove: false,
      });
      fabricRef.current = canvas;
      canvas.on("mouse:down", event => {
        const target = event.target;
        if (!target) return;
        const layerId = targetIdsRef.current.get(target);
        if (!layerId) return;
        const editTarget = layerTargetsRef.current.get(layerId)?.layer;
        const logicalTarget = editTarget ? editorTargetForLayer(editTarget) : null;
        if (!logicalTarget) return;
        if (onTargetSelectRef.current) onTargetSelectRef.current(logicalTarget);
        else onSelectRef.current?.(layerId);
      });
      setReady(true);
    });
    return () => {
      cancelled = true;
      renderVersionRef.current += 1;
      fabricRef.current = null;
      setReady(false);
      void canvas?.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = fabricRef.current;
    const host = hostRef.current;
    if (!ready || !canvas || !host) return;
    const dims = PLACEMENT_DIMENSIONS[layout.placement];
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const zoom = Math.max(0.01, Math.min(width / dims.width, height / dims.height));
      // The host is already the zoomed display box. Keep the canvas CSS size
      // in host pixels and use the viewport transform for pack coordinates;
      // multiplying the logical dimensions here shrinks the preview twice.
      canvas.setDimensions({ width, height });
      canvas.setViewportTransform([zoom, 0, 0, zoom, 0, 0]);
      canvas.requestRenderAll();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [layout.placement, ready]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!ready || !canvas) return;
    const version = ++renderVersionRef.current;
    setIsRendering(true);
    const render = async () => {
      const fabric = await import("fabric");
      if (renderVersionRef.current !== version || fabricRef.current !== canvas) return;
      const nextLayerTargets = new Map<string, LayerTarget>();
      const nextTargetIds = new Map<FabricObject, string>();
      const nextObjects: FabricObject[] = [];

      for (const layer of layout.layers) {
        if (renderVersionRef.current !== version) return;
        const object = await createLayerObject({
          fabric,
          templateId,
          layer,
          colours,
          imageValues,
          textValues,
          cropOverrides,
        });
        if (renderVersionRef.current !== version || fabricRef.current !== canvas) return;
        if (!object) continue;
        nextObjects.push(object);
        nextLayerTargets.set(layer.layerId, { layer, object });
        if (editorTargetForLayer(layer)) nextTargetIds.set(object, layer.layerId);
      }
      if (renderVersionRef.current !== version || fabricRef.current !== canvas) return;

      canvas.discardActiveObject();
      canvas.clear();
      canvas.backgroundColor = colours.background ?? "#ffffff";
      nextObjects.forEach(object => canvas.add(object));
      layerTargetsRef.current = nextLayerTargets;
      targetIdsRef.current = nextTargetIds;
      const selectedId = selectedLayerIdRef.current;
      const selected = selectedId ? nextLayerTargets.get(selectedId)?.object : null;
      if (selected?.selectable) canvas.setActiveObject(selected);
      canvas.renderAll();
      if (renderVersionRef.current === version && fabricRef.current === canvas) {
        setHasRendered(true);
        setIsRendering(false);
      }
    };
    void render();
    return () => {
      renderVersionRef.current += 1;
    };
  }, [colours, cropOverrides, imageValues, layout, templateId, ready, textValues]);

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!ready || !canvas) return;
    const target = selectedLayerId ? layerTargetsRef.current.get(selectedLayerId)?.object : null;
    if (target?.selectable) canvas.setActiveObject(target);
    else canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [ready, selectedLayerId]);

  return (
    <div ref={hostRef} className={cn("relative h-full w-full overflow-hidden bg-white", className)}>
      <div className="sr-only" aria-live="polite">
        {selectedTarget ? `Selected ${selectedTarget.type.replace("_", " ")} field: ${selectedTarget.inputKey}` : "No editable field selected"}
      </div>
      {(!ready || (isRendering && !hasRendered)) && (
        <div
          className="pointer-events-none absolute inset-0 z-10 animate-pulse bg-muted motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      <canvas
        ref={elementRef}
        role="img"
        aria-label={`${layout.placement === "feed" ? "Feed" : "Story"} layered ad preview`}
      />
    </div>
  );
}

async function createLayerObject({
  fabric,
  templateId,
  layer,
  colours,
  imageValues,
  textValues,
  cropOverrides,
}: {
  fabric: typeof import("fabric");
  templateId: string;
  layer: LayoutLayer;
  colours: AdTemplate["semanticColours"];
  imageValues: Record<string, string | null | undefined>;
  textValues: Record<string, string | null | undefined>;
  cropOverrides: Record<string, Rect | null | undefined>;
}): Promise<FabricObject | null> {
  const geometry = layer.geometry;
  const passive = { selectable: false, evented: false, objectCaching: true } as const;
  const interactive = {
    selectable: true,
    evented: true,
    lockMovementX: true,
    lockMovementY: true,
    lockRotation: true,
    lockScalingX: true,
    lockScalingY: true,
    hasControls: false,
    borderColor: "#16181d",
    borderScaleFactor: 2,
    padding: 2,
    hoverCursor: "pointer",
    moveCursor: "pointer",
    objectCaching: true,
  } as const;
  const fill = (role: keyof AdTemplate["semanticColours"]) => colours[role] ?? "#d3d7df";

  if (layer.type === "plate") {
    const assetUrl = layer.assetKey ? templateAssetProxyUrl(templateId, layer.assetKey) : null;
    if (assetUrl) {
      try {
        const image = await fabric.FabricImage.fromURL(assetUrl);
        fitImageToGeometry(image, geometry);
        image.set(passive);
        return image;
      } catch {
        // A verified asset route can still be temporarily unavailable; retain a
        // truthful, neutral plate rather than substituting remote source pixels.
      }
    }
    return new fabric.Rect({ ...fabricRectGeometry(geometry), fill: fill(layer.colourRole), ...passive });
  }

  if (layer.type === "overlay_patch") {
    return new fabric.Rect({
      ...fabricRectGeometry(geometry),
      fill: fill(layer.colourRole),
      opacity: Math.max(0, Math.min(1, layer.opacity)),
      ...passive,
    });
  }

  if (layer.type === "text") {
    const source = textValues[layer.inputKey] ?? "";
    if (layer.overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return null;
    await ensureLocalFont(layer.font);
    const text = applyPreviewTextCase(source.slice(0, layer.maxCharacters), layer);
    const textbox = new fabric.Textbox(text, {
      left: geometry.x,
      top: geometry.y,
      originX: "left",
      originY: "top",
      width: geometry.width,
      fontFamily: fontStem(layer.font.file),
      fontSize: layer.fontSize,
      lineHeight: layer.lineHeight,
      // The artifact contract stores tracking in canvas pixels. Fabric uses
      // thousandths of an em, so convert it at the active font size.
      charSpacing: (layer.tracking / layer.fontSize) * 1000,
      textAlign: layer.alignment,
      fill: fill(layer.colourRole),
      splitByGrapheme: false,
      editable: false,
      ...interactive,
    });
    if (!fitTextboxToLayer(textbox, layer, text)) return null;
    textbox.clipPath = new fabric.Rect({ ...fabricRectGeometry(geometry), absolutePositioned: true });
    return textbox;
  }

  if (layer.type === "vector") {
    const colour = fill(layer.colourRole);
    if (layer.shape === "line") return new fabric.Path(`M ${geometry.x} ${geometry.y + geometry.height / 2} L ${geometry.x + geometry.width} ${geometry.y + geometry.height / 2}`, { fill: "", stroke: colour, strokeWidth: 2, ...passive });
    if (layer.shape === "wave") return new fabric.Path(`M ${geometry.x} ${geometry.y + geometry.height / 2} C ${geometry.x + geometry.width * .25} ${geometry.y - geometry.height / 2} ${geometry.x + geometry.width * .75} ${geometry.y + geometry.height * 1.5} ${geometry.x + geometry.width} ${geometry.y + geometry.height / 2}`, { fill: "", stroke: colour, strokeWidth: 2, ...passive });
    if (layer.shape === "notched") {
      const x = geometry.x, y = geometry.y, w = geometry.width, h = geometry.height, n = Math.min(w, h) * .2;
      return new fabric.Polygon([{ x, y }, { x: x + w - n, y }, { x: x + w, y: y + n }, { x: x + w, y: y + h }, { x: x + n, y: y + h }, { x, y: y + h - n }], { fill: colour, ...passive });
    }
    if (layer.shape === "ring") return new fabric.Circle({ left: geometry.x + geometry.width / 2, top: geometry.y + geometry.height / 2, originX: "center", originY: "center", radius: Math.min(geometry.width, geometry.height) / 2, fill: "", stroke: colour, strokeWidth: Math.max(2, Math.min(geometry.width, geometry.height) * .08), opacity: layer.opacity ?? 1, ...passive });
    const radius = layer.shape === "pill" ? Math.min(geometry.width, geometry.height) / 2 : layer.shape === "rounded" ? Math.min(16, geometry.width / 4, geometry.height / 4) : 0;
    if (layer.shape === "circle") {
      return new fabric.Circle({ left: geometry.x, top: geometry.y, originX: "left", originY: "top", radius: Math.min(geometry.width, geometry.height) / 2, fill: colour, opacity: layer.opacity ?? 1, ...passive });
    }
    return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, fill: colour, opacity: layer.opacity ?? 1, ...passive });
  }

  if (layer.type === "icon") {
    const x = geometry.x, y = geometry.y, w = geometry.width, h = geometry.height;
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * .36;
    const px = (fraction: number) => x + w * fraction;
    const py = (fraction: number) => y + h * fraction;
    const iconPath = (() => {
      switch (layer.icon) {
        case "arrow":
          return `M ${px(.1)} ${cy} L ${px(.9)} ${cy} M ${px(.55)} ${py(.18)} L ${px(.9)} ${cy} L ${px(.55)} ${py(.82)}`;
        case "check":
          return `M ${px(.18)} ${cy} L ${px(.42)} ${py(.76)} L ${px(.84)} ${py(.24)}`;
        case "phone":
          return `M ${px(.28)} ${py(.17)} C ${px(.18)} ${py(.23)} ${px(.18)} ${py(.38)} ${px(.3)} ${py(.56)} C ${px(.43)} ${py(.75)} ${px(.66)} ${py(.88)} ${px(.8)} ${py(.78)} L ${px(.68)} ${py(.61)} C ${px(.61)} ${py(.66)} ${px(.54)} ${py(.63)} ${px(.46)} ${py(.54)} C ${px(.38)} ${py(.45)} ${px(.35)} ${py(.38)} ${px(.4)} ${py(.31)} Z`;
        case "mail":
          return `M ${px(.12)} ${py(.22)} L ${px(.88)} ${py(.22)} L ${px(.88)} ${py(.78)} L ${px(.12)} ${py(.78)} Z M ${px(.13)} ${py(.24)} L ${cx} ${py(.55)} L ${px(.87)} ${py(.24)}`;
        case "globe":
          return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} M ${cx} ${cy - r} C ${cx - r * .48} ${cy - r * .52} ${cx - r * .48} ${cy + r * .52} ${cx} ${cy + r} M ${cx} ${cy - r} C ${cx + r * .48} ${cy - r * .52} ${cx + r * .48} ${cy + r * .52} ${cx} ${cy + r} M ${cx - r} ${cy} L ${cx + r} ${cy}`;
        case "pin":
          return `M ${cx} ${py(.9)} C ${px(.34)} ${py(.69)} ${px(.22)} ${py(.52)} ${px(.22)} ${py(.36)} C ${px(.22)} ${py(.16)} ${px(.35)} ${py(.08)} ${cx} ${py(.08)} C ${px(.65)} ${py(.08)} ${px(.78)} ${py(.16)} ${px(.78)} ${py(.36)} C ${px(.78)} ${py(.52)} ${px(.66)} ${py(.69)} ${cx} ${py(.9)} Z M ${px(.41)} ${py(.36)} A ${w * .09} ${w * .09} 0 1 0 ${px(.59)} ${py(.36)} A ${w * .09} ${w * .09} 0 1 0 ${px(.41)} ${py(.36)}`;
      }
    })();
    return new fabric.Path(iconPath, {
      fill: "",
      stroke: fill(layer.colourRole),
      strokeWidth: Math.max(2, Math.min(w, h) * .08),
      strokeLineCap: "round",
      strokeLineJoin: "round",
      ...passive,
    });
  }

  const src = (layer.type === "image_slot" || layer.type === "logo") ? imageValues[layer.inputKey] ?? null : null;
  if (src) {
    try {
      const image = await fabric.FabricImage.fromURL(src);
      if (layer.type === "image_slot") {
        cropImageToGeometry(image, geometry, cropOverrides[layer.inputKey] ?? layer.defaultCrop);
        image.clipPath = maskForSlot(fabric, layer);
      } else {
        fitImageToGeometry(image, geometry);
      }
      image.set(interactive);
      return image;
    } catch {
      // The authenticated image may have expired during a navigation. The
      // placeholder remains selectable so the customer can replace it.
    }
  }

  if (layer.type === "image_slot" || layer.type === "logo") {
    if (layer.type === "logo") {
      return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: Math.min(12, geometry.height / 3), ry: Math.min(12, geometry.height / 3), fill: "#f1f2f4", stroke: "#d3d7df", strokeWidth: 2, ...interactive });
    }
    const radius = layer.mask === "rounded_rect" ? Math.min(24, geometry.width / 4, geometry.height / 4) : 0;
    if (layer.mask === "circle") {
      return new fabric.Circle({
        left: geometry.x,
        top: geometry.y,
        originX: "left",
        originY: "top",
        radius: Math.min(geometry.width, geometry.height) / 2,
        fill: "#f1f2f4",
        stroke: "#d3d7df",
        strokeWidth: 2,
        ...interactive,
      });
    }
    return new fabric.Rect({
      ...fabricRectGeometry(geometry),
      rx: radius,
      ry: radius,
      fill: "#f1f2f4",
      stroke: "#d3d7df",
      strokeWidth: 2,
      ...interactive,
    });
  }

  return new fabric.Rect({
    ...fabricRectGeometry(geometry),
    rx: Math.min(16, geometry.width / 4, geometry.height / 4),
    ry: Math.min(16, geometry.width / 4, geometry.height / 4),
    fill: fill("primary"),
    ...passive,
  });
}

type PreviewTextLayer = Extract<LayoutLayer, { type: "text" }> & {
  sizeRatio?: number;
  case?: "upper" | "lower" | "none";
};

function applyPreviewTextCase(text: string, layer: PreviewTextLayer): string {
  if (layer.case === "upper") return text.toUpperCase();
  if (layer.case === "lower") return text.toLowerCase();
  return text;
}

/**
 * Fabric calculates a Textbox's rendered height from its wrapped lines; an
 * authored `height` option is discarded. Fit against those real browser
 * metrics so the editor honours the same line and overflow contract as the
 * production renderer instead of hiding oversized copy behind a clip path.
 */
function fitTextboxToLayer(
  textbox: import("fabric").Textbox,
  layer: PreviewTextLayer,
  text: string,
): boolean {
  const authoredRatio = Number(layer.sizeRatio);
  const baseFontSize = Number.isFinite(authoredRatio) && authoredRatio > 0
    ? layer.geometry.height * authoredRatio
    : layer.fontSize;
  const boxFloor = layer.geometry.height / Math.max(1, layer.maxLines * layer.lineHeight);
  const minimumSize = layer.overflowBehaviour === "scale_down"
    ? Math.max(1, Math.min(baseFontSize * 0.45, boxFloor))
    : layer.overflowBehaviour === "truncate"
      ? Math.max(1, Math.min(baseFontSize, boxFloor))
      : baseFontSize;

  for (let fontSize = Math.max(1, baseFontSize); fontSize >= minimumSize - 0.001; fontSize -= 0.5) {
    setTextboxContent(textbox, text, fontSize, layer.tracking);
    if (textboxFitsLayer(textbox, layer)) return true;
  }
  if (layer.overflowBehaviour === "refuse") return false;

  const suffix = layer.overflowBehaviour === "truncate" ? "…" : "";
  const graphemes = splitGraphemes(text);
  let low = 0;
  let high = graphemes.length;
  let fitted = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const prefix = graphemes.slice(0, middle).join("").trimEnd();
    const candidate = middle < graphemes.length ? `${prefix}${suffix}` : prefix;
    setTextboxContent(textbox, candidate, minimumSize, layer.tracking);
    if (textboxFitsLayer(textbox, layer)) {
      fitted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  setTextboxContent(textbox, fitted, minimumSize, layer.tracking);
  return textboxFitsLayer(textbox, layer);
}

function setTextboxContent(textbox: import("fabric").Textbox, text: string, fontSize: number, tracking: number): void {
  textbox.set({ text, fontSize, charSpacing: (tracking / Math.max(1, fontSize)) * 1000 });
  textbox.initDimensions();
  textbox.setCoords();
}

function textboxFitsLayer(textbox: import("fabric").Textbox, layer: PreviewTextLayer): boolean {
  return textbox.textLines.length <= layer.maxLines
    && textbox.width <= layer.geometry.width + 0.01
    && textbox.height <= layer.geometry.height + 0.01;
}

function splitGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

/** Fabric uses left/top for object placement; pack contracts use x/y. */
function fabricRectGeometry(geometry: Rect) {
  return {
    left: geometry.x,
    top: geometry.y,
    originX: "left" as const,
    originY: "top" as const,
    width: geometry.width,
    height: geometry.height,
  };
}

function fitImageToGeometry(image: import("fabric").FabricImage, geometry: Rect) {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  image.set({
    left: geometry.x,
    top: geometry.y,
    originX: "left",
    originY: "top",
    scaleX: geometry.width / width,
    scaleY: geometry.height / height,
  });
}

function cropImageToGeometry(image: import("fabric").FabricImage, geometry: Rect, rawCrop: Rect) {
  const element = image.getElement() as HTMLImageElement;
  const sourceWidth = Math.max(1, element.naturalWidth || image.width);
  const sourceHeight = Math.max(1, element.naturalHeight || image.height);
  const crop = normalizedCrop(rawCrop);
  const cropWidth = Math.max(1, crop.width * sourceWidth);
  const cropHeight = Math.max(1, crop.height * sourceHeight);
  image.set({
    left: geometry.x,
    top: geometry.y,
    originX: "left",
    originY: "top",
    cropX: crop.x * sourceWidth,
    cropY: crop.y * sourceHeight,
    width: cropWidth,
    height: cropHeight,
    scaleX: geometry.width / cropWidth,
    scaleY: geometry.height / cropHeight,
  });
}

function normalizedCrop(crop: Rect): Rect {
  const x = Math.max(0, Math.min(1, crop.x));
  const y = Math.max(0, Math.min(1, crop.y));
  return {
    x,
    y,
    width: Math.max(0.01, Math.min(1 - x, crop.width)),
    height: Math.max(0.01, Math.min(1 - y, crop.height)),
  };
}

function maskForSlot(fabric: typeof import("fabric"), layer: ImageSlotLayer) {
  const geometry = layer.geometry;
  if (layer.mask === "circle") {
    return new fabric.Circle({
      left: geometry.x,
      top: geometry.y,
      originX: "left",
      originY: "top",
      radius: Math.min(geometry.width, geometry.height) / 2,
      absolutePositioned: true,
    });
  }
  const radius = layer.mask === "rounded_rect" ? Math.min(24, geometry.width / 4, geometry.height / 4) : 0;
  return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, absolutePositioned: true });
}
