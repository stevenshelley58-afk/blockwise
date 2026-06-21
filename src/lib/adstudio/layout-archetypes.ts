import { deterministicUuid } from "./id.ts";
import { buildTemplateImageObjects } from "./image-frame.ts";
import { getCanvasSize, renderCreativeSvg } from "./renderer.ts";
import { compositionToCreative } from "./creative/composition-to-creative.ts";
import { buildPalette, fontStacks } from "./creative/preview-engine.ts";
import { compositionForTemplate } from "./creative/template-composition.ts";
import type { CreativeSkeleton } from "../ad-template-library/skeleton.ts";
import type { CompositionCopy } from "./creative/compositions.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaign,
  AdStudioCampaignVariant,
  AdStudioCanvasObject,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioGoal,
} from "./types.ts";

export type LayoutArchetypeId =
  | "listing_hero"
  | "coming_soon"
  | "open_home"
  | "just_sold"
  | "market_stat"
  | "appraisal"
  | "seller_guide"
  | "social_proof";

export type LayoutArchetypeSelectionInput = {
  templateId?: string;
  templateName?: string;
  offerId: string;
  goal: AdStudioGoal;
  angle?: string;
  headline?: string;
};

export type BuildArchetypeCreativeInput = {
  campaign: AdStudioCampaign;
  variant: AdStudioCampaignVariant;
  brandKit: AdStudioBrandKit;
  format: AdStudioFormat;
  sourceImageDataUrl?: string;
  subheadline?: string;
  templateId?: string;
  templateKey?: string;
  templateName?: string;
  creativeSkeleton?: CreativeSkeleton;
};

type CanvasSize = { width: number; height: number };

type LayoutGeometry = {
  marginX: number;
  copyX: number;
  copyY: number;
  copyWidth: number;
  headlineSize: number;
  subheadSize: number;
  ctaX: number;
  ctaWidth: number;
  ctaHeight: number;
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoHeight: number;
  scrim: string;
  supportObjects: AdStudioCanvasObject[];
};

const COMPOSITION_FORMATS = new Set<AdStudioFormat>(["4:5", "1:1", "9:16"]);
const EXTRACTED_TEMPLATE_ARCHETYPES: Record<string, LayoutArchetypeId> = {
  meta_002: "social_proof",
  meta_021: "listing_hero",
  meta_040: "listing_hero",
  meta_044: "open_home",
  meta_055: "just_sold",
  meta_094: "listing_hero",
  meta_142: "just_sold",
  meta_245: "social_proof",
  meta_259: "listing_hero",
  meta_317: "open_home",
};

export function selectLayoutArchetype(input: LayoutArchetypeSelectionInput): LayoutArchetypeId {
  const templateId = input.templateId?.toLowerCase();
  if (templateId && EXTRACTED_TEMPLATE_ARCHETYPES[templateId]) return EXTRACTED_TEMPLATE_ARCHETYPES[templateId];

  const haystack = [input.templateId, input.templateName, input.offerId, input.goal, input.angle, input.headline]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bcoming[_ -]?soon\b/.test(haystack)) return "coming_soon";
  if (/\bopen[_ -]?home\b|\binspection\b|\binspect\b/.test(haystack)) return "open_home";
  if (/\bjust[_ -]?sold\b|\bsold\b|recent[_ -]?sales/.test(haystack)) return "just_sold";
  if (/\bmarket[_ -]?update\b|\bmarket\b|\bsnapshot\b|suburb[_ -]?market[_ -]?report/.test(haystack)) return "market_stat";
  if (/\bfree[_ -]?appraisal\b|\bappraisal\b|\bprice[_ -]?update\b|\bhome[_ -]?value\b/.test(haystack)) {
    return "appraisal";
  }
  if (/\bseller[_ -]?(checklist|guide|prep|mistakes)\b|\bprelisting\b|\bpre-listing\b/.test(haystack)) {
    return "seller_guide";
  }
  if (/\bbuyer[_ -]?demand\b|\bsocial[_ -]?proof\b|\bproof\b/.test(haystack)) return "social_proof";
  if (/\bjust[_ -]?listed\b|\bnew[_ -]?to[_ -]?market\b|\blisting\b/.test(haystack)) return "listing_hero";

  if (input.goal === "appraisal_bookings") return "appraisal";
  if (input.goal === "market_update_leads") return "market_stat";
  if (input.goal === "open_home_followup") return "open_home";
  return "seller_guide";
}

export function buildArchetypeCreative(input: BuildArchetypeCreativeInput): AdStudioCreative {
  const size = getCanvasSize(input.format);
  // Multi-slot placement from the template's role-tagged image_frames. Empty when
  // the template carries no frames (e.g. the seeded templates), so both render
  // paths fall back to their existing single full-bleed placement.
  const placedImages = buildTemplateImageObjects({
    frames: input.creativeSkeleton?.composition.image_frames,
    format: input.format,
    canvasWidth: size.width,
    canvasHeight: size.height,
    primarySrc: input.sourceImageDataUrl,
    listingImages: input.brandKit.assets.listingImages,
    headshots: input.brandKit.assets.headshots,
  });
  const primaryPlaced = placedImages.find((image) => image.role === "primary_image");

  if (input.templateId && COMPOSITION_FORMATS.has(input.format)) {
    const compositionId = compositionForTemplate({
      id: input.templateId,
      templateKey: input.templateKey ?? input.templateId,
      goal: input.campaign.goal,
      offerId: input.campaign.offerId,
    });
    const primary = input.brandKit.colours?.primary ?? "#14314f";
    const accent = input.brandKit.colours?.accent ?? "#e7b24b";

    return compositionToCreative({
      compositionId,
      format: input.format,
      palette: buildPalette(primary, accent),
      stacks: fontStacks(input.brandKit.typography?.headingFont, input.brandKit.typography?.bodyFont),
      copy: compositionCopyForInput(input),
      photoSrc: primaryPlaced?.content ?? input.sourceImageDataUrl ?? null,
      // A template image_frame overrides the composition's default photo spot;
      // secondary/headshot frames are appended above the scene.
      imageFrame: primaryPlaced
        ? { x: primaryPlaced.x, y: primaryPlaced.y, width: primaryPlaced.width, height: primaryPlaced.height ?? primaryPlaced.width }
        : undefined,
      extraImageObjects: placedImages.filter((image) => image.role !== "primary_image"),
      ids: {
        creativeId: deterministicUuid(`${input.variant.variantId}:${input.format}`),
        campaignId: input.campaign.campaignId,
        variantId: input.variant.variantId,
      },
      safeZones: {
        metaStory: input.format === "9:16",
        googleDemandGen: input.format !== "1.91:1",
      },
      paletteSeed: {
        primary,
        accent,
      },
      fontSeed: {
        headingFont: input.brandKit.typography?.headingFont,
        bodyFont: input.brandKit.typography?.bodyFont,
      },
    });
  }

  const archetype = toLayoutArchetype(input.creativeSkeleton?.archetype) ?? selectLayoutArchetype({
    templateId: input.templateId,
    templateName: input.templateName,
    offerId: input.campaign.offerId,
    goal: input.campaign.goal,
    angle: input.variant.angle,
    headline: input.variant.headline,
  });
  // Decoupling (Phase 8): a template that carries image_frames derives its copy
  // geometry from the skeleton on top of the archetype-independent base, so the
  // hardcoded per-archetype recipe no longer affects its output. Legacy
  // skeleton/no-frames templates keep using the archetype recipe as the base.
  const hasFrames = (input.creativeSkeleton?.composition.image_frames?.length ?? 0) > 0;
  const archetypeGeometry = geometryForArchetype(archetype, input.format, size, input.brandKit);
  const geometry = input.creativeSkeleton
    ? geometryForSkeleton(
        input.creativeSkeleton,
        input.format,
        size,
        input.brandKit,
        hasFrames ? baseGeometry(input.format, size) : archetypeGeometry,
      )
    : archetypeGeometry;
  const subheadline = input.subheadline ?? fallbackSubheadline(archetype, input.campaign.market.suburb);
  const text = textLayout({
    headline: input.variant.headline,
    subheadline,
    cta: input.variant.cta,
    copyX: geometry.copyX,
    copyY: geometry.copyY,
    copyWidth: geometry.copyWidth,
    headlineSize: geometry.headlineSize,
    subheadSize: geometry.subheadSize,
    ctaX: geometry.ctaX,
    ctaWidth: geometry.ctaWidth,
    ctaHeight: geometry.ctaHeight,
    canvasHeight: size.height,
    format: input.format,
  });
  // Primary/secondary photos sit under the scrim for text contrast; an
  // agent_headshot cut-out sits above it so it stays clear. No frames => the
  // single full-bleed primary image (unchanged for the seeded templates).
  const belowScrimImages = placedImages.length
    ? placedImages.filter((image) => image.role !== "agent_headshot_image")
    : [primaryImageObject(size, input.sourceImageDataUrl, input.brandKit)];
  const aboveScrimImages = placedImages.filter((image) => image.role === "agent_headshot_image");
  const creativeBase: Omit<AdStudioCreative, "previewSvg"> = {
    creativeId: deterministicUuid(`${input.variant.variantId}:${input.format}`),
    campaignId: input.campaign.campaignId,
    variantId: input.variant.variantId,
    format: input.format,
    source: "template_composite",
    canvas: {
      ...size,
      backgroundAssetId: `background_${input.variant.variantId}`,
      objects: [
        backgroundObject(size, input.brandKit),
        ...belowScrimImages,
        scrimObject(size, geometry.scrim),
        ...aboveScrimImages,
        ...geometry.supportObjects,
        {
          objectId: "headline",
          type: "text",
          role: "headline",
          content: input.variant.headline,
          x: geometry.copyX,
          y: geometry.copyY,
          width: geometry.copyWidth,
          height: text.headlineHeight,
          font: "brand_heading",
          size: geometry.headlineSize,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "subhead",
          type: "text",
          role: "subheadline",
          content: subheadline,
          x: geometry.copyX,
          y: text.subheadY,
          width: text.subheadWidth,
          height: text.subheadHeight,
          font: "brand_body",
          size: geometry.subheadSize,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "cta",
          type: "shape",
          role: "cta_button",
          content: input.variant.cta,
          x: geometry.ctaX,
          y: text.ctaY,
          width: geometry.ctaWidth,
          height: geometry.ctaHeight,
          fill: input.brandKit.colours.primary,
          locked: false,
        },
        {
          objectId: "cta_text",
          type: "text",
          role: "cta_text",
          content: input.variant.cta,
          x: geometry.ctaX + Math.round(geometry.ctaWidth * 0.08),
          y: text.ctaY + Math.round(geometry.ctaHeight * 0.31),
          width: Math.round(geometry.ctaWidth * 0.84),
          height: Math.round((input.format === "1.91:1" ? 24 : 28) * 1.22),
          font: "brand_body",
          size: input.format === "1.91:1" ? 24 : 28,
          fill: "#FFFFFF",
          locked: false,
        },
        {
          objectId: "brand_logo",
          type: "logo",
          role: "brand_logo",
          content: input.brandKit.identity.tradingName || input.brandKit.identity.businessName,
          assetId: input.brandKit.logos.primaryLogoUrl ?? undefined,
          x: geometry.logoX,
          y: geometry.logoY,
          width: geometry.logoWidth,
          height: geometry.logoHeight,
          locked: true,
        },
      ],
    },
    safeZones: {
      metaStory: input.format === "9:16",
      googleDemandGen: input.format !== "1.91:1",
    },
  };

  return {
    ...creativeBase,
    previewSvg: renderCreativeSvg(creativeBase, input.brandKit),
  };
}

function compositionCopyForInput(input: BuildArchetypeCreativeInput): CompositionCopy {
  const brand = input.brandKit.identity.tradingName || input.brandKit.identity.businessName || "Your agency";
  const suburb = input.campaign.market.suburb;
  const templateName = input.templateName ?? input.variant.angle;
  return {
    brand,
    eyebrow: compositionEyebrow(templateName, input.campaign.offerId),
    headline: input.variant.headline,
    subhead: input.subheadline ?? fallbackSubheadline(selectLayoutArchetype({
      templateId: input.templateId,
      templateName: input.templateName,
      offerId: input.campaign.offerId,
      goal: input.campaign.goal,
      angle: input.variant.angle,
      headline: input.variant.headline,
    }), suburb),
    cta: input.variant.cta,
    stat: "+12.4%",
    statLabel: `${suburb} market movement`,
    features: compositionFeatures(input.campaign.offerId),
  };
}

function compositionEyebrow(templateName: string, offerId: string): string {
  if (/open/i.test(templateName) || /open_home/.test(offerId)) return "Open home";
  if (/sold/i.test(templateName) || /recent_sales/.test(offerId)) return "Recent result";
  if (/market/i.test(templateName) || /market|snapshot/.test(offerId)) return "Market update";
  if (/appraisal|price|value/i.test(templateName) || /home_value|appraisal/.test(offerId)) return "Price update";
  if (/coming/i.test(templateName)) return "Coming soon";
  return "Local guide";
}

function compositionFeatures(offerId: string): string[] {
  if (/open_home/.test(offerId)) return ["Compare the property", "Clarify your questions", "Plan the next step"];
  if (/recent_sales|market|snapshot/.test(offerId)) return ["Recent local activity", "Plain-English context", "Owner next steps"];
  if (/home_value|appraisal/.test(offerId)) return ["Current local context", "Property-specific update", "No obligation"];
  return ["Prep before photos", "Fix buyer friction", "Plan your timing"];
}

// Archetype-independent base geometry: margins, default copy block, CTA, and
// logo placement, with no support objects. Frame-carrying templates (Part A)
// build on THIS plus their own image_frames + copy_safe_zones, so removing or
// changing a per-archetype recipe below does not change their output.
function baseGeometry(format: AdStudioFormat, size: CanvasSize): LayoutGeometry {
  const isStory = format === "9:16";
  const isLandscape = format === "1.91:1";
  const marginX = Math.round(size.width * (isLandscape ? 0.07 : 0.08));
  const baseHeadlineSize = isStory ? 70 : isLandscape ? 50 : 64;

  return {
    marginX,
    copyX: marginX,
    copyY: Math.round(size.height * (isStory ? 0.53 : isLandscape ? 0.32 : 0.5)),
    copyWidth: Math.round(size.width * (isLandscape ? 0.55 : 0.76)),
    headlineSize: baseHeadlineSize,
    subheadSize: Math.max(28, Math.round(baseHeadlineSize * 0.42)),
    ctaX: marginX,
    ctaWidth: Math.min(Math.round(size.width * (isLandscape ? 0.28 : 0.36)), 360),
    ctaHeight: isLandscape ? 66 : 78,
    logoX: marginX,
    logoY: Math.round(size.height * (isLandscape ? 0.08 : 0.07)),
    logoWidth: isLandscape ? 164 : 180,
    logoHeight: isLandscape ? 58 : 64,
    scrim: "rgba(7, 14, 25, 0.48)",
    supportObjects: [],
  };
}

// The legacy per-archetype geometry recipes (scrims/panels/ribbons). Used only as
// the fallback for templates that do NOT carry image_frames.
function geometryForArchetype(
  archetype: LayoutArchetypeId,
  format: AdStudioFormat,
  size: CanvasSize,
  brandKit: AdStudioBrandKit,
): LayoutGeometry {
  const isStory = format === "9:16";
  const isLandscape = format === "1.91:1";
  const g = baseGeometry(format, size);
  const marginX = g.marginX;

  if (archetype === "coming_soon") {
    g.copyY = Math.round(size.height * (isStory ? 0.38 : isLandscape ? 0.28 : 0.36));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.5 : 0.68));
    g.scrim = "rgba(7, 14, 25, 0.54)";
    g.supportObjects.push(bandObject(size, "announcement_band", 0.12, isLandscape ? 0.18 : 0.16, brandKit.colours.accent));
  } else if (archetype === "open_home") {
    g.copyY = Math.round(size.height * (isStory ? 0.46 : isLandscape ? 0.24 : 0.42));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.47 : 0.7));
    g.scrim = "rgba(7, 14, 25, 0.44)";
    g.supportObjects.push(panelObject(size, "details_panel", marginX, g.copyY - 42, g.copyWidth + 80, isLandscape ? 250 : 430));
  } else if (archetype === "just_sold") {
    g.copyY = Math.round(size.height * (isStory ? 0.56 : isLandscape ? 0.36 : 0.53));
    g.scrim = "rgba(7, 14, 25, 0.5)";
    g.supportObjects.push(ribbonObject(size, "sold_ribbon", marginX, g.logoY + g.logoHeight + 28, brandKit.colours.primary));
  } else if (archetype === "market_stat") {
    g.copyX = isLandscape ? Math.round(size.width * 0.48) : marginX;
    g.copyY = Math.round(size.height * (isStory ? 0.47 : isLandscape ? 0.26 : 0.45));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.43 : 0.68));
    g.ctaX = g.copyX;
    g.headlineSize = isStory ? 64 : isLandscape ? 46 : 58;
    g.scrim = "rgba(7, 14, 25, 0.36)";
    g.supportObjects.push(sidePanelObject(size, "market_panel", g.copyX - 34, brandKit.colours.secondary));
  } else if (archetype === "appraisal") {
    g.copyX = isLandscape ? Math.round(size.width * 0.5) : marginX;
    g.copyY = Math.round(size.height * (isStory ? 0.51 : isLandscape ? 0.27 : 0.48));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.42 : 0.7));
    g.ctaX = g.copyX;
    g.scrim = "rgba(7, 14, 25, 0.42)";
    g.supportObjects.push(panelObject(size, "value_panel", g.copyX - 34, g.copyY - 44, g.copyWidth + 76, isLandscape ? 312 : 520));
  } else if (archetype === "seller_guide") {
    g.copyY = Math.round(size.height * (isStory ? 0.5 : isLandscape ? 0.3 : 0.47));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.52 : 0.72));
    g.scrim = "rgba(7, 14, 25, 0.46)";
    g.supportObjects.push(panelObject(size, "guide_panel", marginX - 20, g.copyY - 44, g.copyWidth + 72, isLandscape ? 300 : 500));
  } else if (archetype === "social_proof") {
    g.copyY = Math.round(size.height * (isStory ? 0.52 : isLandscape ? 0.34 : 0.49));
    g.copyWidth = Math.round(size.width * (isLandscape ? 0.5 : 0.7));
    g.headlineSize = isStory ? 64 : isLandscape ? 46 : 58;
    g.scrim = "rgba(7, 14, 25, 0.4)";
    g.supportObjects.push(panelObject(size, "proof_panel", marginX - 18, g.copyY - 50, g.copyWidth + 68, isLandscape ? 296 : 480));
  }

  return g;
}

// Map the looser CreativeSkeleton archetype (incl. agent_profile/brand) to a
// legacy LayoutArchetypeId recipe. Only used as the no-frames fallback.
function toLayoutArchetype(archetype: CreativeSkeleton["archetype"] | undefined): LayoutArchetypeId | null {
  if (!archetype) return null;
  if (archetype === "agent_profile" || archetype === "brand") return "social_proof";
  return archetype;
}

function geometryForSkeleton(
  skeleton: CreativeSkeleton,
  format: AdStudioFormat,
  size: CanvasSize,
  brandKit: AdStudioBrandKit,
  fallback: LayoutGeometry,
): LayoutGeometry {
  const primary = skeleton.composition.copy_safe_zones.find((zone) => zone.priority === "primary")
    ?? skeleton.composition.copy_safe_zones[0];
  if (!primary) return fallback;

  const isLandscape = format === "1.91:1";
  const marginX = fallback.marginX;
  const minCopyWidth = Math.min(size.width - marginX * 2, isLandscape ? 300 : 430);
  const maxCopyWidth = Math.max(minCopyWidth, size.width - marginX * 2);
  const zoneX = Math.round(primary.x * size.width);
  const zoneY = Math.round(primary.y * size.height);
  const zoneWidth = Math.round(primary.width * size.width);
  const zoneHeight = Math.round(primary.height * size.height);
  const copyX = clampNumber(zoneX, marginX, Math.max(marginX, size.width - marginX - minCopyWidth));
  const copyWidth = clampNumber(zoneWidth, minCopyWidth, Math.max(minCopyWidth, Math.min(maxCopyWidth, size.width - copyX - marginX)));
  const copyY = clampNumber(zoneY, fallback.logoY + fallback.logoHeight + 28, Math.max(fallback.logoY + fallback.logoHeight + 28, size.height - 430));
  const headlineSize = clampNumber(
    Math.round(Math.min(fallback.headlineSize, Math.max(isLandscape ? 42 : 54, zoneHeight * 0.25))),
    isLandscape ? 38 : 46,
    fallback.headlineSize,
  );
  const subheadSize = Math.max(isLandscape ? 22 : 26, Math.round(headlineSize * 0.42));
  const ctaZone = skeleton.composition.copy_safe_zones.find((zone) => zone.priority === "cta");
  const ctaX = ctaZone ? clampNumber(Math.round(ctaZone.x * size.width), marginX, size.width - marginX - fallback.ctaWidth) : copyX;
  const supportObjects = [...fallback.supportObjects];
  const panelHeight = clampNumber(zoneHeight + Math.round(size.height * 0.08), isLandscape ? 220 : 320, size.height - copyY - 48);
  const panelRole = `${skeleton.archetype}_copy_panel`;

  supportObjects.push(panelObject(size, panelRole, copyX - 26, copyY - 34, copyWidth + 64, panelHeight));

  if (/ribbon|badge|sold|coming/i.test(skeleton.text_system.badge)) {
    supportObjects.push(ribbonObject(size, `${skeleton.archetype}_badge`, marginX, Math.max(fallback.logoY + fallback.logoHeight + 24, copyY - 120), brandKit.colours.primary));
  }

  return {
    ...fallback,
    marginX,
    copyX,
    copyY,
    copyWidth,
    headlineSize,
    subheadSize,
    ctaX,
    scrim: scrimForSkeleton(skeleton),
    supportObjects,
  };
}

function scrimForSkeleton(skeleton: CreativeSkeleton): string {
  if (skeleton.color.contrast === "low") return "rgba(7, 14, 25, 0.32)";
  if (skeleton.color.contrast === "medium") return "rgba(7, 14, 25, 0.42)";
  return "rgba(7, 14, 25, 0.54)";
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function textLayout(input: {
  headline: string;
  subheadline: string;
  cta: string;
  copyX: number;
  copyY: number;
  copyWidth: number;
  headlineSize: number;
  subheadSize: number;
  ctaX: number;
  ctaWidth: number;
  ctaHeight: number;
  canvasHeight: number;
  format: AdStudioFormat;
}) {
  const subheadWidth = Math.round(input.copyWidth * 0.9);
  const headlineLineHeight = Math.round(input.headlineSize * 1.08);
  const subheadLineHeight = Math.round(input.subheadSize * 1.22);
  const headlineLines = estimateWrappedLineCount(input.headline, input.copyWidth, input.headlineSize, 0.56);
  const headlineHeight = headlineLines * headlineLineHeight;
  const subheadY = input.copyY + headlineHeight + Math.round(input.headlineSize * 0.34);
  const subheadLines = estimateWrappedLineCount(input.subheadline, subheadWidth, input.subheadSize, 0.5);
  const subheadHeight = subheadLines * subheadLineHeight;
  const textBlockBottom = subheadY + subheadHeight;
  const isStory = input.format === "9:16";
  const isLandscape = input.format === "1.91:1";
  const baseCtaY = Math.round(input.canvasHeight * (isStory ? 0.76 : isLandscape ? 0.66 : 0.73));
  const maxCtaY = input.canvasHeight - Math.round(input.canvasHeight * (isStory ? 0.18 : 0.08)) - input.ctaHeight;
  const ctaY = Math.min(
    maxCtaY,
    Math.max(baseCtaY, textBlockBottom + Math.round(input.subheadSize * 1.25)),
  );

  return {
    headlineHeight,
    subheadY,
    subheadWidth,
    subheadHeight,
    ctaY,
  };
}

function backgroundObject(size: CanvasSize, brandKit: AdStudioBrandKit): AdStudioCanvasObject {
  return {
    objectId: "background",
    type: "shape",
    role: "background_shape",
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    fill: brandKit.colours.secondary,
    locked: true,
  };
}

function primaryImageObject(
  size: CanvasSize,
  sourceImageDataUrl: string | undefined,
  brandKit: AdStudioBrandKit,
): AdStudioCanvasObject {
  return {
    objectId: "primary_image",
    type: "image",
    role: "primary_image",
    content: sourceImageDataUrl,
    assetId: sourceImageDataUrl ? undefined : brandKit.assets.listingImages[0] ?? brandKit.assets.headshots[0] ?? undefined,
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    locked: false,
  };
}

function scrimObject(size: CanvasSize, fill: string): AdStudioCanvasObject {
  return {
    objectId: "image_scrim",
    type: "shape",
    role: "image_scrim",
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    fill,
    locked: true,
  };
}

function bandObject(size: CanvasSize, role: string, yRatio: number, heightRatio: number, fill: string): AdStudioCanvasObject {
  return {
    objectId: role,
    type: "shape",
    role,
    x: 0,
    y: Math.round(size.height * yRatio),
    width: size.width,
    height: Math.round(size.height * heightRatio),
    fill,
    locked: true,
  };
}

function panelObject(size: CanvasSize, role: string, x: number, y: number, width: number, height: number): AdStudioCanvasObject {
  return {
    objectId: role,
    type: "shape",
    role,
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(width, size.width - Math.max(0, x)),
    height: Math.min(height, size.height - Math.max(0, y)),
    fill: "rgba(8, 15, 28, 0.66)",
    locked: true,
  };
}

function sidePanelObject(size: CanvasSize, role: string, x: number, fill: string): AdStudioCanvasObject {
  return {
    objectId: role,
    type: "shape",
    role,
    x: Math.max(0, x),
    y: 0,
    width: size.width - Math.max(0, x),
    height: size.height,
    fill,
    locked: true,
  };
}

function ribbonObject(size: CanvasSize, role: string, x: number, y: number, fill: string): AdStudioCanvasObject {
  return {
    objectId: role,
    type: "shape",
    role,
    x,
    y,
    width: Math.min(Math.round(size.width * 0.36), 320),
    height: Math.round(size.height * 0.055),
    fill,
    locked: true,
  };
}

function fallbackSubheadline(archetype: LayoutArchetypeId, suburb: string): string {
  if (archetype === "open_home") return "Inspect with clearer next steps.";
  if (archetype === "just_sold") return "Recent local sales context before you make plans.";
  if (archetype === "market_stat") return `A plain-English ${suburb} market update.`;
  if (archetype === "appraisal") return "A practical local price update.";
  if (archetype === "coming_soon") return "Local context before the campaign launches.";
  if (archetype === "social_proof") return "Local enquiry context without the hype.";
  if (archetype === "listing_hero") return "A fresh local listing to watch.";
  return `Download the ${suburb} seller prep checklist.`;
}

export function estimateLayoutWrappedLineCount(
  text: string,
  maxWidth: number,
  fontSize: number,
  widthFactor: number,
): number {
  return estimateWrappedLineCount(text, maxWidth, fontSize, widthFactor);
}

function estimateWrappedLineCount(text: string, maxWidth: number, fontSize: number, widthFactor: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  const spaceWidth = fontSize * 0.3;
  let lines = 1;
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = Math.max(fontSize, word.length * fontSize * widthFactor);
    if (currentWidth === 0) {
      currentWidth = wordWidth;
      continue;
    }

    const nextWidth = currentWidth + spaceWidth + wordWidth;
    if (nextWidth <= maxWidth) {
      currentWidth = nextWidth;
    } else {
      lines += 1;
      currentWidth = wordWidth;
    }
  }

  return lines;
}
