import type { CreativeDesignJson } from "./creative-design-json.ts";
import type { AdStudioCanvasObject, AdStudioFormat, AdStudioGoal, MetaLeadAdPack } from "./types.ts";
import { RAW_ADSTUDIO_GALLERY_TEMPLATES } from "./template-gallery/index.ts";

export const ADSTUDIO_TEMPLATE_RESET_MESSAGE =
  "AdStudio templates have been hard-reset. No templates are installed until fresh self-contained templates are built.";

export type AdStudioTemplateSampleCopy = {
  headline: string;
  primaryText: string;
  description?: string;
  cta: string;
};

export type AdStudioTemplate = {
  id: string;
  templateKey?: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
  source?: "builtin" | "operator" | "radar";
  status?: "approved" | "archived" | "draft";
  sampleCopy?: AdStudioTemplateSampleCopy;
  placement?: AdStudioTemplatePlacement;
  format?: AdStudioFormat;
  dimensions?: {
    width: number;
    height: number;
  };
  audienceIntent?: string;
  category?: string;
  tags?: string[];
  gallery?: AdStudioTemplateGalleryPreview;
  editableImage?: AdStudioTemplateEditableImage;
  editableText?: AdStudioTemplateEditableText;
  canvas?: AdStudioTemplateCanvas;
  meta?: AdStudioTemplateMeta;
  sourceAd?: AdStudioTemplateSourceAd;
  classification?: AdStudioTemplateClassification;
};

export type AdStudioTemplatePlacement = "meta_feed" | "meta_fullscreen";

export type AdStudioTemplateGalleryPreview = {
  thumbnailSrc: string;
  sampleImageSrc: string;
  alt: string;
};

export type AdStudioTemplateEditableImage = {
  src: string;
  role: "property" | "agent_headshot" | "lifestyle" | "market";
  required: boolean;
  crop: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  anchor: NonNullable<AdStudioCanvasObject["imageAnchor"]>;
};

export type AdStudioTemplateEditableText = {
  primaryText: string;
  headline: string;
  description: string;
  ctaLabel: string;
  cta: MetaLeadAdPack["cta"];
};

export type AdStudioTemplateCanvas = {
  width: number;
  height: number;
  backgroundAssetId: null;
  objects: AdStudioCanvasObject[];
  fabricJson: CreativeDesignJson;
};

export type AdStudioTemplateMeta = MetaLeadAdPack & {
  objective: "OUTCOME_LEADS";
  publisherPlatforms: ["facebook", "instagram"];
  facebookPositions: string[];
  instagramPositions: string[];
};

export type AdStudioTemplateSourceAd = { creativeId?: string; file?: string; metaIndex?: number };

export type AdStudioTemplateClassification = {
  ad_type: string;
  primary_intent: string;
  property_or_agent_focus: string;
};

export type AdStudioGalleryTemplate = AdStudioTemplate & {
  templateKey: string;
  source: "builtin";
  status: "approved";
  placement: AdStudioTemplatePlacement;
  format: "4:5" | "9:16";
  dimensions: {
    width: 1080;
    height: 1350 | 1920;
  };
  audienceIntent: string;
  category: string;
  tags: string[];
  gallery: AdStudioTemplateGalleryPreview;
  editableImage?: AdStudioTemplateEditableImage;
  editableText?: AdStudioTemplateEditableText;
  canvas: AdStudioTemplateCanvas;
  meta: AdStudioTemplateMeta;
  sourceAd: AdStudioTemplateSourceAd;
  classification: AdStudioTemplateClassification;
};

export type AdStudioLibraryTemplate = {
  template_key?: string | null;
  status?: string | null;
  category?: string | null;
  hook_style?: string | null;
  funnel_stage?: string | null;
  adstudio_template_id?: string | null;
  offer_id?: string | null;
  goal?: string | null;
  headline?: string | null;
  primary_text?: string | null;
  description?: string | null;
  cta?: string | null;
  ai_prompt_seed?: string | null;
  brief_schema?: unknown;
};

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  active: boolean;
};

export const AD_STUDIO_TEMPLATES: AdStudioGalleryTemplate[] = RAW_ADSTUDIO_GALLERY_TEMPLATES.map(validateGalleryTemplate);
export const RESOLVABLE_AD_STUDIO_TEMPLATES: AdStudioGalleryTemplate[] = AD_STUDIO_TEMPLATES.filter((template) => template.status === "approved");
export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = RESOLVABLE_AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate | null {
  if (!templateId) return null;
  return RESOLVABLE_AD_STUDIO_TEMPLATES.find((template) => template.id === templateId || template.templateKey === templateId) ?? null;
}

export function isBuiltInAdStudioTemplate(_templateId: string | undefined): boolean {
  return Boolean(resolveAdStudioTemplate(_templateId));
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return [...AD_STUDIO_TEMPLATES];
}

export function resolvableAdStudioTemplates(): AdStudioTemplate[] {
  return [...RESOLVABLE_AD_STUDIO_TEMPLATES];
}

export function mapAdStudioLibraryTemplate(_row: AdStudioLibraryTemplate): AdStudioTemplate | null {
  return null;
}

export function mergeAdStudioTemplateLibrary(_approved: AdStudioTemplate[]): AdStudioTemplate[] {
  return [...AD_STUDIO_TEMPLATES];
}

function validateGalleryTemplate(raw: AdStudioGalleryTemplate): AdStudioGalleryTemplate {
  const errors: string[] = [];
  const id = raw?.id;
  const expectedHeight = raw?.format === "4:5" ? 1350 : raw?.format === "9:16" ? 1920 : null;
  const expectedPlacement = raw?.format === "4:5" ? "meta_feed" : raw?.format === "9:16" ? "meta_fullscreen" : null;

  if (!id) errors.push("id is required");
  if (!raw.templateKey) errors.push("templateKey is required");
  if (raw.templateKey !== id) errors.push("templateKey must match id");
  if (raw.status !== "approved") errors.push("status must be approved");
  if (raw.source !== "builtin") errors.push("source must be builtin");
  if (raw.placement !== expectedPlacement) errors.push("placement does not match format");
  if (raw.dimensions?.width !== 1080 || raw.dimensions?.height !== expectedHeight) errors.push("dimensions do not match format");
  if (raw.canvas?.width !== raw.dimensions?.width || raw.canvas?.height !== raw.dimensions?.height) errors.push("canvas dimensions do not match template");
  if (raw.canvas?.fabricJson?.version !== "blockwise-fabric-v1") errors.push("fabricJson version is invalid");
  if (!raw.gallery?.thumbnailSrc || !raw.gallery.sampleImageSrc) errors.push("gallery image paths are required");
  // No forced editable fields: the editable surface is derived from canvas.objects
  // (image/text slots), so a no-headline or multi-image template is valid. The
  // fabric lockstep check below guarantees every slot is wired.
  if (raw.meta?.platform !== "meta") errors.push("meta platform must be meta");
  if (raw.meta?.objective !== "OUTCOME_LEADS") errors.push("meta objective must be OUTCOME_LEADS");
  if (raw.meta?.specialAdCategory !== "housing") errors.push("meta special ad category must be housing");

  // No fixed-role schema: templates declare their own slots (a type-only ad, a
  // multi-image collage, and a headshot ad are all valid). We only require that
  // every canvas object has a matching fabric mirror and vice versa, so the editor
  // and renderer stay in lockstep. Structural diversity + source-ad provenance are
  // enforced by scripts/verify/adstudio-templates.mjs.
  const canvasObjectIds = new Set((raw.canvas?.objects ?? []).map((object) => object.objectId));
  const fabricObjectIds = new Set(
    (raw.canvas?.fabricJson?.objects ?? [])
      .map((object) => object.blockwise?.objectId)
      .filter((value): value is string => typeof value === "string"),
  );
  if (canvasObjectIds.size === 0) errors.push("canvas.objects must not be empty");
  for (const objectId of canvasObjectIds) {
    if (!fabricObjectIds.has(objectId)) errors.push(`canvas object ${objectId} has no fabric mirror`);
  }
  for (const objectId of fabricObjectIds) {
    if (!canvasObjectIds.has(objectId)) errors.push(`fabric object ${objectId} has no canvas object`);
  }

  if (errors.length) {
    throw new Error(`Invalid AdStudio gallery template ${id ?? "<unknown>"}: ${errors.join("; ")}`);
  }

  return raw;
}
