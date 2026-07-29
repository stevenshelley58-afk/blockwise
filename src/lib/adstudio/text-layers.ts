// Derived text-editing layers ("magic layers") for AI-designed creatives.
//
// One background pass per creative builds two things from the finished flat
// render:
//   1. A "plate": the render with every text region inpainted away, so the
//      clean background under each headline/price/CTA is known.
//   2. Per-region type treatments (family category, weight, colour, align…)
//      detected by one vision call.
//
// With those in hand, a text edit becomes deterministic: the BROWSER re-typesets
// the customer's exact copy over the plate crop (browsers have real fonts;
// serverless sharp has no fontconfig — see rasterize-reference.ts), and the
// server just composites the patch onto the current render. No image-model
// round trip, ~1s total, character-for-character exact.
//
// The flat render stays canonical everywhere else in the product. Layers are
// advisory and validity-tracked: composites only run against renders listed in
// `validFor`; anything else drops the layers and a background rebuild runs.

import type { ImageProviderRequest } from "./providers.ts";
import type { AdStudioCloneRegion, AdStudioTextLayers, AdStudioTextLayerStyle } from "./types.ts";
import { GLOBAL_CLONE_NEGATIVES } from "./reference-clone.ts";
import { dataUrlToUploadBytes } from "./generated-media.ts";
import { paddedPixelRect } from "./region-edit.ts";
import { createTextProviderForCandidate } from "./ai-providers.ts";
import type { TextProviderAdapter, TextProviderResponse } from "./providers.ts";
import {
  isProviderFallbackEligible,
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import {
  executeAdStudioProviderAttempt,
  recordAdStudioProviderRun,
  type ProviderRunAttempt,
} from "../operator/prompts/redact-prompt-run.ts";

type NormalizedBox = { x: number; y: number; width: number; height: number };

/** Renders the plate stays valid for; bounded so canvas_json cannot grow unbounded. */
export const TEXT_LAYERS_VALID_FOR_LIMIT = 12;

/** Patch uploads are one small region crop; anything bigger is not a patch. */
export const MAX_TEXT_PATCH_BYTES = 4 * 1024 * 1024;

export function textRegionsOf(regions: AdStudioCloneRegion[] | undefined): AdStudioCloneRegion[] {
  return (regions ?? []).filter((region) => region.kind === "text" && region.box.width > 0 && region.box.height > 0);
}

/** True when `box` (grown by the compositing tolerance) overlaps any text region. */
export function boxIntersectsTextRegions(
  box: NormalizedBox | undefined,
  regions: AdStudioCloneRegion[] | undefined,
  tolerance = 0.02,
): boolean {
  if (!box) return true; // No box means a full-image edit: everything is touched.
  return textRegionsOf(regions).some((region) => {
    const r = region.box;
    return box.x - tolerance < r.x + r.width
      && box.x + box.width + tolerance > r.x
      && box.y - tolerance < r.y + r.height
      && box.y + box.height + tolerance > r.y;
  });
}

/** Append a render ref to the plate's validity list, newest last, bounded. */
export function extendTextLayersValidity(layers: AdStudioTextLayers, renderRef: string): AdStudioTextLayers {
  const validFor = [...layers.validFor.filter((ref) => ref !== renderRef), renderRef]
    .slice(-TEXT_LAYERS_VALID_FOR_LIMIT);
  return { ...layers, validFor };
}

/** The one full-render inpaint request that builds the text-free plate. */
export function buildPlateInpaintRequest(input: {
  currentImage: string;
  aspectRatio: string;
}): ImageProviderRequest {
  return {
    prompt:
      "Reference image 1 is a finished ad. Remove every piece of text, lettering, and typography inside the masked regions, "
      + "reconstructing the underlying background surfaces, colours, gradients, shapes, and photo content exactly as they would "
      + "appear without the text. Do not move, restyle, or redraw anything else. Keep every pixel outside the masked regions unchanged.",
    negativePrompt: GLOBAL_CLONE_NEGATIVES,
    referenceAssets: [input.currentImage],
    aspectRatio: input.aspectRatio,
    stylePreset: "real_estate_clone",
    requiresReferenceAssets: true,
    seed: 1,
  };
}

async function imageBytes(assetUrl: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  if (assetUrl.startsWith("data:image/")) return dataUrlToUploadBytes(assetUrl).bytes;
  const response = await fetchImpl(assetUrl);
  if (!response.ok) throw new Error(`Creative image could not be prepared (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Derive the final plate from the model's inpaint output: start from the
 * ORIGINAL render and take only the padded text-region rectangles from the
 * model. Every pixel outside a text region is byte-for-byte the original, so
 * model drift can never leak into the design.
 */
export async function derivePlateFromInpaint(
  originalAssetUrl: string,
  inpaintedAssetUrl: string,
  textBoxes: NormalizedBox[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const [originalBytes, inpaintedBytes] = await Promise.all([
    imageBytes(originalAssetUrl, fetchImpl),
    imageBytes(inpaintedAssetUrl, fetchImpl),
  ]);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read.");
  const width = metadata.width;
  const height = metadata.height;

  // Models may return a different size; normalize before pixel math.
  const normalizedInpaint = await sharp(inpaintedBytes)
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  const overlays = await Promise.all(textBoxes.map(async (box) => {
    const rect = paddedPixelRect(box, width, height);
    const input = await sharp(normalizedInpaint)
      .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .png()
      .toBuffer();
    return { input, left: rect.left, top: rect.top };
  }));

  const plate = await sharp(originalBytes).composite(overlays).png().toBuffer();
  return `data:image/png;base64,${plate.toString("base64")}`;
}

/**
 * Composite a client-rendered text patch onto the current render. The patch is
 * clamped to the selected region's padded rectangle — the client can only ever
 * affect the same pixels a model edit could.
 */
export async function compositeTextPatch(
  currentAssetUrl: string,
  patchDataUrl: string,
  box: NormalizedBox,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!patchDataUrl.startsWith("data:image/")) throw new Error("The rendered text patch could not be read.");
  const patch = dataUrlToUploadBytes(patchDataUrl);
  if (patch.bytes.byteLength > MAX_TEXT_PATCH_BYTES) throw new Error("The rendered text patch is too large.");

  const originalBytes = await imageBytes(currentAssetUrl, fetchImpl);
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(originalBytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Creative image dimensions could not be read for editing.");

  const rect = paddedPixelRect(box, metadata.width, metadata.height);
  const normalizedPatch = await sharp(patch.bytes)
    .resize(rect.width, rect.height, { fit: "fill" })
    .png()
    .toBuffer();
  const composited = await sharp(originalBytes)
    .composite([{ input: normalizedPatch, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${composited.toString("base64")}`;
}

const STYLE_DETECTION_SYSTEM = [
  "You are reading the type treatment of specific text elements in a finished ad",
  "creative so the exact copy can be re-typeset faithfully. Return ONLY JSON",
  "matching this exact shape:",
  '{ "styles": [ { "key": "<region key>", "family": "sans", "weight": 700,',
  '"italic": false, "uppercase": false, "color": "#ffffff", "align": "center",',
  '"letterSpacing": "normal" } ] }',
  'For each requested key: "family" is one of sans, serif, slab, condensed,',
  'rounded, script, mono — the closest generic category for the rendered font.',
  '"weight" is 400, 500, 600, 700, or 800. "uppercase" is true when the text is',
  'rendered in all capitals. "color" is the dominant hex colour of the letters',
  '(not the background). "align" is the text alignment within its own block.',
  '"letterSpacing" is "wide" only for visibly spaced-out type. Return one entry',
  "per requested key and no text outside the JSON object.",
].join(" ");

const STYLE_FAMILIES = new Set(["sans", "serif", "slab", "condensed", "rounded", "script", "mono"]);
const STYLE_WEIGHTS = new Set([400, 500, 600, 700, 800]);

export function parseTextLayerStyles(raw: unknown, requestedKeys: string[]): Record<string, AdStudioTextLayerStyle> {
  const keys = new Set(requestedKeys);
  const styles: Record<string, AdStudioTextLayerStyle> = {};
  const entries = raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).styles)
    ? (raw as { styles: unknown[] }).styles
    : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!key || !keys.has(key)) continue;
    const family = typeof item.family === "string" && STYLE_FAMILIES.has(item.family)
      ? item.family as AdStudioTextLayerStyle["family"]
      : "sans";
    const weight = typeof item.weight === "number" && STYLE_WEIGHTS.has(item.weight) ? item.weight : 700;
    const color = typeof item.color === "string" && /^#[0-9a-f]{3,8}$/i.test(item.color.trim())
      ? item.color.trim()
      : "#ffffff";
    const align = item.align === "left" || item.align === "right" ? item.align : "center";
    styles[key] = {
      family,
      weight,
      italic: item.italic === true,
      uppercase: item.uppercase === true,
      color,
      align,
      letterSpacing: item.letterSpacing === "wide" ? "wide" : "normal",
    };
  }
  return styles;
}

export type DetectTextLayerStylesInput = {
  workspaceId: string;
  userId: string;
  correlationId: string;
  /** Model-readable image (data: URL or absolute http(s) URL). */
  imageUrl: string;
  regionKeys: string[];
};

/**
 * One vision call per decomposition: reads the type treatment of every text
 * region. Mirrors detectCloneRegions' shape. On ANY failure it returns {} so
 * the caller can fall back to defaults without breaking the pipeline.
 */
export async function detectTextLayerStyles(
  input: DetectTextLayerStylesInput,
): Promise<Record<string, AdStudioTextLayerStyle>> {
  if (input.regionKeys.length === 0) return {};
  try {
    const startedAt = Date.now();
    const mutationId = `${input.correlationId}:adstudio.text_layer_styles`;
    const profile = await resolveRuntimeModelProfile("vision_classification");
    const candidates = modelCandidateAttempts(profile);
    const attempts: ProviderRunAttempt[] = [];
    let output: TextProviderResponse | null = null;
    let provider: TextProviderAdapter | null = null;
    let modelName = "unavailable";
    let lastError: unknown = null;
    const userMessage = `Read the type treatment of these text elements: ${input.regionKeys.join(", ")}.`;

    for (const [attemptIndex, candidate] of candidates.entries()) {
      const candidateProvider = createTextProviderForCandidate(candidate);
      try {
        const execution = await executeAdStudioProviderAttempt<TextProviderResponse>({
          workspaceId: input.workspaceId,
          mutationId,
          attemptIndex,
          modelProfile: "vision_classification",
          provider: candidateProvider,
          execute: () => candidateProvider.generate({
            system: STYLE_DETECTION_SYSTEM,
            schemaName: "metaLeadAdPack",
            imageUrl: input.imageUrl,
            messages: [{ role: "user", content: userMessage }],
          }),
        });
        attempts.push(execution.attempt);
        if (!execution.ok) {
          lastError = execution.error;
          if (!isProviderFallbackEligible(execution.error)) break;
          continue;
        }
        output = execution.output;
        provider = candidateProvider;
        modelName = String(output.providerMetadata.model ?? candidate.model);
        break;
      } catch (error) {
        lastError = error;
        break;
      }
    }

    await recordAdStudioProviderRun({
      workspaceId: input.workspaceId,
      userId: input.userId,
      correlationId: input.correlationId,
      taskType: "adstudio.text_layer_styles",
      modelProfile: "vision_classification",
      mutationId,
      prompt: {
        system: STYLE_DETECTION_SYSTEM,
        user: userMessage,
        fullPrompt: STYLE_DETECTION_SYSTEM,
        promptVersions: [],
        fallbackPromptUsed: false,
        warnings: [],
      },
      input: { regionKeys: input.regionKeys },
      attempts,
      latencyMs: Date.now() - startedAt,
      providerName: provider?.providerName ?? "unavailable",
      providerType: "text_generation",
      modelName,
      output,
      status: output ? "completed" : "failed",
      error: output ? undefined : lastError,
    });

    if (!output) return {};
    return parseTextLayerStyles(output.json, input.regionKeys);
  } catch {
    return {};
  }
}
