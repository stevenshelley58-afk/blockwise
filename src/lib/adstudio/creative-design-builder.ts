import {
  BLOCKWISE_FABRIC_META_KEY,
  type CreativeCopyFields,
  type CreativeDesignJson,
  type CreativeDesignObjectJson,
  metadataForObject,
} from "./creative-design-json.ts";
import { clampTemplateText } from "./template-text-fit.ts";
import type { AdStudioBrandKit, AdStudioCanvasObject, AdStudioCreative } from "./types.ts";

export function buildCreativeDesignJson(input: {
  creative: AdStudioCreative;
  brandKit: AdStudioBrandKit;
  copy: CreativeCopyFields;
  imageSrc: string;
}): CreativeDesignJson {
  const objects = input.creative.canvas.objects.map((object) =>
    objectToDesignJson(object, input.brandKit, input.copy, input.imageSrc),
  );

  return {
    version: "blockwise-fabric-v1",
    width: input.creative.canvas.width,
    height: input.creative.canvas.height,
    objects,
  };
}

export function objectToDesignJson(
  object: AdStudioCanvasObject,
  brandKit: AdStudioBrandKit,
  copy: CreativeCopyFields,
  imageSrc: string,
): CreativeDesignObjectJson {
  const meta = metadataForObject(object);
  const base = {
    left: object.x,
    top: object.y,
    width: object.width,
    height: object.height ?? defaultObjectHeight(object),
    fill: object.fill,
    clip: object.clip,
    templateCopyField: object.templateCopyField,
    templateMaxChars: object.templateMaxChars,
    templateMaxLines: object.templateMaxLines,
    editorLabel: object.editorLabel,
    guidance: object.guidance,
    selectable: !object.locked,
    evented: !object.locked,
    hasControls: !object.locked,
    lockMovementX: object.locked,
    lockMovementY: object.locked,
    lockScalingX: object.locked,
    lockScalingY: object.locked,
    lockRotation: object.locked,
    [BLOCKWISE_FABRIC_META_KEY]: meta,
  } satisfies CreativeDesignObjectJson;

  if (object.type === "text") {
    return {
      ...base,
      type: "Textbox",
      text: textForRole(object, copy),
      fontFamily: fontFamilyForObject(object, brandKit),
      fontSize: object.size ?? 36,
      fontWeight: object.role === "headline" ? 800 : 600,
      lineHeight: object.role === "headline" ? 1.08 : 1.22,
      fill: object.fill ?? brandKit.colours.text,
      editable: !object.locked,
    };
  }

  if (object.type === "image") {
    return {
      ...base,
      type: "FabricImage",
      src: object.role === "primary_image" ? imageSrc : object.content,
    };
  }

  if (object.type === "logo") {
    return {
      ...base,
      type: "Rect",
      rx: 12,
      ry: 12,
      fill: brandKit.colours.text,
      src: object.assetId ?? brandKit.logos.primaryLogoUrl ?? undefined,
      text: object.content ?? brandKit.identity.tradingName ?? brandKit.identity.businessName,
    };
  }

  return {
    ...base,
    type: "Rect",
    rx: object.role === "cta_button" ? 16 : 0,
    ry: object.role === "cta_button" ? 16 : 0,
    fill: object.fill ?? brandKit.colours.secondary,
  };
}

function textForRole(object: AdStudioCanvasObject, copy: CreativeCopyFields): string {
  const text =
    object.templateCopyField === "headline" || object.role === "headline"
      ? copy.headline
      : object.templateCopyField === "description" || object.role === "subheadline" || object.role === "body" || object.role === "subhead"
        ? copy.description
        : object.templateCopyField === "cta" || object.role === "cta_text" || object.role === "cta"
          ? copy.cta
          : object.content ?? "";
  return clampTemplateText({
    text,
    maxChars: object.templateMaxChars,
    maxLines: object.templateMaxLines,
    width: object.width,
    fontSize: object.size,
  });
}

function fontFamilyForObject(object: AdStudioCanvasObject, brandKit: AdStudioBrandKit): string {
  if (object.font === "brand_heading") {
    return brandKit.typography.headingFont || fallbackFont(brandKit.typography.fallbackHeading);
  }
  return brandKit.typography.bodyFont || fallbackFont(brandKit.typography.fallbackBody);
}

function fallbackFont(value: "serif" | "sans-serif"): string {
  return value === "serif" ? "Georgia" : "Inter";
}

function defaultObjectHeight(object: AdStudioCanvasObject): number {
  if (object.type === "logo") return Math.round(object.width * 0.36);
  if (object.type === "text") return Math.round((object.size ?? 32) * 1.4);
  return object.width;
}
