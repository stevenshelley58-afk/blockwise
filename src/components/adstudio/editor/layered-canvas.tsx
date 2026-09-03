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
  onSelect?: (layerId: string) => void;
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
  onCropImage,
  className,
}: LayeredCanvasProps) {
  const elementRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const layerTargetsRef = useRef(new Map<string, LayerTarget>());
  const targetIdsRef = useRef(new Map<FabricObject, string>());
  const renderVersionRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  const onCropRef = useRef(onCropImage);
  const layoutRef = useRef(layout);
  const [ready, setReady] = useState(false);

  onSelectRef.current = onSelect;
  onCropRef.current = onCropImage;
  layoutRef.current = layout;

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
        onSelectRef.current?.(layerId);
        const layer = layoutRef.current.layers.find(item => item.layerId === layerId);
        if (layer?.type === "image_slot") onCropRef.current?.(layer);
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
      // Fabric's backing store stays in pack coordinates so objects and hit
      // testing remain aligned. Only the CSS box follows the responsive host.
      canvas.setDimensions({ width: dims.width, height: dims.height });
      canvas.setDimensions({ width, height }, { cssOnly: true });
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
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
    const render = async () => {
      const fabric = await import("fabric");
      if (renderVersionRef.current !== version || fabricRef.current !== canvas) return;
      canvas.discardActiveObject();
      canvas.clear();
      canvas.backgroundColor = colours.background ?? "#ffffff";
      layerTargetsRef.current = new Map();
      targetIdsRef.current = new Map();

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
        if (!object || renderVersionRef.current !== version) continue;
        canvas.add(object);
        layerTargetsRef.current.set(layer.layerId, { layer, object });
        targetIdsRef.current.set(object, layer.layerId);
      }
      const selected = selectedLayerId ? layerTargetsRef.current.get(selectedLayerId)?.object : null;
      if (selected?.selectable) canvas.setActiveObject(selected);
      canvas.requestRenderAll();
    };
    void render();
    return () => {
      renderVersionRef.current += 1;
    };
  }, [colours, cropOverrides, imageValues, layout, templateId, ready, selectedLayerId, textValues]);

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
      <div className="sr-only" aria-live="polite">{selectedLayerId ? `Selected layer: ${layout.layers.find(layer => layer.layerId === selectedLayerId)?.layerId ?? selectedLayerId}` : "No layer selected"}</div>
      {!ready && <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden="true" />}
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
    const text = textValues[layer.inputKey] ?? "";
    await ensureLocalFont(layer.font);
    const textbox = new fabric.Textbox(text, {
      left: geometry.x,
      top: geometry.y,
      width: geometry.width,
      height: geometry.height,
      fontFamily: fontStem(layer.font.file),
      fontSize: layer.fontSize,
      lineHeight: layer.lineHeight,
      charSpacing: layer.tracking * 1000,
      textAlign: layer.alignment,
      fill: fill(layer.colourRole),
      splitByGrapheme: true,
      editable: false,
      ...interactive,
    });
    textbox.clipPath = new fabric.Rect({ ...fabricRectGeometry(geometry), absolutePositioned: true });
    return textbox;
  }

  if (layer.type === "vector") {
    const colour = fill(layer.colourRole);
    if (layer.shape === "line") return new fabric.Path(`M ${geometry.x} ${geometry.y + geometry.height / 2} L ${geometry.x + geometry.width} ${geometry.y + geometry.height / 2}`, { fill: "", stroke: colour, strokeWidth: 2, ...interactive });
    if (layer.shape === "wave") return new fabric.Path(`M ${geometry.x} ${geometry.y + geometry.height / 2} C ${geometry.x + geometry.width * .25} ${geometry.y - geometry.height / 2} ${geometry.x + geometry.width * .75} ${geometry.y + geometry.height * 1.5} ${geometry.x + geometry.width} ${geometry.y + geometry.height / 2}`, { fill: "", stroke: colour, strokeWidth: 2, ...interactive });
    if (layer.shape === "notched") {
      const x = geometry.x, y = geometry.y, w = geometry.width, h = geometry.height, n = Math.min(w, h) * .2;
      return new fabric.Polygon([{ x, y }, { x: x + w - n, y }, { x: x + w, y: y + n }, { x: x + w, y: y + h }, { x: x + n, y: y + h }, { x, y: y + h - n }], { fill: colour, ...interactive });
    }
    if (layer.shape === "ring") return new fabric.Circle({ left: geometry.x + geometry.width / 2, top: geometry.y + geometry.height / 2, originX: "center", originY: "center", radius: Math.min(geometry.width, geometry.height) / 2, fill: "", stroke: colour, strokeWidth: Math.max(2, Math.min(geometry.width, geometry.height) * .08), opacity: layer.opacity ?? 1, ...interactive });
    const radius = layer.shape === "pill" ? Math.min(geometry.width, geometry.height) / 2 : layer.shape === "rounded" ? Math.min(16, geometry.width / 4, geometry.height / 4) : 0;
    if (layer.shape === "circle") {
      return new fabric.Circle({ left: geometry.x, top: geometry.y, radius: Math.min(geometry.width, geometry.height) / 2, fill: colour, opacity: layer.opacity ?? 1, ...interactive });
    }
    return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, fill: colour, opacity: layer.opacity ?? 1, ...interactive });
  }

  if (layer.type === "icon") {
    const x = geometry.x, y = geometry.y, w = geometry.width, h = geometry.height;
    const iconPath = layer.icon === "arrow" ? `M ${x + w * .1} ${y + h / 2} L ${x + w * .9} ${y + h / 2} M ${x + w * .55} ${y + h * .18} L ${x + w * .9} ${y + h / 2} L ${x + w * .55} ${y + h * .82}` : `M ${x + w * .12} ${y + h * .52} L ${x + w * .4} ${y + h * .8} L ${x + w * .88} ${y + h * .2}`;
    return new fabric.Path(iconPath, { fill: "", stroke: fill(layer.colourRole), strokeWidth: Math.max(2, Math.min(w, h) * .1), ...interactive });
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
    ...interactive,
  });
}

/** Fabric uses left/top for object placement; pack contracts use x/y. */
function fabricRectGeometry(geometry: Rect) {
  return {
    left: geometry.x,
    top: geometry.y,
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
      radius: Math.min(geometry.width, geometry.height) / 2,
      absolutePositioned: true,
    });
  }
  const radius = layer.mask === "rounded_rect" ? Math.min(24, geometry.width / 4, geometry.height / 4) : 0;
  return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, absolutePositioned: true });
}
