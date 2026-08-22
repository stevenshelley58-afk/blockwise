import { createHash } from "node:crypto";

import sharp from "sharp";

import type { AdDocInstance, AdTemplateDocV2, TemplateLayout, TextLayer } from "./template-doc.ts";
import { TEMPLATE_FORMAT_DIMENSIONS } from "./template-doc.ts";
import { hashCanonicalJson } from "./template-hash.ts";
import { renderAdDocToPng, type RenderAdDocOptions } from "./render/server.ts";

export const FIDELITY_TEXT_REGION_PADDING_RATIO = 0.035;

export type NativeSurface = "feed" | "story";

export type PixelBounds = { x: number; y: number; width: number; height: number };

export type OutsidePixelReport = {
  totalPixels: number;
  differingPixels: number;
  differingBounds: PixelBounds | null;
};

export type NativeFidelityResult = {
  nativeSurface: NativeSurface;
  sourceContentHash: string;
  templateHash: string;
  checkedAt: string;
  residuals: Record<string, number>;
  outside: OutsidePixelReport;
};

export class NativeFidelityError extends Error {
  readonly result: NativeFidelityResult;

  constructor(message: string, result: NativeFidelityResult) {
    super(message);
    this.name = "NativeFidelityError";
    this.result = result;
  }
}

export class StressMatrixError extends Error {
  readonly result: StressMatrixResult;

  constructor(message: string, result: StressMatrixResult) {
    super(message);
    this.name = "StressMatrixError";
    this.result = result;
  }
}

/** A story is source-fidelity eligible only when it is explicitly source-native. */
export function nativeSurfaceFor(doc: AdTemplateDocV2): NativeSurface {
  return doc.formats.story?.native === true ? "story" : "feed";
}

function formatForSurface(surface: NativeSurface): "4:5" | "9:16" {
  return surface === "feed" ? "4:5" : "9:16";
}

function nativeLayout(doc: AdTemplateDocV2): { surface: NativeSurface; layout: TemplateLayout } {
  const surface = nativeSurfaceFor(doc);
  const layout = doc.formats[surface];
  if (!layout) throw new Error(`template ${doc.id} has no ${surface} layout`);
  return { surface, layout };
}

function editableTextLayers(doc: AdTemplateDocV2, layout: TemplateLayout): TextLayer[] {
  const baked = new Set(doc.exactness.bakedTextKeys);
  return layout.layers.filter((layer): layer is TextLayer => (
    layer.type === "text" && !baked.has(layer.inputKey)
  ));
}

function paddedLayerBounds(layer: TextLayer, layout: TemplateLayout): PixelBounds {
  const baseWidth = layer.box.width * layout.width;
  const baseHeight = layer.box.height * layout.height;
  const effects = layer.typo.effects;
  const effectSpread = (effects?.shadow
    ? effects.shadow.blurRatio * baseHeight
      + Math.abs(effects.shadow.dx) * baseWidth
      + Math.abs(effects.shadow.dy) * baseHeight
    : 0) + (effects?.stroke ? effects.stroke.widthRatio * baseHeight : 0);
  const padding = Math.ceil(effectSpread + FIDELITY_TEXT_REGION_PADDING_RATIO * Math.max(layout.width, layout.height));
  const radians = ((layer.rotation ?? 0) * Math.PI) / 180;
  const rotatedWidth = Math.abs(baseWidth * Math.cos(radians)) + Math.abs(baseHeight * Math.sin(radians));
  const rotatedHeight = Math.abs(baseWidth * Math.sin(radians)) + Math.abs(baseHeight * Math.cos(radians));
  const centerX = (layer.box.x + layer.box.width / 2) * layout.width;
  const centerY = (layer.box.y + layer.box.height / 2) * layout.height;
  const left = Math.max(0, Math.floor(centerX - rotatedWidth / 2) - padding);
  const top = Math.max(0, Math.floor(centerY - rotatedHeight / 2) - padding);
  const right = Math.min(layout.width, Math.ceil(centerX + rotatedWidth / 2) + padding);
  const bottom = Math.min(layout.height, Math.ceil(centerY + rotatedHeight / 2) + padding);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function insideAny(bounds: PixelBounds[], x: number, y: number): boolean {
  return bounds.some((box) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
}

function grayscaleRmse(rendered: Uint8Array, source: Uint8Array, width: number, bounds: PixelBounds): number {
  let sum = 0;
  let count = 0;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 2) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 2) {
      const offset = (y * width + x) * 4;
      const renderedGrey = 0.2126 * rendered[offset]! + 0.7152 * rendered[offset + 1]! + 0.0722 * rendered[offset + 2]!;
      const sourceGrey = 0.2126 * source[offset]! + 0.7152 * source[offset + 1]! + 0.0722 * source[offset + 2]!;
      const delta = (renderedGrey - sourceGrey) / 255;
      sum += delta * delta;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

function outsidePixelReport(rendered: Uint8Array, source: Uint8Array, layout: TemplateLayout, excluded: PixelBounds[]): OutsidePixelReport {
  let totalPixels = 0;
  let differingPixels = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      if (insideAny(excluded, x, y)) continue;
      totalPixels += 1;
      const offset = (y * layout.width + x) * 4;
      if (
        rendered[offset] !== source[offset]
        || rendered[offset + 1] !== source[offset + 1]
        || rendered[offset + 2] !== source[offset + 2]
        || rendered[offset + 3] !== source[offset + 3]
      ) {
        differingPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return {
    totalPixels,
    differingPixels,
    differingBounds: differingPixels === 0 ? null : {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
  };
}

/** Bind a check to render-affecting state while excluding self-reported output. */
export function fidelityTemplateHash(doc: AdTemplateDocV2): string {
  return hashCanonicalJson({
    ...doc,
    exactness: { bakedTextKeys: [...doc.exactness.bakedTextKeys].sort() },
  });
}

export type NativeFidelityOptions = {
  sourceBytes: Buffer;
  sourceValues: Record<string, string>;
  renderOptions?: RenderAdDocOptions;
  checkedAt?: string;
};

/**
 * Replays the sole source-native surface against the correctly resized source.
 * Derived surfaces deliberately do not participate: their layout is not a
 * source image and stretching that source would manufacture a false signal.
 */
export async function runNativeSurfaceFidelity(
  doc: AdTemplateDocV2,
  options: NativeFidelityOptions,
): Promise<NativeFidelityResult> {
  const sourceHash = createHash("sha256").update(options.sourceBytes).digest("hex");
  if (sourceHash !== doc.provenance.sourceAd.contentHash) {
    throw new Error(`source hash mismatch for ${doc.id}; fidelity must use the recorded source bytes`);
  }
  const { surface, layout } = nativeLayout(doc);
  const format = formatForSurface(surface);
  const instance: AdDocInstance = {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: fidelityTemplateHash(doc),
    format,
    values: { images: {}, text: options.sourceValues },
    overrides: [],
  };
  const [renderedPng, sourceRaw] = await Promise.all([
    renderAdDocToPng(doc, instance, format, options.renderOptions),
    sharp(options.sourceBytes)
      .resize(layout.width, layout.height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer(),
  ]);
  const renderedRaw = await sharp(renderedPng).ensureAlpha().raw().toBuffer();
  const editable = editableTextLayers(doc, layout);
  const bounds = editable.map((layer) => paddedLayerBounds(layer, layout));
  const residuals = Object.fromEntries(editable.map((layer, index) => [
    layer.id,
    grayscaleRmse(renderedRaw, sourceRaw, layout.width, bounds[index]!),
  ]));
  const result: NativeFidelityResult = {
    nativeSurface: surface,
    sourceContentHash: doc.provenance.sourceAd.contentHash,
    templateHash: fidelityTemplateHash(doc),
    checkedAt: options.checkedAt ?? new Date().toISOString(),
    residuals,
    outside: outsidePixelReport(renderedRaw, sourceRaw, layout, bounds),
  };
  if (result.outside.differingPixels > 0) {
    throw new NativeFidelityError(
      `template ${doc.id} changed ${result.outside.differingPixels} pixels outside editable text regions`,
      result,
    );
  }
  return result;
}

export type StressScenario = "longest-copy" | "one-character-copy" | "minimum-resolution" | "all-portrait" | "all-landscape";

export type StressMatrixEntry = {
  format: "4:5" | "9:16";
  scenario: StressScenario;
  renderHash: string;
};

export type StressMatrixResult = {
  templateHash: string;
  entries: StressMatrixEntry[];
  hash: string;
};

type ImageShape = "normal" | "portrait" | "landscape";

function sourceSizeFor(input: AdTemplateDocV2["inputs"]["images"][number], doc: AdTemplateDocV2, shape: ImageShape): { width: number; height: number } {
  const minima: Array<{ width: number; height: number }> = [];
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot" && layer.inputKey === input.key) {
        minima.push(layer.minSourcePx ?? {
          width: Math.round(layer.box.width * layout.width),
          height: Math.round(layer.box.height * layout.height),
        });
      }
    }
  }
  const minWidth = Math.max(1, ...minima.map((size) => size.width));
  const minHeight = Math.max(1, ...minima.map((size) => size.height));
  if (shape === "portrait") return { width: minWidth, height: Math.max(minHeight, minWidth * 3) };
  if (shape === "landscape") return { width: Math.max(minWidth, minHeight * 3), height: minHeight };
  if (input.aspect === "portrait") return { width: minWidth, height: Math.max(minHeight, Math.ceil(minWidth * 1.25)) };
  if (input.aspect === "landscape") return { width: Math.max(minWidth, Math.ceil(minHeight * 1.25)), height: minHeight };
  return { width: Math.max(minWidth, minHeight), height: Math.max(minWidth, minHeight) };
}

async function generatedSlotBytes(doc: AdTemplateDocV2, shape: ImageShape): Promise<Map<string, Buffer>> {
  const slots = new Map<string, Buffer>();
  for (const [index, input] of doc.inputs.images.entries()) {
    const size = sourceSizeFor(input, doc, shape);
    // Stable, distinguishable pixels make slot swaps visible in Studio QA.
    const background = {
      r: (43 + index * 67) % 255,
      g: (91 + index * 43) % 255,
      b: (151 + index * 29) % 255,
      alpha: 1,
    };
    slots.set(input.key, await sharp({ create: { ...size, channels: 4, background } }).png().toBuffer());
  }
  return slots;
}

function textValues(doc: AdTemplateDocV2, mode: "sample" | "longest" | "one-character"): Record<string, string> {
  return Object.fromEntries(doc.inputs.text.map((input) => {
    if (mode === "longest") return [input.key, "W".repeat(input.maxLength)];
    if (mode === "one-character") return [input.key, "W"];
    return [input.key, input.sample];
  }));
}

function scenarioInput(mode: StressScenario): { text: "sample" | "longest" | "one-character"; shape: ImageShape } {
  if (mode === "longest-copy") return { text: "longest", shape: "normal" };
  if (mode === "one-character-copy") return { text: "one-character", shape: "normal" };
  if (mode === "all-portrait") return { text: "sample", shape: "portrait" };
  if (mode === "all-landscape") return { text: "sample", shape: "landscape" };
  return { text: "sample", shape: "normal" };
}

export type StressMatrixOptions = {
  renderOptions?: Omit<RenderAdDocOptions, "slotBytes">;
  onRender?: (entry: StressMatrixEntry, png: Buffer) => void | Promise<void>;
};

/**
 * Exercises every delivered surface against text extremes and exact-minimum,
 * adversarially shaped image inputs. Any renderer error, including
 * RenderFitError, fails the whole matrix rather than being converted to a pass.
 */
export async function runStressMatrix(doc: AdTemplateDocV2, options: StressMatrixOptions = {}): Promise<StressMatrixResult> {
  if (!doc.formats.story) throw new Error(`template ${doc.id} has no story layout for stress matrix`);
  const templateHash = fidelityTemplateHash(doc);
  const entries: StressMatrixEntry[] = [];
  const scenarios: StressScenario[] = ["longest-copy", "one-character-copy", "minimum-resolution", "all-portrait", "all-landscape"];
  for (const scenario of scenarios) {
    const input = scenarioInput(scenario);
    const slotBytes = await generatedSlotBytes(doc, input.shape);
    for (const format of ["4:5", "9:16"] as const) {
      const instance: AdDocInstance = {
        schema: "adstudio.instance.v2",
        templateId: doc.id,
        templateHash,
        format,
        values: {
          images: Object.fromEntries(doc.inputs.images.map((image) => [image.key, { src: `stress:${scenario}:${image.key}` }])),
          text: textValues(doc, input.text),
        },
        overrides: [],
      };
      try {
        const png = await renderAdDocToPng(doc, instance, format, { ...options.renderOptions, slotBytes });
        const entry = { format, scenario, renderHash: createHash("sha256").update(png).digest("hex") } as const;
        entries.push(entry);
        await options.onRender?.(entry, png);
      } catch (error) {
        const partial: StressMatrixResult = {
          templateHash,
          entries,
          hash: hashCanonicalJson({ templateHash, entries }),
        };
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        throw new StressMatrixError(`stress ${scenario} ${format} failed: ${detail}`, partial);
      }
    }
  }
  return { templateHash, entries, hash: hashCanonicalJson({ templateHash, entries }) };
}
