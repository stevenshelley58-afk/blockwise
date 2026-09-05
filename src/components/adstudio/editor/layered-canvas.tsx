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
import {
  effectiveTextFontSize,
  fabricCharSpacing,
  fabricCircleGeometry,
  fabricLinePathData,
  fabricIconPathData,
  fabricPathPosition,
  fabricRectGeometry,
  imageMaskRadius,
  resolveIconShape,
  resolveGeometry,
} from "./layer-geometry";

type LayerTarget = { layer: LayoutLayer; object: FabricObject };

const loadedFontFaces = new Map<string, Promise<void>>();

function fontStem(file: string): string {
  return file.split("/").pop()?.replace(/\.[^.]+$/u, "") || "BlockwiseAdFont";
}

function ensureTemplateFont(templateId: string, existingAdId: string, assets: AdTemplate["assets"], font: { file: string }): Promise<void> {
  const family = fontStem(font.file);
  const declaration = Object.entries(assets).find(([, asset]) => asset.fileName === font.file);
  const assetKey = declaration?.[0] ?? null;
  const fontUrl = assetKey
    ? templateAssetProxyUrl(templateId, assetKey, existingAdId)
    : `/fonts/adstudio/${font.file.split("/").pop()}`;
  if (!fontUrl) throw new Error(`Font asset route is invalid for ${font.file}`);
  const cacheKey = `${templateId}:${assetKey ?? fontUrl}:${font.file}`;
  const existing = loadedFontFaces.get(cacheKey);
  if (existing) return existing;
  const task = typeof document === "undefined" || typeof FontFace === "undefined"
    ? Promise.resolve()
    : new FontFace(family, `url(${fontUrl})`).load().then(face => {
      document.fonts.add(face);
    }).catch(() => { throw new Error(`Font ${font.file} could not be loaded from the template asset.`); });
  loadedFontFaces.set(cacheKey, task);
  return task;
}

export interface LayeredCanvasProps {
  templateId: string;
  /** Saved-ad identity used to authorize withdrawn template assets. */
  existingAdId: string;
  assets: AdTemplate["assets"];
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
  existingAdId,
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
          existingAdId,
          placement: layout.placement,
          layer,
          colours,
          imageValues,
          textValues,
          cropOverrides,
        });
        if (!object || renderVersionRef.current !== version) continue;
        applyFabricAppearance(object, layer, fabric, colours, resolveGeometry(layer.geometry, PLACEMENT_DIMENSIONS[layout.placement]));
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
  }, [colours, cropOverrides, existingAdId, imageValues, layout, templateId, ready, selectedLayerId, textValues]);

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
  existingAdId,
  assets,
  placement,
  layer,
  colours,
  imageValues,
  textValues,
  cropOverrides,
}: {
  fabric: typeof import("fabric");
  templateId: string;
  existingAdId: string;
  assets: AdTemplate["assets"];
  placement: Layout["placement"];
  layer: LayoutLayer;
  colours: AdTemplate["semanticColours"];
  imageValues: Record<string, string | null | undefined>;
  textValues: Record<string, string | null | undefined>;
  cropOverrides: Record<string, Rect | null | undefined>;
}): Promise<FabricObject | null> {
  // Packs may author geometry as normalized ratios. Keep the editor's Fabric
  // scene in the same logical coordinates as the server renderer, regardless
  // of whether a signed pack used pixels or ratios for this placement.
  const geometry = resolveGeometry(layer.geometry, PLACEMENT_DIMENSIONS[placement]);
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
    const assetUrl = layer.assetKey ? templateAssetProxyUrl(templateId, layer.assetKey, existingAdId) : null;
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
    const rawSource = textValues[layer.inputKey] ?? "";
    const source = layer.case === "upper" ? rawSource.toUpperCase() : layer.case === "lower" ? rawSource.toLowerCase() : rawSource;
    if (layer.overflowBehaviour === "refuse" && source.length > layer.maxCharacters) return null;
    const text = source.slice(0, layer.maxCharacters);
    await ensureTemplateFont(templateId, existingAdId, assets, layer.font);
    const fontSize = effectiveTextFontSize(layer, geometry);
    const textbox = new fabric.Textbox(text, {
      left: geometry.x,
      top: geometry.y,
      originX: "left",
      originY: "top",
      width: geometry.width,
      height: geometry.height,
      fontFamily: fontStem(layer.font.file),
      fontWeight: layer.fontWeight ?? "normal",
      fontStyle: layer.italic ? "italic" : "normal",
      fontSize,
      lineHeight: layer.lineHeight,
      charSpacing: fabricCharSpacing(layer.tracking, fontSize),
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
    if (layer.shape === "line") {
      const path = new fabric.Path(fabricLinePathData(geometry.width, geometry.height), { fill: "", stroke: colour, strokeWidth: 2, ...interactive });
      path.set(fabricPathPosition(path, geometry));
      return path;
    }
    if (layer.shape === "wave") {
      const path = new fabric.Path(`M 0 ${geometry.height / 2} C ${geometry.width * .25} ${-geometry.height / 2} ${geometry.width * .75} ${geometry.height * 1.5} ${geometry.width} ${geometry.height / 2}`, { fill: "", stroke: colour, strokeWidth: 2, ...interactive });
      path.set(fabricPathPosition(path, geometry));
      return path;
    }
    if (layer.shape === "notched") {
      const w = geometry.width, h = geometry.height, n = Math.min(w, h) * .2;
      const polygon = new fabric.Polygon([{ x: 0, y: 0 }, { x: w - n, y: 0 }, { x: w, y: n }, { x: w, y: h }, { x: n, y: h }, { x: 0, y: h - n }], { fill: colour, ...interactive });
      polygon.set(fabricPathPosition(polygon, geometry));
      return polygon;
    }
    if (layer.shape === "ring") return new fabric.Circle({ left: geometry.x + geometry.width / 2, top: geometry.y + geometry.height / 2, originX: "center", originY: "center", radius: Math.min(geometry.width, geometry.height) / 2, fill: "", stroke: colour, strokeWidth: Math.max(2, Math.min(geometry.width, geometry.height) * .08), opacity: layer.opacity ?? 1, ...interactive });
    const radius = layer.shape === "pill" ? Math.min(geometry.width, geometry.height) / 2 : layer.cornerRadius ?? (layer.shape === "rounded" ? Math.min(16, geometry.width / 4, geometry.height / 4) : 0);
    if (layer.shape === "circle") {
      return new fabric.Circle({ ...fabricCircleGeometry(geometry), fill: colour, opacity: layer.opacity ?? 1, ...interactive });
    }
    return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, fill: colour, opacity: layer.opacity ?? 1, ...interactive });
  }

  if (layer.type === "icon") {
    const w = geometry.width, h = geometry.height;
    const iconShape = resolveIconShape(layer.icon);
    if (!iconShape) return null;
    const iconPath = fabricIconPathData(layer.icon, w, h);
    if (!iconPath) return null;
    const path = new fabric.Path(iconPath, { fill: "", stroke: fill(layer.colourRole), strokeWidth: Math.max(2, Math.min(w, h) * .1), ...interactive });
    path.set(fabricPathPosition(path, geometry));
    return path;
  }

  const src = (layer.type === "image_slot" || layer.type === "logo") ? imageValues[layer.inputKey] ?? null : null;
  if (src) {
    try {
      const image = await fabric.FabricImage.fromURL(src);
      if (layer.type === "image_slot") {
        cropImageToGeometry(image, geometry, cropOverrides[layer.inputKey] ?? layer.defaultCrop);
        image.clipPath = maskForSlot(fabric, layer, geometry);
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
    const radius = layer.mask === "rounded_rect" ? layer.cornerRadius ?? imageMaskRadius(geometry) : 0;
    if (layer.mask === "circle") {
      return new fabric.Circle({
        ...fabricCircleGeometry(geometry),
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

function applyFabricAppearance(
  object: FabricObject,
  layer: LayoutLayer,
  fabric: typeof import("fabric"),
  colours: AdTemplate["semanticColours"],
  geometry: Rect,
) {
  const effects = layer.effects;
  const opacity = "opacity" in layer && typeof layer.opacity === "number" ? layer.opacity : 1;
  object.set({
    opacity,
    globalCompositeOperation: effects?.blendMode ?? "source-over",
  });
  if (effects?.rotationDegrees) {
    const centre = object.getCenterPoint();
    object.set({ originX: "center", originY: "center", left: centre.x, top: centre.y, angle: effects.rotationDegrees });
  } else {
    object.set("angle", 0);
  }
  if (effects?.shadow) {
    object.set("shadow", new fabric.Shadow({
      color: colourWithOpacity(colours[effects.shadow.colourRole] ?? "#000000", effects.shadow.opacity),
      blur: effects.shadow.blur,
      offsetX: effects.shadow.offsetX,
      offsetY: effects.shadow.offsetY,
    }));
  }
  if (effects?.stroke) object.set({
    stroke: colourWithOpacity(colours[effects.stroke.colourRole] ?? "#000000", effects.stroke.opacity),
    strokeWidth: effects.stroke.width,
  });
  if ("fill" in layer && layer.fill && !(object instanceof fabric.FabricImage)) {
    const radians = layer.fill.angleDegrees * Math.PI / 180;
    const length = Math.abs(geometry.width * Math.cos(radians)) + Math.abs(geometry.height * Math.sin(radians));
    const cx = geometry.width / 2;
    const cy = geometry.height / 2;
    const dx = Math.cos(radians) * length / 2;
    const dy = Math.sin(radians) * length / 2;
    object.set("fill", new fabric.Gradient({
      type: "linear",
      gradientUnits: "pixels",
      coords: { x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy },
      colorStops: layer.fill.stops.map((stop) => ({ offset: stop.offset, color: colourWithOpacity(colours[stop.colourRole] ?? "#000000", stop.opacity) })),
    }));
  }
}

function colourWithOpacity(colour: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!match) return colour;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.min(1, Math.max(0, opacity))})`;
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

function maskForSlot(fabric: typeof import("fabric"), layer: ImageSlotLayer, geometry: Rect) {
  if (layer.mask === "circle") {
    return new fabric.Circle({
      ...fabricCircleGeometry(geometry),
      absolutePositioned: true,
    });
  }
  const radius = layer.mask === "rounded_rect" ? layer.cornerRadius ?? imageMaskRadius(geometry) : 0;
  return new fabric.Rect({ ...fabricRectGeometry(geometry), rx: radius, ry: radius, absolutePositioned: true });
}
