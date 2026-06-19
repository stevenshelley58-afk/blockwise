import { buildPalette, fontStacks } from "./preview-engine.ts";
import { compositionToCreative, renderCompositionCreativeSvg } from "./composition-to-creative.ts";
import type { CompositionCopy, CompositionId } from "./compositions.ts";
import type { CreativeCopyFields } from "../creative-design-json.ts";
import type { AdStudioCanvasObject, AdStudioCreative } from "../types.ts";

type CompositionSyncPatch = {
  copy?: Partial<CreativeCopyFields & Pick<CompositionCopy, "brand" | "eyebrow" | "subhead" | "stat" | "statLabel" | "features">>;
  photoSrc?: string | null;
  paletteSeed?: {
    primary: string;
    accent: string;
  };
};

const EDITABLE_ROLES = new Set(["headline", "subheadline", "cta_button", "cta_text", "primary_image", "brand_logo"]);

export function reRenderCompositionCreative(creative: AdStudioCreative, patch: CompositionSyncPatch): AdStudioCreative {
  const composition = creative.canvas.composition;
  if (!composition) return creative;

  const nextCopy: CompositionCopy = {
    ...composition.copy,
    brand: patch.copy?.brand ?? composition.copy.brand,
    eyebrow: patch.copy?.eyebrow ?? composition.copy.eyebrow,
    headline: patch.copy?.headline ?? composition.copy.headline,
    subhead: patch.copy?.description ?? patch.copy?.subhead ?? composition.copy.subhead,
    cta: patch.copy?.cta ?? composition.copy.cta,
    stat: patch.copy?.stat ?? composition.copy.stat,
    statLabel: patch.copy?.statLabel ?? composition.copy.statLabel,
    features: patch.copy?.features ?? composition.copy.features,
  };
  const paletteSeed = patch.paletteSeed ?? composition.paletteSeed;
  const imageSource = patch.photoSrc ?? primaryImageSource(creative);
  const rebuilt = compositionToCreative({
    compositionId: composition.id as CompositionId,
    format: creative.format,
    palette: buildPalette(paletteSeed.primary, paletteSeed.accent),
    stacks: fontStacks(composition.fontSeed?.headingFont, composition.fontSeed?.bodyFont),
    copy: nextCopy,
    photoSrc: imageSource,
    ids: {
      creativeId: creative.creativeId,
      campaignId: creative.campaignId,
      variantId: creative.variantId,
    },
    safeZones: creative.safeZones,
    paletteSeed,
    fontSeed: composition.fontSeed,
  });
  const objects = preserveEditableObjectOverrides(creative.canvas.objects, rebuilt.canvas.objects);
  const next: AdStudioCreative = {
    ...rebuilt,
    canvas: {
      ...rebuilt.canvas,
      objects,
      fabricJson: null,
    },
  };

  return {
    ...next,
    previewSvg: renderCompositionCreativeSvg(next),
  };
}

export function renderCreativeWithCompositionFallback(creative: AdStudioCreative): string {
  return creative.canvas.composition ? renderCompositionCreativeSvg(creative) : creative.previewSvg;
}

function preserveEditableObjectOverrides(
  previous: AdStudioCanvasObject[],
  next: AdStudioCanvasObject[],
): AdStudioCanvasObject[] {
  const previousByRole = new Map(previous.map((object) => [object.role, object]));

  return next.map((object) => {
    if (!EDITABLE_ROLES.has(object.role)) return object;
    const prior = previousByRole.get(object.role);
    if (!prior) return object;
    return {
      ...object,
      x: prior.x,
      y: prior.y,
      width: prior.width,
      height: prior.height,
      fill: prior.fill ?? object.fill,
      size: prior.size ?? object.size,
    };
  });
}

function primaryImageSource(creative: AdStudioCreative): string | null {
  const image = creative.canvas.objects.find((object) => object.role === "primary_image");
  return image?.content ?? image?.assetId ?? null;
}
