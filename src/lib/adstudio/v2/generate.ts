// v2 customer generation — deterministic (Track E, §6). Zero image-model
// pixels: the customer's inputs render through the shared renderer; the
// canonical pixels are a pure function of the instance doc. Text AI is the
// only model in the path (copy assist, unchanged, optional).

import sharp from "sharp";

import { generateAdStudioTemplateCopy } from "../copy-generation.ts";
import { deterministicUuid } from "../id.ts";
import { computeFocalPointFromLuma } from "../smart-crop.ts";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioPlatformCopyPack,
  FirstAdInput,
} from "../types.ts";
import { hashTemplateDoc } from "./template-hash.ts";
import type { AdDocInstance, AdTemplateDocV2 } from "./template-doc.ts";
import { renderAdDocToPng } from "./render/server.ts";
import { persistAdDocRender } from "./media.ts";

export type V2GenerationInput = {
  workspaceId: string;
  userId: string;
  template: AdTemplateDocV2;
  brandKit: AdStudioBrandKit;
  firstAd: FirstAdInput;
  suburb?: string;
  city?: string;
  state?: string;
  /** Customer-provided per-slot image refs (media path or data URL). */
  images?: Record<string, string>;
  /** Customer-provided on-image copy, verbatim when present. */
  text?: Record<string, string>;
  supabase: {
    storage: {
      from(bucket: string): {
        download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
        upload(
          path: string,
          bytes: Uint8Array,
          options: { contentType: string; upsert: boolean },
        ): Promise<{ error: { message: string } | null }>;
      };
    };
  };
  /** Tests pin the fixture gallery; production uses the module defaults. */
  renderOptions?: { repoRoot?: string; fontsDir?: string };
};

export type V2GenerationResult = {
  pack: AdStudioCampaignPack;
  warnings: string[];
  /** Render wall-time across both formats, for the <2s claim. */
  renderMs: number;
};

type ResolvedImage = { src: string; bytes: Buffer; width: number; height: number; focal: { x: number; y: number } };

async function resolveImageBytes(
  input: V2GenerationInput,
  ref: string,
): Promise<{ bytes: Buffer; width: number; height: number }> {
  if (ref.startsWith("data:image/")) {
    const bytes = Buffer.from(ref.slice(ref.indexOf(",") + 1), "base64");
    const meta = await sharp(bytes).metadata();
    return { bytes, width: meta.width ?? 0, height: meta.height ?? 0 };
  }
  const storagePath = ref.startsWith("/") ? ref.slice(1) : ref;
  if (storagePath.includes("..") || !storagePath.startsWith(`${input.workspaceId}/`)) {
    throw new Error("That image is not in this workspace.");
  }
  const { data, error } = await input.supabase.storage.from("workspace-artifacts").download(storagePath);
  if (error || !data) throw new Error("That image could not be loaded. Upload it again and retry.");
  const bytes = Buffer.from(await data.arrayBuffer());
  const meta = await sharp(bytes).metadata();
  return { bytes, width: meta.width ?? 0, height: meta.height ?? 0 };
}

async function focalFromBytes(bytes: Buffer, width: number, height: number) {
  const small = 96;
  const { data, info } = await sharp(bytes)
    .resize(small, small, { fit: "inside" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return computeFocalPointFromLuma(data, info.width, info.height);
}

function dataUrlFromRef(ref: string): string | null {
  return ref.startsWith("data:image/") ? ref : null;
}

export async function generateV2Campaign(input: V2GenerationInput): Promise<V2GenerationResult> {
  const { template } = input;
  const warnings: string[] = [];

  // ── copy: customer verbatim, else the text-AI assist (allowed, §6.2) ──
  const declaredText = template.inputs.text.filter(
    (field) => !template.exactness.bakedTextKeys.includes(field.key),
  );
  const textValues: Record<string, string> = {};
  for (const field of declaredText) {
    const provided = input.text?.[field.key];
    if (typeof provided === "string" && provided.trim().length > 0) {
      if (provided.length > field.maxLength) {
        throw new V2GenerationError(
          `"${field.label}" is ${provided.length} characters; this design fits ${field.maxLength}. Shorten it rather than letting it truncate.`,
          400,
        );
      }
      textValues[field.key] = provided;
    }
  }
  const missingText = declaredText.filter((field) => !textValues[field.key] && field.required);
  if (missingText.length > 0) {
    const ai = await generateAdStudioTemplateCopy({
      workspaceId: input.workspaceId,
      userId: input.userId,
      description: input.firstAd.description,
      fields: declaredText.map((field) => ({
        key: field.key,
        label: field.label,
        maxLength: field.maxLength,
        sample: field.sample,
      })),
    });
    for (const field of declaredText) {
      textValues[field.key] ??= ai.onImage[field.key] ?? field.sample;
    }
  } else {
    for (const field of declaredText) {
      textValues[field.key] ??= field.sample;
    }
  }
  // Final clamp is a hard stop elsewhere; here values were validated above.

  // ── images: resolve, measure, focal ──
  const slotLayers = new Map<string, { minSourcePx?: { width: number; height: number }; box: { width: number; height: number }; format: "4:5" | "9:16" }>();
  for (const layout of [template.formats.feed, template.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot" && !slotLayers.has(layer.inputKey)) {
        slotLayers.set(layer.inputKey, {
          minSourcePx: layer.minSourcePx,
          box: layer.box,
          format: layout.format,
        });
      }
    }
  }

  const resolvedImages = new Map<string, ResolvedImage>();
  const allImageInputs = [...new Set(template.inputs.images.map((image) => image.key))];
  const firstProvided = input.firstAd.imageDataUrl;
  for (const key of allImageInputs) {
    const ref = input.images?.[key]
      ?? (key === allImageInputs[0] ? (firstProvided ? dataUrlFromRef(firstProvided) ?? firstProvided : undefined) : undefined);
    if (!ref) {
      const declaration = template.inputs.images.find((image) => image.key === key);
      if (declaration?.required) {
        throw new V2GenerationError(`Add a photo for "${declaration.label}" — this design needs it.`, 400);
      }
      continue;
    }
    const loaded = await resolveImageBytes(input, ref);
    const slot = slotLayers.get(key);
    const slotPx = slot
      ? { width: Math.round(slot.box.width * 1080), height: Math.round(slot.box.height * (slot.format === "9:16" ? 1920 : 1350)) }
      : { width: 1080, height: 1350 };
    const minPx = slot?.minSourcePx ?? slotPx;
    const ratio = Math.min(loaded.width / minPx.width, loaded.height / minPx.height);
    if (ratio < 0.5) {
      throw new V2GenerationError(
        `That photo is too small for this design (${loaded.width}×${loaded.height}; the slot needs at least ${Math.round(minPx.width / 2)}×${Math.round(minPx.height / 2)}). Choose a larger photo.`,
        400,
      );
    }
    if (ratio < 1) {
      warnings.push(`The photo for "${key}" is below the slot's ideal resolution — it may look soft.`);
    }
    resolvedImages.set(key, {
      src: ref,
      bytes: loaded.bytes,
      width: loaded.width,
      height: loaded.height,
      focal: await focalFromBytes(loaded.bytes, loaded.width, loaded.height),
    });
  }

  // ── instance docs (feed always; story when authored) ──
  const templateHash = hashTemplateDoc(template);
  const buildInstance = (format: "4:5" | "9:16"): AdDocInstance => ({
    schema: "adstudio.instance.v2",
    templateId: template.id,
    templateHash,
    format,
    values: {
      images: Object.fromEntries(
        [...resolvedImages.entries()].map(([key, image]) => [key, { src: image.src, focal: image.focal, zoom: 1 }]),
      ),
      text: textValues,
    },
    overrides: [],
  });

  const renderStarted = Date.now();
  const slotBytes = new Map([...resolvedImages.entries()].map(([key, image]) => [key, image.bytes]));
  const renders: { feed?: string; story?: string } = {};
  const feedInstance = buildInstance("4:5");
  const feedPng = await renderAdDocToPng(template, feedInstance, "4:5", { slotBytes, ...input.renderOptions });
  renders.feed = await persistAdDocRender({
    supabase: input.supabase,
    workspaceId: input.workspaceId,
    bytes: new Uint8Array(feedPng),
    name: `${template.id}-feed`,
  });
  let storyInstance: AdDocInstance | null = null;
  if (template.formats.story) {
    storyInstance = buildInstance("9:16");
    const storyPng = await renderAdDocToPng(template, storyInstance, "9:16", { slotBytes, ...input.renderOptions });
    renders.story = await persistAdDocRender({
      supabase: input.supabase,
      workspaceId: input.workspaceId,
      bytes: new Uint8Array(storyPng),
      name: `${template.id}-story`,
    });
  }
  const renderMs = Date.now() - renderStarted;
  feedInstance.renders = renders;
  if (storyInstance) storyInstance.renders = renders;

  // ── pack assembly: publish defaults prefilled from the template (§9.3) ──
  const campaignId = deterministicUuid(`adstudio-v2:${input.workspaceId}:${template.id}:${Date.now()}`);
  const variantId = "variant_main";
  const publish = template.publish;
  const metaCopy = {
    platform: "meta" as const,
    specialAdCategory: publish.specialAdCategory,
    primaryText: publish.copy.primaryText.slice(0, 5),
    headlines: publish.copy.headlines.slice(0, 5),
    descriptions: publish.copy.descriptions.slice(0, 5),
    cta: publish.cta,
    leadForm: {
      headline: publish.leadForm.headline,
      questions: publish.leadForm.questions,
      privacyPolicyUrl: null,
      thankYouScreen: publish.leadForm.thankYou,
    },
  };
  const copyPack: AdStudioPlatformCopyPack = {
    copyPackId: deterministicUuid(`copypack:${variantId}`),
    campaignId,
    variantId,
    meta: metaCopy,
    googleSearch: { platform: "google_search", finalUrl: "", headlines: [], descriptions: [], paths: [], keywords: [], negativeKeywords: [] },
    googlePmax: {
      platform: "google_pmax",
      businessName: input.brandKit.identity.businessName,
      finalUrl: "",
      headlines: [],
      longHeadlines: [],
      descriptions: [],
      images: { landscape_1_91: [], square_1_1: [], portrait_4_5: [], vertical_9_16: [] },
      logos: { square: [], landscape: [] },
    },
    googleDemandGen: {
      platform: "google_demand_gen",
      businessName: input.brandKit.identity.businessName,
      finalUrl: "",
      headlines: [],
      longHeadlines: [],
      descriptions: [],
      images: { landscape_1_91: [], square_1_1: [], portrait_4_5: [], vertical_9_16: [] },
      logos: { square: [], landscape: [] },
    },
    landingPage: { headline: publish.copy.headlines[0] ?? "", subheadline: publish.copy.descriptions[0] ?? "", cta: publish.cta },
    followUp: { sms: [], email: [] },
    lockedFields: [],
  };

  const creativeBase = {
    campaignId,
    variantId,
    activeRevisionId: undefined as string | undefined,
    safeZones: { metaStory: true, googleDemandGen: true },
    previewSvg: "",
  };
  const pack: AdStudioCampaignPack = {
    brandKit: input.brandKit,
    campaign: {
      campaignId,
      workspaceId: input.workspaceId,
      brandKitId: input.brandKit.brandKitId,
      name: `${input.suburb ?? template.name} — ${template.id}`,
      goal: template.goal,
      market: {
        country: "AU",
        state: input.state ?? input.brandKit.identity.marketRegion ?? "WA",
        city: input.city ?? "Perth",
        suburb: input.suburb ?? "",
      },
      audienceIntent: template.audienceIntent,
      offerId: template.offerId,
      templateKey: template.id,
      // v2 docs ship through the operator ingestion pipeline; the v2 identity
      // itself lives in templateSnapshot (schema + hash).
      templateSource: "operator",
      sourceObservedAdId: template.provenance.sourceAd.creativeId ?? null,
      templateSnapshot: { schema: template.schema, id: template.id, templateHash },
      platforms: ["meta"],
      creativeFormats: storyInstance ? ["4:5", "9:16"] : ["4:5"],
      status: "draft",
    },
    variants: [{
      variantId,
      campaignId,
      angle: template.audienceIntent || "primary",
      headline: publish.copy.headlines[0] ?? template.name,
      offer: template.offerId,
      cta: publish.cta,
      score: {
        score: 1,
        notes: ["v2 deterministic generation"],
        warnings: [],
        dimensions: { offerClarity: 1, localRelevance: 1, leadIntentStrength: 1, brandFit: 1, complianceSafety: 1, visualHierarchy: 1 },
      },
      status: "draft",
      lockedFields: [],
    }],
    creatives: [
      {
        ...creativeBase,
        creativeId: deterministicUuid(`creative-v2:${campaignId}:feed`),
        format: "4:5",
        canvas: feedInstance as never,
      },
      ...(storyInstance
        ? [{
            ...creativeBase,
            creativeId: deterministicUuid(`creative-v2:${campaignId}:story`),
            format: "9:16" as const,
            canvas: storyInstance as never,
          }]
        : []),
    ],
    copyPacks: [copyPack],
    compliance: {
      reportId: `compliance_${campaignId}`,
      campaignId,
      status: "needs_review",
      issues: [],
      checkedAt: new Date().toISOString(),
    },
  };

  return { pack, warnings, renderMs };
}

export class V2GenerationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
