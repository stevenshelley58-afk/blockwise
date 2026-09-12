import type { AdDocumentParsed } from "../../../../packages/ad-template-contract/src/schema";
import type { AdTemplate, Layout, LayoutLayer, Placement, Rect } from "../../../../packages/ad-template-contract/src/types";
import { effectiveTextFontSize, fabricCharSpacing, fabricIconPathData, fabricLinePathData, imageMaskRadius, resolveGeometry } from "../editor/layer-geometry.ts";
import { templateAssetProxyUrl } from "../../../lib/adstudio/pack-gallery.ts";

export type FabricObject = { type?: string; objects?: FabricObject[]; [key: string]: any };
export type FabricScene = { version: string; width: number; height: number; objects: FabricObject[]; [key: string]: any };
export interface VueNativeEditorDocument { engine: "vue-fabric-editor"; version: 1; feed: FabricScene; story: FabricScene; sourceAdId?: string }

export function readVueNativeEditor(document: unknown): VueNativeEditorDocument | null {
  const native = document && typeof document === "object" ? (document as { nativeEditor?: unknown }).nativeEditor : null;
  if (!native || typeof native !== "object") return null;
  const value = native as Partial<VueNativeEditorDocument>;
  return value.engine === "vue-fabric-editor" && value.version === 1
    && isFabricScene(value.feed, 1080, 1350) && isFabricScene(value.story, 1080, 1920)
    ? value as VueNativeEditorDocument : null;
}

export function isFabricScene(value: unknown, width?: number, height?: number): value is FabricScene {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const scene = value as Partial<FabricScene>;
  return Array.isArray(scene.objects) && typeof scene.width === "number" && typeof scene.height === "number"
    && (!width || scene.width === width) && (!height || scene.height === height);
}

export function templateTextValues(pack: AdTemplate, document?: AdDocumentParsed): Record<string, string> {
  return Object.fromEntries(pack.textInputs.map(input => [input.key, document?.sharedTextValues[input.key]?.trim() ? document.sharedTextValues[input.key] : input.placeholder]));
}

export function convertTemplateToFabricScenes(input: { pack: AdTemplate; adId: string; document?: AdDocumentParsed; sourceAdId?: string }): VueNativeEditorDocument {
  const text = templateTextValues(input.pack, input.document);
  const colours = { ...input.pack.semanticColours, ...(input.document?.resolvedColourMap ?? {}) };
  return {
    engine: "vue-fabric-editor", version: 1,
    feed: convertLayout(input.pack.feedLayout, input.pack, input.adId, text, input.document?.sharedImageValues ?? {}, input.document?.feedCropOverrides ?? {}, colours),
    story: convertLayout(input.pack.storyLayout, input.pack, input.adId, text, input.document?.sharedImageValues ?? {}, input.document?.storyCropOverrides ?? {}, colours),
    ...(input.sourceAdId ? { sourceAdId: input.sourceAdId } : {}),
  };
}

function convertLayout(layout: Layout, pack: AdTemplate, adId: string, text: Record<string, string>, images: Record<string, string>, crops: Record<string, Rect>, colours: Record<string, string>): FabricScene {
  const dims = layout.placement === "feed" ? { width: 1080, height: 1350 } : { width: 1080, height: 1920 };
  const layers = layout.layers.flatMap(layer => {
    const value = convertLayer(layer, layout.placement, dims, pack, adId, text, images, crops, colours);
    return value ? [value] : [];
  });
  if (!layers.length) throw new Error(`${layout.placement} template contains no editable layers.`);
  const workspace: FabricObject = {
    type: "rect", id: "workspace", name: "workspace", left: 0, top: 0, originX: "left", originY: "top",
    width: dims.width, height: dims.height, fill: colours.background ?? "#ffffff",
    selectable: false, evented: false, hasControls: false, metadata: { workspace: true },
  };
  return { version: "5.3.0", width: dims.width, height: dims.height, objects: [workspace, ...layers] };
}

function convertLayer(layer: LayoutLayer, placement: Placement, dims: { width: number; height: number }, pack: AdTemplate, adId: string, text: Record<string, string>, images: Record<string, string>, crops: Record<string, Rect>, colours: Record<string, string>): FabricObject | null {
  const box = resolveGeometry(layer.geometry, dims);
  const colour = (role: string) => colours[role] ?? "#d3d7df";
  const shared: FabricObject = {
    id: layer.layerId, layerId: layer.layerId, left: box.x, top: box.y, originX: "left", originY: "top",
    angle: layer.effects?.rotationDegrees ?? 0,
    opacity: "opacity" in layer ? layer.opacity ?? 1 : 1,
    globalCompositeOperation: layer.effects?.blendMode ?? "source-over",
    shadow: layer.effects?.shadow ? { color: rgba(colour(layer.effects.shadow.colourRole), layer.effects.shadow.opacity), blur: layer.effects.shadow.blur, offsetX: layer.effects.shadow.offsetX, offsetY: layer.effects.shadow.offsetY, affectStroke: true } : undefined,
    stroke: layer.effects?.stroke ? rgba(colour(layer.effects.stroke.colourRole), layer.effects.stroke.opacity) : undefined,
    strokeWidth: layer.effects?.stroke?.width ?? 0,
    metadata: { layerId: layer.layerId, blockwiseType: layer.type },
  };
  if (layer.type === "plate" || layer.type === "overlay_patch") {
    const src = layer.assetKey ? templateAssetProxyUrl(pack.templateId, layer.assetKey, adId) : null;
    if (src) return imageObject(shared, src, box, undefined, layer.type === "plate");
    return { ...shared, type: "rect", width: box.width, height: box.height, rx: layer.cornerRadius ?? 0, ry: layer.cornerRadius ?? 0, fill: layer.fill ? gradient(layer.fill, box, colours) : colour(layer.colourRole), selectable: layer.type !== "plate" || !layer.protected, evented: layer.type !== "plate" || !layer.protected };
  }
  if (layer.type === "text") {
    const raw = text[layer.inputKey] ?? pack.textInputs.find(candidate => candidate.key === layer.inputKey)?.placeholder ?? "";
    const value = layer.case === "upper" ? raw.toUpperCase() : layer.case === "lower" ? raw.toLowerCase() : raw;
    const size = effectiveTextFontSize(layer, box);
    return {
      ...shared, type: "textbox", inputKey: layer.inputKey,
      metadata: { layerId: layer.layerId, inputKey: layer.inputKey, blockwiseType: "text" },
      text: value.slice(0, layer.maxCharacters), width: box.width, height: box.height,
      fontFamily: `Blockwise_${encodeURIComponent(pack.templateId)}_${encodeURIComponent(layer.font.file)}`,
      fontSize: size, fontWeight: layer.fontWeight ?? 400, fontStyle: layer.italic ? "italic" : "normal",
      lineHeight: layer.lineHeight, charSpacing: fabricCharSpacing(layer.tracking, size), textAlign: layer.alignment,
      fill: colour(layer.colourRole), splitByGrapheme: true, editable: true,
    };
  }
  if (layer.type === "vector") {
    const fill = colour(layer.colourRole);
    if (layer.shape === "circle" || layer.shape === "ring") {
      const diameter = Math.min(box.width, box.height);
      return { ...shared, type: "circle", left: box.x + (box.width - diameter) / 2, top: box.y + (box.height - diameter) / 2, radius: diameter / 2, fill: layer.shape === "ring" ? "" : layer.fill ? gradient(layer.fill, box, colours) : fill, stroke: layer.shape === "ring" ? fill : shared.stroke, strokeWidth: layer.shape === "ring" ? Math.max(2, diameter * .08) : shared.strokeWidth };
    }
    if (layer.shape === "line" || layer.shape === "wave") {
      const path = layer.shape === "line" ? fabricLinePathData(box.width, box.height) : `M 0 ${box.height / 2} C ${box.width * .25} ${-box.height / 2} ${box.width * .75} ${box.height * 1.5} ${box.width} ${box.height / 2}`;
      return { ...shared, type: "path", path, width: box.width, height: box.height, fill: "", stroke: fill, strokeWidth: Math.max(2, Number(shared.strokeWidth)) };
    }
    if (layer.shape === "notched") {
      const n = Math.min(box.width, box.height) * .2;
      return { ...shared, type: "polygon", points: [{ x: 0, y: 0 }, { x: box.width - n, y: 0 }, { x: box.width, y: n }, { x: box.width, y: box.height }, { x: n, y: box.height }, { x: 0, y: box.height - n }], fill };
    }
    const radius = layer.shape === "pill" ? Math.min(box.width, box.height) / 2 : layer.cornerRadius ?? (layer.shape === "rounded" ? Math.min(16, box.width / 4, box.height / 4) : 0);
    return { ...shared, type: "rect", width: box.width, height: box.height, rx: radius, ry: radius, fill: layer.fill ? gradient(layer.fill, box, colours) : fill };
  }
  if (layer.type === "icon") {
    const path = fabricIconPathData(layer.icon, box.width, box.height);
    if (!path) throw new Error(`Unsupported template icon: ${layer.icon}`);
    return { ...shared, type: "path", path, width: box.width, height: box.height, fill: "", stroke: colour(layer.colourRole), strokeWidth: Math.max(2, Math.min(box.width, box.height) * .1) };
  }
  const inputKey = layer.inputKey;
  const fallback = pack.imageInputs.find(candidate => candidate.key === inputKey)?.defaultAssetKey;
  const src = images[inputKey] || (fallback ? templateAssetProxyUrl(pack.templateId, fallback, adId) : null);
  const metadata: FabricObject = { layerId: layer.layerId, inputKey, blockwiseType: layer.type };
  if (src) {
    const crop = layer.type === "image_slot" ? crops[inputKey] ?? layer.defaultCrop : undefined;
    const object = imageObject({ ...shared, inputKey, metadata }, src, box, crop);
    if (layer.type === "image_slot" && layer.mask !== "none") object.metadata = { ...metadata, mask: layer.mask, cornerRadius: layer.cornerRadius ?? imageMaskRadius(box), targetBox: box, ...(crop ? { blockwiseCrop: crop } : {}) };
    return object;
  }
  const radius = layer.type === "image_slot" && layer.mask === "circle" ? Math.min(box.width, box.height) / 2 : layer.cornerRadius ?? Math.min(12, box.height / 3);
  return { ...shared, type: "rect", inputKey, metadata, width: box.width, height: box.height, rx: radius, ry: radius, fill: "#f1f2f4", stroke: "#d3d7df", strokeWidth: 2 };
}

function imageObject(shared: FabricObject, src: string, box: Rect, crop?: Rect, workspace = false): FabricObject {
  if (!src.startsWith("/")) throw new Error("Native editor assets must use same-origin Blockwise references.");
  return { ...shared, type: "image", src, crossOrigin: "anonymous", width: box.width, height: box.height, scaleX: 1, scaleY: 1, selectable: !workspace, evented: !workspace, metadata: { ...(shared.metadata ?? {}), ...(workspace ? { workspace: true } : {}), targetBox: box, ...(crop ? { blockwiseCrop: crop } : {}) } };
}

export async function hydrateFabricSceneImages(scene: FabricScene): Promise<FabricScene> {
  if (typeof Image === "undefined") return scene;
  const objects = await Promise.all(scene.objects.map(async object => {
    if (object.type !== "image" || typeof object.src !== "string") return object;
    const meta = object.metadata && typeof object.metadata === "object" ? object.metadata : {};
    const target = meta.targetBox as Rect | undefined;
    if (!target) return object;
    const source = await imageDimensions(object.src);
    const crop = meta.blockwiseCrop as Rect | undefined;
    const regionWidth = Math.max(1, (crop?.width ?? 1) * source.width), regionHeight = Math.max(1, (crop?.height ?? 1) * source.height);
    const scale = Math.max(target.width / regionWidth, target.height / regionHeight);
    const width = target.width / scale, height = target.height / scale;
    const cropX = (crop ? crop.x * source.width : 0) + (regionWidth - width) / 2;
    const cropY = (crop ? crop.y * source.height : 0) + (regionHeight - height) / 2;
    const scaleX = scale, scaleY = scale;
    const radius = typeof meta.cornerRadius === "number" ? meta.cornerRadius : 0;
    const clipPath = meta.mask === "circle" ? { type: "ellipse", originX: "center", originY: "center", left: 0, top: 0, rx: width / 2, ry: height / 2 }
      : meta.mask === "rounded_rect" ? { type: "rect", originX: "center", originY: "center", left: 0, top: 0, width, height, rx: radius / Math.max(scaleX, .001), ry: radius / Math.max(scaleY, .001) } : undefined;
    const { targetBox: _target, blockwiseCrop: _crop, ...metadata } = meta;
    return { ...object, metadata, width, height, cropX, cropY, scaleX, scaleY, clipPath };
  }));
  return { ...scene, objects };
}

function imageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = "anonymous";
    image.onload = () => resolve({ width: Math.max(1, image.naturalWidth), height: Math.max(1, image.naturalHeight) });
    image.onerror = () => reject(new Error("A template image could not be loaded. Try reopening the ad."));
    image.src = src;
  });
}

export function applyTextValuesToScenes(scenes: Pick<VueNativeEditorDocument, "feed" | "story">, values: Record<string, string>) {
  return { feed: applyText(scenes.feed, values), story: applyText(scenes.story, values) };
}
function applyText(scene: FabricScene, values: Record<string, string>): FabricScene {
  const update = (object: FabricObject): FabricObject => {
    const meta = object.metadata && typeof object.metadata === "object" ? object.metadata : null;
    const key = typeof object.inputKey === "string" ? object.inputKey : typeof meta?.inputKey === "string" ? meta.inputKey : null;
    return { ...object, ...(key && key in values && (["textbox", "text", "i-text"].includes(object.type ?? "")) ? { text: values[key] } : {}), ...(object.objects ? { objects: object.objects.map(update) } : {}) };
  };
  return { ...scene, objects: scene.objects.map(update) };
}
export function textValuesFromScenes(scenes: Pick<VueNativeEditorDocument, "feed" | "story">): Record<string, string> {
  const values: Record<string, string> = {};
  const visit = (object: FabricObject) => {
    const meta = object.metadata && typeof object.metadata === "object" ? object.metadata : null;
    const key = typeof object.inputKey === "string" ? object.inputKey : typeof meta?.inputKey === "string" ? meta.inputKey : null;
    if (key && typeof object.text === "string" && !(key in values)) values[key] = object.text;
    object.objects?.forEach(visit);
  };
  scenes.feed.objects.forEach(visit); scenes.story.objects.forEach(visit);
  return values;
}

type NativeScenes = Pick<VueNativeEditorDocument, "feed" | "story">;

function imageSlotKey(object: FabricObject): string | null {
  const meta = object.metadata;
  const key = object.inputKey ?? meta?.inputKey;
  const image = object.type === "image" || (object.type === "rect" && ["image_slot", "logo"].includes(meta?.blockwiseType));
  return image && typeof key === "string" && key ? key : null;
}

/** Only surviving, bound image slots. Deleting a layer in design view stays deleted. */
export function nativeImageSlots(scenes: NativeScenes): Array<{ key: string; src: string | null; placements: Placement[] }> {
  const slots = new Map<string, { key: string; src: string | null; placements: Placement[] }>();
  for (const placement of ["feed", "story"] as const) {
    const visit = (object: FabricObject) => {
      const key = imageSlotKey(object);
      if (key) {
        const slot = slots.get(key) ?? { key, src: null, placements: [] };
        if (!slot.src && typeof object.src === "string") slot.src = object.src;
        if (!slot.placements.includes(placement)) slot.placements.push(placement);
        slots.set(key, slot);
      }
      object.objects?.forEach(visit);
    };
    scenes[placement].objects.forEach(visit);
  }
  return [...slots.values()];
}

/**
 * Replace photo pixels, not the layout. The new crop uses the old local aspect
 * ratio; its inverse scale preserves the whole affine transform, including groups.
 */
export function replaceNativeImageInScenes(scenes: NativeScenes, key: string, src: string, source: { width: number; height: number }): NativeScenes {
  if (!src.startsWith("/") || src.startsWith("//") || /[\\\u0000-\u0020]/.test(src)) throw new Error("Choose a same-origin Blockwise image.");
  if (![source.width, source.height].every(value => Number.isFinite(value) && value > 0)) throw new Error("The photo has invalid dimensions.");
  const replace = (object: FabricObject): FabricObject => {
    if (imageSlotKey(object) !== key) return object.objects ? { ...object, objects: object.objects.map(replace) } : object;
    const oldWidth = Number(object.width), oldHeight = Number(object.height);
    if (![oldWidth, oldHeight].every(value => Number.isFinite(value) && value > 0)) throw new Error("This photo needs its size adjusted in the design tools first.");
    const fit = Math.max(oldWidth / source.width, oldHeight / source.height);
    const width = oldWidth / fit, height = oldHeight / fit;
    const ratio = 1 / fit;
    const placeholder = object.type !== "image";
    const next: FabricObject = {
      ...object, type: "image", src, crossOrigin: "anonymous", width, height,
      scaleX: (object.scaleX ?? 1) * fit, scaleY: (object.scaleY ?? 1) * fit,
      cropX: Math.max(0, (source.width - width) / 2), cropY: Math.max(0, (source.height - height) / 2),
      // Image stroke scales with its local box unless the user set strokeUniform.
      ...(!object.strokeUniform && object.strokeWidth ? { strokeWidth: object.strokeWidth * ratio } : {}),
    };
    if (object.clipPath) {
      const clip = object.clipPath;
      next.clipPath = clip.absolutePositioned ? clip : {
        ...clip, left: (clip.left ?? 0) * ratio, top: (clip.top ?? 0) * ratio,
        scaleX: (clip.scaleX ?? 1) * ratio, scaleY: (clip.scaleY ?? 1) * ratio,
      };
    } else if (placeholder && (object.rx || object.ry || object.metadata?.mask)) {
      next.clipPath = object.metadata?.mask === "circle"
        ? { type: "ellipse", originX: "center", originY: "center", left: 0, top: 0, rx: width / 2, ry: height / 2 }
        : { type: "rect", originX: "center", originY: "center", left: 0, top: 0, width, height, rx: (object.rx ?? 0) * ratio, ry: (object.ry ?? 0) * ratio };
    }
    if (placeholder) {
      delete next.rx; delete next.ry; delete next.fill;
      if (object.stroke === "#d3d7df" && object.strokeWidth === 2) { next.stroke = null; next.strokeWidth = 0; }
    }
    if (object.metadata) {
      const { targetBox: _target, blockwiseCrop: _crop, ...metadata } = object.metadata;
      next.metadata = metadata;
    }
    return next;
  };
  return {
    feed: { ...scenes.feed, objects: scenes.feed.objects.map(replace) },
    story: { ...scenes.story, objects: scenes.story.objects.map(replace) },
  };
}

function gradient(fill: any, box: Rect, colours: Record<string, string>): FabricObject {
  const angle = fill.angleDegrees * Math.PI / 180, cx = box.width / 2, cy = box.height / 2;
  const length = Math.abs(box.width * Math.cos(angle)) + Math.abs(box.height * Math.sin(angle));
  return { type: "linear", coords: { x1: cx - Math.cos(angle) * length / 2, y1: cy - Math.sin(angle) * length / 2, x2: cx + Math.cos(angle) * length / 2, y2: cy + Math.sin(angle) * length / 2 }, colorStops: fill.stops.map((stop: any) => ({ offset: stop.offset, color: rgba(colours[stop.colourRole] ?? "#000000", stop.opacity) })) };
}
function rgba(colour: string, opacity: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  return `rgba(${parseInt(colour.slice(1, 3), 16)}, ${parseInt(colour.slice(3, 5), 16)}, ${parseInt(colour.slice(5, 7), 16)}, ${Math.max(0, Math.min(1, opacity))})`;
}
