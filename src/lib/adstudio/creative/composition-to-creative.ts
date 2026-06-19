import { buildComposition, type CompositionCopy, type CompositionId } from "./compositions.ts";
import {
  fontStacks,
  renderScene,
  wrapText,
  type Element,
  type FontKind,
  type FontStacks,
  type Palette,
  type PhotoEl,
  type RectEl,
  type TextEl,
} from "./preview-engine.ts";
import { svgDataUrl } from "./svg-data-url.ts";
import { getCanvasSize } from "../renderer.ts";
import type { AdStudioCanvasObject, AdStudioCreative, AdStudioFormat } from "../types.ts";

type EditableRole = "headline" | "subheadline" | "cta_button" | "cta_text" | "primary_image" | "brand";

export type CompositionCreativeInput = {
  compositionId: CompositionId;
  format: AdStudioFormat;
  palette: Palette;
  stacks: FontStacks;
  copy: CompositionCopy;
  photoSrc?: string | null;
  ids: {
    creativeId: string;
    campaignId: string;
    variantId: string;
  };
  safeZones: AdStudioCreative["safeZones"];
  paletteSeed: {
    primary: string;
    accent: string;
  };
  fontSeed?: {
    headingFont?: string | null;
    bodyFont?: string | null;
  };
};

export type SplitSceneResult = {
  belowPhoto: Element[];
  photoEl: PhotoEl | null;
  abovePhoto: Element[];
  editable: Element[];
};

export function splitScene(scene: { elements: Element[] }, copy?: CompositionCopy): SplitSceneResult {
  const photoIndex = scene.elements.findIndex((element) => element.kind === "photo");
  const fallbackPhoto = photoIndex >= 0 ? scene.elements[photoIndex] as PhotoEl : null;
  const belowPhoto: Element[] = [];
  const abovePhoto: Element[] = [];
  const editable: Element[] = [];

  scene.elements.forEach((element, index) => {
    const role = editableRoleForElement(element, copy, element === fallbackPhoto);
    if (role) {
      editable.push(element);
      return;
    }
    if (photoIndex < 0 || index < photoIndex) {
      belowPhoto.push(element);
    } else if (index > photoIndex) {
      abovePhoto.push(element);
    }
  });

  return {
    belowPhoto,
    photoEl: fallbackPhoto,
    abovePhoto,
    editable,
  };
}

export function compositionToCreative(input: CompositionCreativeInput): AdStudioCreative {
  const size = getCanvasSize(input.format);
  const scene = buildComposition(input.compositionId, {
    width: size.width,
    height: size.height,
    palette: input.palette,
    stacks: input.stacks,
    copy: input.copy,
    photo: input.photoSrc ?? null,
  });
  const { belowPhoto, abovePhoto, editable } = splitScene(scene, input.copy);
  const objects: AdStudioCanvasObject[] = [
    {
      objectId: "bg_below",
      type: "image",
      role: "background_below",
      content: svgDataUrl(renderScene({ width: size.width, height: size.height, elements: belowPhoto }, input.stacks)),
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      locked: true,
    },
  ];

  let ctaButton: AdStudioCanvasObject | null = null;
  let ctaText: AdStudioCanvasObject | null = null;
  let brand: AdStudioCanvasObject | null = null;
  const copyObjects: AdStudioCanvasObject[] = [];

  for (const element of editable) {
    const role = editableRoleForElement(element, input.copy, element.kind === "photo");
    if (!role) continue;
    if (role === "primary_image" && element.kind === "photo") {
      objects.push(photoObject(element, input.photoSrc));
    } else if (role === "cta_button" && element.kind === "rect") {
      ctaButton = rectObject(element, "cta", "cta_button", input.copy.cta);
    } else if (role === "cta_text" && element.kind === "text") {
      ctaText = textObject(element, "cta_text", "cta_text", input.copy.cta);
    } else if (role === "brand" && element.kind === "text") {
      brand = textObject(element, "brand_logo", "brand_logo", input.copy.brand, true);
    } else if (role === "headline" && element.kind === "text") {
      copyObjects.push(textObject(element, "headline", "headline", input.copy.headline));
    } else if (role === "subheadline" && element.kind === "text") {
      copyObjects.push(textObject(element, "subhead", "subheadline", input.copy.subhead));
    }
  }

  if (abovePhoto.length) {
    objects.push({
      objectId: "bg_above",
      type: "image",
      role: "background_above",
      content: svgDataUrl(renderScene({ width: size.width, height: size.height, elements: abovePhoto }, input.stacks)),
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      locked: true,
    });
  }

  objects.push(...copyObjects);
  if (ctaButton) objects.push(ctaButton);
  if (ctaText) objects.push(ctaText);
  if (brand) objects.push(brand);

  const creative: AdStudioCreative = {
    creativeId: input.ids.creativeId,
    campaignId: input.ids.campaignId,
    variantId: input.ids.variantId,
    format: input.format,
    canvas: {
      ...size,
      backgroundAssetId: null,
      objects,
      composition: {
        id: input.compositionId,
        copy: input.copy,
        paletteSeed: input.paletteSeed,
        fontSeed: input.fontSeed,
      },
    },
    safeZones: input.safeZones,
    previewSvg: renderScene(scene, input.stacks),
  };

  return creative;
}

export function renderCompositionCreativeSvg(creative: AdStudioCreative): string {
  const stacks = fontStacks(
    creative.canvas.composition?.fontSeed?.headingFont,
    creative.canvas.composition?.fontSeed?.bodyFont,
  );
  const defs: string[] = [];
  const nodes = creative.canvas.objects
    .filter((object) => object.type !== "safe_zone")
    .map((object) => renderCanvasObject(object, stacks, defs))
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${creative.canvas.width}" height="${creative.canvas.height}" viewBox="0 0 ${creative.canvas.width} ${creative.canvas.height}"><defs>${defs.join("")}</defs>${nodes}</svg>`;
}

function editableRoleForElement(element: Element, copy: CompositionCopy | undefined, isFallbackPhoto: boolean): EditableRole | null {
  if (element.kind === "photo") {
    return element.role === "primary_image" || isFallbackPhoto ? "primary_image" : null;
  }
  if (element.kind === "rect" && element.role === "cta_button") return "cta_button";
  if (element.kind !== "text") return null;

  if (element.role === "headline" || element.role === "subheadline" || element.role === "cta_text" || element.role === "brand") {
    return element.role;
  }
  if (element.role === "cta") return "cta_text";
  if (!copy) return null;
  if (sameText(element.text, copy.headline)) return "headline";
  if (sameText(element.text, copy.subhead)) return "subheadline";
  if (sameText(element.text, copy.cta)) return "cta_text";
  if (sameText(element.text, copy.brand)) return "brand";
  return null;
}

function photoObject(element: PhotoEl, photoSrc: string | null | undefined): AdStudioCanvasObject {
  return {
    objectId: "primary_image",
    type: "image",
    role: "primary_image",
    content: photoSrc ?? undefined,
    clip: element.clip ?? "rect",
    x: Math.round(element.x),
    y: Math.round(element.y),
    width: Math.round(element.w),
    height: Math.round(element.h),
    locked: false,
  };
}

function rectObject(element: RectEl, objectId: string, role: string, content?: string): AdStudioCanvasObject {
  return {
    objectId,
    type: "shape",
    role,
    content,
    x: Math.round(element.x),
    y: Math.round(element.y),
    width: Math.round(element.w),
    height: Math.round(element.h),
    fill: element.fill,
    locked: false,
  };
}

function textObject(element: TextEl, objectId: string, role: string, content: string, locked = false): AdStudioCanvasObject {
  return {
    objectId,
    type: "text",
    role,
    content,
    x: Math.round(element.x),
    y: Math.round(element.y),
    width: Math.round(element.w),
    height: Math.round(element.h),
    font: element.font === "serif" || element.font === "display" ? "brand_heading" : "brand_body",
    size: Math.round(element.size),
    fill: element.fill,
    locked,
  };
}

function renderCanvasObject(object: AdStudioCanvasObject, stacks: FontStacks, defs: string[]): string {
  if (object.type === "image") {
    const src = object.content ?? object.assetId;
    if (!src) {
      return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="18" fill="#d9e7e3"/>`;
    }
    const clip = clipDef(object, defs);
    return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid slice"${clip}/>`;
  }

  if (object.type === "text" || object.type === "logo") {
    const fontSize = object.size ?? 32;
    const fontKind = fontKindForObject(object);
    const family = fontKind === "display" ? stacks.display : object.font === "brand_heading" ? stacks.serif : stacks.sans;
    const lines = wrapText(object.content ?? "", object.width, fontSize, fontKind, object.role === "headline" ? 4 : 3);
    const lineHeight = Math.round(fontSize * (object.role === "headline" ? 1.08 : 1.22));
    const y0 = object.y + Math.round(fontSize * 0.82);
    const weight = object.role === "headline" ? 800 : 600;
    return `<text font-family="${escapeXml(family)}" font-size="${fontSize}" font-weight="${weight}" fill="${escapeXml(object.fill ?? "#10151f")}">${lines
      .map((line, index) => `<tspan x="${object.x}" y="${y0 + index * lineHeight}">${escapeXml(line)}</tspan>`)
      .join("")}</text>`;
  }

  return `<rect x="${object.x}" y="${object.y}" width="${object.width}" height="${object.height ?? object.width}" rx="${object.role === "cta_button" ? Math.round((object.height ?? 80) / 2) : 18}" fill="${escapeXml(object.fill ?? "#123e75")}"/>`;
}

function clipDef(object: AdStudioCanvasObject, defs: string[]): string {
  const clip = object.clip ?? "rect";
  if (clip === "rect") return "";
  const height = object.height ?? object.width;
  const id = `clip_${object.objectId.replace(/[^a-z0-9_-]/gi, "_")}_${defs.length}`;
  if (clip === "circle") {
    defs.push(`<clipPath id="${id}"><circle cx="${object.x + object.width / 2}" cy="${object.y + height / 2}" r="${Math.min(object.width, height) / 2}"/></clipPath>`);
  } else {
    const r = object.width / 2;
    defs.push(`<clipPath id="${id}"><path d="M${object.x} ${object.y + height} V${object.y + r} A${r} ${r} 0 0 1 ${object.x + object.width} ${object.y + r} V${object.y + height} Z"/></clipPath>`);
  }
  return ` clip-path="url(#${id})"`;
}

function fontKindForObject(object: AdStudioCanvasObject): FontKind {
  if (object.role === "headline") return "serif";
  if (object.role === "brand_logo") return "sans";
  return "sans";
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
