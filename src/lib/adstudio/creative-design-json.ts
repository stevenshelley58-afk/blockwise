import { renderCreativeSvg } from "./renderer.ts";
import type { AdStudioCanvasObject, AdStudioCreative } from "./types.ts";

export const BLOCKWISE_FABRIC_META_KEY = "blockwise";

export const FABRIC_JSON_EXTRA_KEYS = [
  BLOCKWISE_FABRIC_META_KEY,
  "selectable",
  "evented",
  "editable",
  "lockMovementX",
  "lockMovementY",
  "lockScalingX",
  "lockScalingY",
  "lockRotation",
  "hasControls",
  "excludeFromExport",
] as const;

export type CreativeLayerEditableKind = "template" | "headline" | "description" | "cta" | "image" | "logo";

export type CreativeLayerMeta = {
  objectId: string;
  role: string;
  type: AdStudioCanvasObject["type"];
  locked: boolean;
  editableKind: CreativeLayerEditableKind;
};

export type CreativeDesignObjectJson = Record<string, unknown> & {
  type?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  text?: string;
  src?: string;
  fill?: string;
  fontSize?: number;
  [BLOCKWISE_FABRIC_META_KEY]?: CreativeLayerMeta;
};

export type CreativeDesignJson = Record<string, unknown> & {
  version: "blockwise-fabric-v1";
  width: number;
  height: number;
  objects: CreativeDesignObjectJson[];
};

export type CreativeCopyFields = {
  headline: string;
  description: string;
  cta: string;
};

export type CreativeLayerPatch = {
  content?: string;
  imageSrc?: string;
  assetId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  size?: number;
};

export function getCreativeDesignJson(creative: AdStudioCreative): CreativeDesignJson | null {
  const value = creative.canvas.fabricJson;
  if (!value || typeof value !== "object") return null;
  if ((value as CreativeDesignJson).version !== "blockwise-fabric-v1") return null;
  if (!Array.isArray((value as CreativeDesignJson).objects)) return null;
  return value as CreativeDesignJson;
}

export function editableKindForObject(object: Pick<AdStudioCanvasObject, "role" | "type">): CreativeLayerEditableKind {
  if (object.role === "headline") return "headline";
  if (object.role === "subheadline") return "description";
  if (object.role === "cta_text" || object.role === "cta_button") return "cta";
  if (object.type === "image" || object.role === "primary_image") return "image";
  if (object.type === "logo") return "logo";
  return "template";
}

export function metadataForObject(object: AdStudioCanvasObject): CreativeLayerMeta {
  return {
    objectId: object.objectId,
    role: object.role,
    type: object.type,
    locked: object.locked,
    editableKind: editableKindForObject(object),
  };
}

export function syncCreativeWithCopyAndImage(
  creative: AdStudioCreative,
  copy: CreativeCopyFields,
  imageSrc: string,
): AdStudioCreative {
  const objects = creative.canvas.objects.map((object) => syncObjectWithCopyAndImage(object, copy, imageSrc));
  const designJson = getCreativeDesignJson(creative);
  const next = {
    ...creative,
    canvas: {
      ...creative.canvas,
      objects,
      fabricJson: designJson ? syncDesignJsonWithCopyAndImage(designJson, copy, imageSrc) : creative.canvas.fabricJson,
    },
  };
  return {
    ...next,
    previewSvg: renderCreativeSvg(next),
  };
}

function syncDesignJsonWithCopyAndImage(
  designJson: CreativeDesignJson,
  copy: CreativeCopyFields,
  imageSrc: string,
): CreativeDesignJson {
  return {
    ...designJson,
    objects: designJson.objects.map((object) => {
      const meta = object[BLOCKWISE_FABRIC_META_KEY];
      if (!meta) return object;
      if (meta.role === "headline") return { ...object, text: copy.headline };
      if (meta.role === "subheadline") return { ...object, text: copy.description };
      if (meta.role === "cta_text" || meta.role === "cta_button") return { ...object, text: copy.cta };
      if (meta.role === "primary_image") return { ...object, src: imageSrc };
      return object;
    }),
  };
}

export function saveCreativeDesignJson(creative: AdStudioCreative, designJson: CreativeDesignJson): AdStudioCreative {
  const objects = objectsFromDesignJson(creative.canvas.objects, designJson);
  const next = {
    ...creative,
    canvas: {
      ...creative.canvas,
      fabricJson: designJson,
      objects,
    },
  };
  return {
    ...next,
    previewSvg: renderCreativeSvg(next),
  };
}

export function applySelectedLayerPatch(
  creative: AdStudioCreative,
  objectId: string,
  patch: CreativeLayerPatch,
): AdStudioCreative {
  const objects = creative.canvas.objects.map((object) => {
    if (object.objectId !== objectId) return object;
    return patchCanvasObject(object, patch);
  });
  const designJson = getCreativeDesignJson(creative);
  const nextDesign = designJson
    ? {
        ...designJson,
        objects: designJson.objects.map((object) => {
          const meta = object[BLOCKWISE_FABRIC_META_KEY];
          if (meta?.objectId !== objectId) return object;
          return patchDesignObject(object, patch);
        }),
      }
    : creative.canvas.fabricJson;
  const next = {
    ...creative,
    canvas: {
      ...creative.canvas,
      objects,
      fabricJson: nextDesign,
    },
  };
  return {
    ...next,
    previewSvg: renderCreativeSvg(next),
  };
}

function syncObjectWithCopyAndImage(
  object: AdStudioCanvasObject,
  copy: CreativeCopyFields,
  imageSrc: string,
): AdStudioCanvasObject {
  if (object.role === "headline") {
    return { ...object, content: copy.headline };
  }
  if (object.role === "subheadline") {
    return { ...object, content: copy.description };
  }
  if (object.role === "cta_text" || object.role === "cta_button") {
    return { ...object, content: copy.cta };
  }
  if (object.role === "primary_image") {
    return { ...object, content: imageSrc, assetId: undefined };
  }
  return object;
}

function objectsFromDesignJson(
  fallbackObjects: AdStudioCanvasObject[],
  designJson: CreativeDesignJson,
): AdStudioCanvasObject[] {
  const byId = new Map(fallbackObjects.map((object) => [object.objectId, object]));
  const nextObjects: AdStudioCanvasObject[] = [];

  for (const object of designJson.objects) {
    const meta = object[BLOCKWISE_FABRIC_META_KEY];
    if (!meta) continue;
    const fallback = byId.get(meta.objectId);
    if (!fallback) continue;
    nextObjects.push(objectFromDesignObject(fallback, object, meta));
  }

  for (const fallback of fallbackObjects) {
    if (!nextObjects.some((object) => object.objectId === fallback.objectId)) {
      nextObjects.push(fallback);
    }
  }

  return nextObjects;
}

function objectFromDesignObject(
  fallback: AdStudioCanvasObject,
  object: CreativeDesignObjectJson,
  meta: CreativeLayerMeta,
): AdStudioCanvasObject {
  const scaleX = numberOr(object.scaleX, 1);
  const scaleY = numberOr(object.scaleY, 1);
  const width = Math.round(numberOr(object.width, fallback.width) * scaleX);
  const heightSource = object.height === undefined ? fallback.height : numberOr(object.height, fallback.height ?? fallback.width);
  const height = heightSource === undefined ? undefined : Math.round(heightSource * scaleY);
  const next: AdStudioCanvasObject = {
    ...fallback,
    type: meta.type,
    role: meta.role,
    x: Math.round(numberOr(object.left, fallback.x)),
    y: Math.round(numberOr(object.top, fallback.y)),
    width,
    height,
    fill: typeof object.fill === "string" ? object.fill : fallback.fill,
    locked: meta.locked,
  };

  if (next.type === "text") {
    next.content = typeof object.text === "string" ? object.text : fallback.content;
    next.size = Math.round(numberOr(object.fontSize, fallback.size ?? 32));
  } else if (next.type === "image") {
    next.content = typeof object.src === "string" ? object.src : fallback.content;
  } else if (next.type === "logo") {
    next.assetId = typeof object.src === "string" ? object.src : fallback.assetId;
    next.content = typeof object.text === "string" ? object.text : fallback.content;
  } else if (next.type === "shape" && meta.editableKind === "cta") {
    next.content = typeof object.text === "string" ? object.text : fallback.content;
  }

  return next;
}

function patchCanvasObject(object: AdStudioCanvasObject, patch: CreativeLayerPatch): AdStudioCanvasObject {
  return {
    ...object,
    content: patch.content ?? patch.imageSrc ?? object.content,
    assetId: patch.assetId ?? object.assetId,
    x: patch.x ?? object.x,
    y: patch.y ?? object.y,
    width: patch.width ?? object.width,
    height: patch.height ?? object.height,
    fill: patch.fill ?? object.fill,
    size: patch.size ?? object.size,
  };
}

function patchDesignObject(object: CreativeDesignObjectJson, patch: CreativeLayerPatch): CreativeDesignObjectJson {
  return {
    ...object,
    text: patch.content ?? object.text,
    src: patch.imageSrc ?? object.src,
    left: patch.x ?? object.left,
    top: patch.y ?? object.top,
    width: patch.width ?? object.width,
    height: patch.height ?? object.height,
    fill: patch.fill ?? object.fill,
    fontSize: patch.size ?? object.fontSize,
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
