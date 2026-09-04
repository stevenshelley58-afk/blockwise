import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  MINIMUM_TEXT_SIZE_PX,
  adTemplateSchema,
  type AdTemplate,
  type ImageSlotLayer,
  type Placement,
  type Rect,
} from "@blockwise/ad-template-contract";
import { renderBoth, type RenderOutput, type TextRenderDiagnostic } from "./renderer.js";

type CheckStatus = "pass" | "fail" | "not_run";

export interface AuditCheck {
  id: string;
  status: CheckStatus;
  details?: unknown;
}

export interface RenderAuditReceipt {
  schema: "blockwise.ad-template-render-audit";
  version: 1;
  context?: { runId?: string; iteration?: number };
  artifact: { sha256: string; templateId?: string };
  renderer: { module: string; sha256: string };
  outputs?: Record<Placement, {
    sha256: string;
    width: number;
    height: number;
    minimumAlpha: number;
    maximumAlpha: number;
  }>;
  diagnostics?: {
    text: TextRenderDiagnostic[];
    imageSlots: {
      unresolved: Array<{ placement: Placement; layerId: string; inputKey: string }>;
      perceptualHashes: Array<{ placement: Placement; layerId: string; inputKey: string; dHash64: string }>;
      duplicatePairs: Array<{
        placement: Placement;
        firstLayerId: string;
        firstInputKey: string;
        secondLayerId: string;
        secondInputKey: string;
        hammingDistance: number;
        pixelSimilarity: number;
      }>;
      thresholds: { maximumHammingDistance: number; minimumPixelSimilarity: number };
    };
  };
  sourceMacro?: {
    gate: false;
    sourceSha256: string;
    comparisons: Array<{ placement: Placement; hammingDistance: number; pixelSimilarity: number }>;
    error?: string;
  };
  checks: AuditCheck[];
  verdict: "pass" | "fail";
}

export interface AuditArtifactInput {
  artifactBytes: Buffer;
  assetsDir: string;
  sourceBytes?: Buffer;
  runId?: string;
  iteration?: number;
}

export interface AuditArtifactResult {
  receipt: RenderAuditReceipt;
  outputs?: Record<Placement, Buffer>;
}

type SuppliedAsset = {
  assetKey: string;
  fileName?: string;
  bytesBase64?: string;
};

type ResolvedInputs = {
  imageValues: Record<string, Buffer>;
  fontValues: Record<string, Buffer>;
  textValues: Record<string, string>;
};

type PerceptualSignature = {
  dHash64: bigint;
  rgb: Uint8Array;
};

const EXPECTED_DIMENSIONS: Record<Placement, { width: number; height: number }> = {
  feed: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};
const DUPLICATE_MAXIMUM_HAMMING_DISTANCE = 4;
const DUPLICATE_MINIMUM_PIXEL_SIMILARITY = 0.92;

export async function auditTemplateArtifact(input: AuditArtifactInput): Promise<AuditArtifactResult> {
  const artifactSha256 = sha256(input.artifactBytes);
  const renderer = await rendererIdentity();
  const context = input.runId !== undefined || input.iteration !== undefined
    ? { ...(input.runId !== undefined ? { runId: input.runId } : {}), ...(input.iteration !== undefined ? { iteration: input.iteration } : {}) }
    : undefined;
  const baseReceipt = (): Omit<RenderAuditReceipt, "checks" | "verdict"> => ({
    schema: "blockwise.ad-template-render-audit",
    version: 1,
    ...(context ? { context } : {}),
    artifact: { sha256: artifactSha256 },
    renderer,
  });

  let artifact: unknown;
  try {
    artifact = JSON.parse(input.artifactBytes.toString("utf8"));
  } catch {
    return failure(baseReceipt(), [
      { id: "schema_parse", status: "fail", details: ["artifact is not valid JSON"] },
      ...notRunChecks(),
    ]);
  }
  const artifactRecord = isRecord(artifact) ? artifact : {};
  const parsed = adTemplateSchema.safeParse(artifactRecord.template);
  if (!parsed.success) {
    return failure(baseReceipt(), [
      {
        id: "schema_parse",
        status: "fail",
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      ...notRunChecks(),
    ]);
  }
  const template = parsed.data as AdTemplate;
  const receiptBase = {
    ...baseReceipt(),
    artifact: { sha256: artifactSha256, templateId: template.templateId },
  };

  let resolved: ResolvedInputs;
  try {
    resolved = await resolveArtifactInputs(template, artifactRecord.assets, input.assetsDir);
  } catch (error) {
    return failure(receiptBase, [
      { id: "schema_parse", status: "pass" },
      { id: "artifact_inputs", status: "fail", details: errorMessage(error) },
      ...notRunChecks(["artifact_inputs"]),
    ]);
  }

  let rendered: [RenderOutput, RenderOutput];
  try {
    rendered = await renderBoth({
      template,
      imageValues: resolved.imageValues,
      textValues: resolved.textValues,
      colourMap: template.semanticColours,
      fontValues: resolved.fontValues,
      collectDiagnostics: true,
    });
  } catch (error) {
    return failure(receiptBase, [
      { id: "schema_parse", status: "pass" },
      { id: "artifact_inputs", status: "pass" },
      { id: "renderer_rerender", status: "fail", details: errorMessage(error) },
      ...notRunChecks(["artifact_inputs", "renderer_rerender"]),
    ]);
  }

  const outputsByPlacement = Object.fromEntries(rendered.map((output) => [output.placement, output])) as Record<Placement, RenderOutput>;
  const inspections = {
    feed: await inspectPng(outputsByPlacement.feed.png),
    story: await inspectPng(outputsByPlacement.story.png),
  };
  const outputReceipt = {
    feed: {
      sha256: sha256(outputsByPlacement.feed.png),
      width: inspections.feed.width,
      height: inspections.feed.height,
      minimumAlpha: inspections.feed.minimumAlpha,
      maximumAlpha: inspections.feed.maximumAlpha,
    },
    story: {
      sha256: sha256(outputsByPlacement.story.png),
      width: inspections.story.width,
      height: inspections.story.height,
      minimumAlpha: inspections.story.minimumAlpha,
      maximumAlpha: inspections.story.maximumAlpha,
    },
  };
  const text = rendered.flatMap((output) => output.diagnostics?.textLayers ?? []);
  const imageSlots = await inspectImageSlots(template, resolved.imageValues);
  const dimensionFailures = (Object.keys(EXPECTED_DIMENSIONS) as Placement[]).filter((placement) => {
    const expected = EXPECTED_DIMENSIONS[placement];
    const actual = outputReceipt[placement];
    return actual.width !== expected.width || actual.height !== expected.height;
  });
  const alphaFailures = (Object.keys(EXPECTED_DIMENSIONS) as Placement[])
    .filter((placement) => outputReceipt[placement].minimumAlpha !== 255 || outputReceipt[placement].maximumAlpha !== 255);
  const textPaintFailures = text
    .filter((item) => item.status === "refused" || (item.status === "painted" && item.paintedBounds === null))
    .map(({ placement, layerId, status, reason }) => ({ placement, layerId, status, reason }));
  const textBoundsFailures = text
    .filter((item) => item.status === "painted" && !item.withinGeometry)
    .map(({ placement, layerId, geometry, paintedBounds }) => ({ placement, layerId, geometry, paintedBounds }));
  const textFontFailures = text
    .filter((item) => item.status === "painted" && item.fontSizePx < MINIMUM_TEXT_SIZE_PX[item.placement])
    .map(({ placement, layerId, fontSizePx }) => ({ placement, layerId, fontSizePx }));
  const textLineFailures = text
    .filter((item) => item.lineCount > item.maxLines)
    .map(({ placement, layerId, lineCount, maxLines }) => ({ placement, layerId, lineCount, maxLines }));
  const checks: AuditCheck[] = [
    { id: "schema_parse", status: "pass" },
    { id: "artifact_inputs", status: "pass" },
    { id: "renderer_rerender", status: "pass" },
    check("output_dimensions", dimensionFailures),
    check("output_opacity", alphaFailures),
    check("text_painted", textPaintFailures),
    check("text_painted_bounds", textBoundsFailures),
    check("text_font_floor", textFontFailures),
    check("text_line_count", textLineFailures),
    check("image_slots_resolved", imageSlots.unresolved),
    check("image_slot_duplicates", imageSlots.duplicatePairs),
  ];
  let sourceMacro: RenderAuditReceipt["sourceMacro"];
  if (input.sourceBytes) {
    try {
      sourceMacro = {
        gate: false,
        sourceSha256: sha256(input.sourceBytes),
        comparisons: await compareSourceMacro(input.sourceBytes, outputsByPlacement),
      };
    } catch (error) {
      sourceMacro = {
        gate: false,
        sourceSha256: sha256(input.sourceBytes),
        comparisons: [],
        error: "source image could not be decoded",
      };
    }
  }
  const receipt: RenderAuditReceipt = {
    ...receiptBase,
    outputs: outputReceipt,
    diagnostics: { text, imageSlots },
    ...(sourceMacro ? { sourceMacro } : {}),
    checks,
    verdict: checks.some((item) => item.status === "fail") ? "fail" : "pass",
  };
  return {
    receipt,
    outputs: { feed: outputsByPlacement.feed.png, story: outputsByPlacement.story.png },
  };
}

function failure(
  base: Omit<RenderAuditReceipt, "checks" | "verdict">,
  checks: AuditCheck[],
): AuditArtifactResult {
  return { receipt: { ...base, checks, verdict: "fail" } };
}

function notRunChecks(exclude: string[] = []): AuditCheck[] {
  return [
    "artifact_inputs",
    "renderer_rerender",
    "output_dimensions",
    "output_opacity",
    "text_painted",
    "text_painted_bounds",
    "text_font_floor",
    "text_line_count",
    "image_slots_resolved",
    "image_slot_duplicates",
  ].filter((id) => !exclude.includes(id)).map((id) => ({ id, status: "not_run" }));
}

function check(id: string, failures: unknown[]): AuditCheck {
  return failures.length === 0 ? { id, status: "pass" } : { id, status: "fail", details: failures };
}

async function rendererIdentity(): Promise<{ module: string; sha256: string }> {
  const built = fileURLToPath(new URL("./renderer.js", import.meta.url));
  const source = fileURLToPath(new URL("./renderer.ts", import.meta.url));
  const modulePath = existsSync(built) ? built : source;
  return { module: basename(modulePath), sha256: sha256(await readFile(modulePath)) };
}

async function resolveArtifactInputs(template: AdTemplate, suppliedValue: unknown, assetsDir: string): Promise<ResolvedInputs> {
  if (suppliedValue !== undefined && !Array.isArray(suppliedValue)) throw new Error("artifact assets must be an array");
  const suppliedAssets = (suppliedValue ?? []).map((value, index): SuppliedAsset => {
    if (!isRecord(value) || typeof value.assetKey !== "string" || !value.assetKey) {
      throw new Error(`artifact asset ${index} is missing assetKey`);
    }
    if (value.fileName !== undefined && typeof value.fileName !== "string") throw new Error(`artifact asset ${value.assetKey} has invalid fileName`);
    if (value.bytesBase64 !== undefined && typeof value.bytesBase64 !== "string") throw new Error(`artifact asset ${value.assetKey} has invalid bytesBase64`);
    return { assetKey: value.assetKey, ...(value.fileName ? { fileName: value.fileName } : {}), ...(value.bytesBase64 ? { bytesBase64: value.bytesBase64 } : {}) };
  });
  const imageValues: Record<string, Buffer> = {};
  for (const [assetKey, declared] of Object.entries(template.assets)) {
    const supplied = suppliedAssets.find((asset) => asset.assetKey === assetKey);
    const fileName = basename(supplied?.fileName ?? declared.fileName);
    imageValues[assetKey] = supplied?.bytesBase64
      ? decodeBase64(supplied.bytesBase64, assetKey)
      : await readAssetFile(assetsDir, fileName);
  }
  for (const imageInput of template.imageInputs) {
    const supplied = suppliedAssets.find((asset) => asset.assetKey === imageInput.key);
    if (supplied) {
      imageValues[imageInput.key] = supplied.bytesBase64
        ? decodeBase64(supplied.bytesBase64, supplied.assetKey)
        : await readAssetFile(assetsDir, basename(supplied.fileName ?? supplied.assetKey));
    } else if (imageInput.defaultAssetKey && imageValues[imageInput.defaultAssetKey]) {
      imageValues[imageInput.key] = imageValues[imageInput.defaultAssetKey];
    }
  }
  const fontValues: Record<string, Buffer> = {};
  for (const font of template.fonts) {
    const fileName = basename(font.file);
    const supplied = suppliedAssets.find((asset) => asset.assetKey === font.file || asset.assetKey === `font:${font.file}`);
    if (supplied?.bytesBase64) fontValues[font.file] = decodeBase64(supplied.bytesBase64, supplied.assetKey);
    else {
      try {
        fontValues[font.file] = await readFile(join(assetsDir, fileName));
      } catch {
        // The renderer resolves immutable bundled fonts when no explicit bytes exist.
      }
    }
  }
  return {
    imageValues,
    fontValues,
    textValues: Object.fromEntries(template.textInputs.map((textInput) => [textInput.key, textInput.placeholder])),
  };
}

async function readAssetFile(assetsDir: string, fileName: string): Promise<Buffer> {
  try {
    return await readFile(join(assetsDir, fileName));
  } catch {
    throw new Error(`missing artifact asset file: ${fileName}`);
  }
}

function decodeBase64(value: string, assetKey: string): Buffer {
  const normalized = value.replace(/\s+/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(`artifact asset ${assetKey} has invalid base64 bytes`);
  }
  return Buffer.from(normalized, "base64");
}

async function inspectPng(png: Buffer): Promise<{ width: number; height: number; minimumAlpha: number; maximumAlpha: number }> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
  let minimumAlpha = 255;
  let maximumAlpha = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    minimumAlpha = Math.min(minimumAlpha, pixels[index] ?? 0);
    maximumAlpha = Math.max(maximumAlpha, pixels[index] ?? 0);
  }
  return { width: image.width, height: image.height, minimumAlpha, maximumAlpha };
}

async function inspectImageSlots(template: AdTemplate, imageValues: Record<string, Buffer>): Promise<NonNullable<RenderAuditReceipt["diagnostics"]>["imageSlots"]> {
  const unresolved: Array<{ placement: Placement; layerId: string; inputKey: string }> = [];
  const entries: Array<{
    placement: Placement;
    layer: ImageSlotLayer;
    signature: PerceptualSignature;
  }> = [];
  for (const placement of ["feed", "story"] as const) {
    const layout = placement === "feed" ? template.feedLayout : template.storyLayout;
    for (const layer of layout.layers) {
      if (layer.type !== "image_slot") continue;
      const bytes = imageValues[layer.inputKey];
      if (!bytes) {
        unresolved.push({ placement, layerId: layer.layerId, inputKey: layer.inputKey });
        continue;
      }
      entries.push({ placement, layer, signature: await perceptualSignature(bytes, layer.defaultCrop) });
    }
  }
  const duplicatePairs: NonNullable<RenderAuditReceipt["diagnostics"]>["imageSlots"]["duplicatePairs"] = [];
  for (const placement of ["feed", "story"] as const) {
    const placementEntries = entries.filter((entry) => entry.placement === placement);
    for (let firstIndex = 0; firstIndex < placementEntries.length; firstIndex += 1) {
      const first = placementEntries[firstIndex]!;
      for (let secondIndex = firstIndex + 1; secondIndex < placementEntries.length; secondIndex += 1) {
        const second = placementEntries[secondIndex]!;
        if (first.layer.inputKey === second.layer.inputKey) continue;
        const hammingDistance = hamming(first.signature.dHash64, second.signature.dHash64);
        const pixelSimilarity = rounded(pixelSimilarityScore(first.signature.rgb, second.signature.rgb));
        if (hammingDistance <= DUPLICATE_MAXIMUM_HAMMING_DISTANCE && pixelSimilarity >= DUPLICATE_MINIMUM_PIXEL_SIMILARITY) {
          duplicatePairs.push({
            placement,
            firstLayerId: first.layer.layerId,
            firstInputKey: first.layer.inputKey,
            secondLayerId: second.layer.layerId,
            secondInputKey: second.layer.inputKey,
            hammingDistance,
            pixelSimilarity,
          });
        }
      }
    }
  }
  return {
    unresolved,
    perceptualHashes: entries.map(({ placement, layer, signature }) => ({
      placement,
      layerId: layer.layerId,
      inputKey: layer.inputKey,
      dHash64: signature.dHash64.toString(16).padStart(16, "0"),
    })),
    duplicatePairs,
    thresholds: {
      maximumHammingDistance: DUPLICATE_MAXIMUM_HAMMING_DISTANCE,
      minimumPixelSimilarity: DUPLICATE_MINIMUM_PIXEL_SIMILARITY,
    },
  };
}

async function compareSourceMacro(source: Buffer, outputs: Record<Placement, RenderOutput>): Promise<NonNullable<RenderAuditReceipt["sourceMacro"]>["comparisons"]> {
  const sourceSignature = await perceptualSignature(source);
  const comparisons = [];
  for (const placement of ["feed", "story"] as const) {
    const outputSignature = await perceptualSignature(outputs[placement].png);
    comparisons.push({
      placement,
      hammingDistance: hamming(sourceSignature.dHash64, outputSignature.dHash64),
      pixelSimilarity: rounded(pixelSimilarityScore(sourceSignature.rgb, outputSignature.rgb)),
    });
  }
  return comparisons;
}

async function perceptualSignature(bytes: Buffer, crop: Rect = { x: 0, y: 0, width: 1, height: 1 }): Promise<PerceptualSignature> {
  const image = await loadImage(bytes);
  const normalized = normalizeCrop(crop);
  const source = {
    x: normalized.x * image.width,
    y: normalized.y * image.height,
    width: normalized.width * image.width,
    height: normalized.height * image.height,
  };
  const rgbCanvas = createCanvas(32, 32);
  const rgbContext = rgbCanvas.getContext("2d");
  rgbContext.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, 32, 32);
  const rgba = rgbContext.getImageData(0, 0, 32, 32).data;
  const rgb = new Uint8Array(32 * 32 * 3);
  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < rgba.length; sourceIndex += 4) {
    rgb[targetIndex++] = rgba[sourceIndex] ?? 0;
    rgb[targetIndex++] = rgba[sourceIndex + 1] ?? 0;
    rgb[targetIndex++] = rgba[sourceIndex + 2] ?? 0;
  }
  const hashCanvas = createCanvas(9, 8);
  const hashContext = hashCanvas.getContext("2d");
  hashContext.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, 9, 8);
  const hashPixels = hashContext.getImageData(0, 0, 9, 8).data;
  let dHash64 = 0n;
  let bit = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = luminance(hashPixels, (y * 9 + x) * 4);
      const right = luminance(hashPixels, (y * 9 + x + 1) * 4);
      if (left > right) dHash64 |= 1n << bit;
      bit += 1n;
    }
  }
  return { dHash64, rgb };
}

function normalizeCrop(crop: Rect): Rect {
  const x = Math.min(1 - Number.EPSILON, Math.max(0, crop.x));
  const y = Math.min(1 - Number.EPSILON, Math.max(0, crop.y));
  return {
    x,
    y,
    width: Math.min(1 - x, Math.max(Number.EPSILON, crop.width)),
    height: Math.min(1 - y, Math.max(Number.EPSILON, crop.height)),
  };
}

function luminance(pixels: Uint8ClampedArray, index: number): number {
  return (pixels[index] ?? 0) * 0.299 + (pixels[index + 1] ?? 0) * 0.587 + (pixels[index + 2] ?? 0) * 0.114;
}

function pixelSimilarityScore(first: Uint8Array, second: Uint8Array): number {
  let squaredError = 0;
  for (let index = 0; index < first.length; index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    squaredError += difference * difference;
  }
  const normalizedRootMeanSquareError = Math.sqrt(squaredError / first.length) / 255;
  return Math.max(0, 1 - normalizedRootMeanSquareError);
}

function hamming(first: bigint, second: bigint): number {
  let value = first ^ second;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
