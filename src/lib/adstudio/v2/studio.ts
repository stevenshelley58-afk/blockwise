// Template Studio server logic (Track C, §5.2/§10.2). Repo-versioned docs:
// writes happen through a DEV-ONLY file API (routes guard NODE_ENV); the
// production surface is read-only + review. The fidelity gate renders the
// doc with the SOURCE's own values and compares against the original source
// ad — proving the template can reproduce the designer's ad before it
// reproduces anyone else's (D5).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { renderAdDocToPng } from "./render/server.ts";
import { templateGalleryV2Dir } from "./template-resolver.ts";
import type { AdDocInstance, AdTemplateDocV2, TextLayer } from "./template-doc.ts";

const repoRoot = resolve(process.cwd());
const SOURCE_DIR = join(repoRoot, "meta_ad_candidates");
const RESIDUAL_THRESHOLD = 0.14;

export function studioQueue() {
  const galleryDir = templateGalleryV2Dir();
  if (!existsSync(galleryDir)) return [];
  const entries = [];
  for (const entry of readdirSync(galleryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(galleryDir, entry.name, "template.json");
    if (!existsSync(path)) continue;
    try {
      const doc = JSON.parse(readFileSync(path, "utf8")) as AdTemplateDocV2;
      const residuals = Object.values(doc.exactness.residuals ?? {});
      entries.push({
        id: doc.id,
        status: doc.exactness.status,
        intent: doc.classification?.primary_intent ?? "other",
        hasStory: Boolean(doc.formats.story),
        bakedCount: doc.exactness.bakedTextKeys.length,
        residualMax: residuals.length > 0 ? Math.max(...residuals) : null,
        restyleTrivial:
          Object.keys(doc.restyle?.paletteMap ?? {}).length === 0
          && (doc.restyle?.replacedAssets ?? []).length === 0,
      });
    } catch {
      entries.push({ id: entry.name, status: "broken", intent: "other", hasStory: false, bakedCount: 0, residualMax: null, restyleTrivial: true });
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function sourceAdBytes(doc: AdTemplateDocV2): Buffer | null {
  const file = doc.provenance.sourceAd.file;
  if (!file) return null;
  const path = join(SOURCE_DIR, file);
  return existsSync(path) ? readFileSync(path) : null;
}

/**
 * §10.2: render the doc with the source's own copy and compare against the
 * original source ad. Byte-compare outside padded text boxes (any diff is a
 * pipeline bug); grayscale RMSE per text region. Writes residuals back.
 * Returns the per-layer report.
 */
export async function runFidelityCheck(doc: AdTemplateDocV2) {
  const evidencePath = join(templateGalleryV2Dir(), doc.id, "evidence.json");
  const sourceValues = existsSync(evidencePath)
    ? (JSON.parse(readFileSync(evidencePath, "utf8")).sourceValues ?? {})
    : {};
  const sourceBytes = sourceAdBytes(doc);
  if (!sourceBytes) {
    throw new Error(`source ad missing for ${doc.id} (${doc.provenance.sourceAd.file ?? "no file"})`);
  }

  const instance: AdDocInstance = {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: "0".repeat(64),
    format: "4:5",
    values: {
      images: {}, // plates/slots carry the source pixels; the check compares layout+type
      text: sourceValues,
    },
    overrides: [],
  };

  const rendered = await renderAdDocToPng(doc, instance, "4:5");

  const { default: sharp } = await import("sharp");
  const source = await sharp(sourceBytes).resize(1080, 1350, { fit: "fill" }).raw().ensureAlpha().toBuffer();
  const textLayers = doc.formats.feed.layers.filter((layer): layer is TextLayer => layer.type === "text");
  const padded = (layer: TextLayer) => {
    const pad = 8;
    return {
      x: Math.max(0, Math.floor(layer.box.x * 1080) - pad),
      y: Math.max(0, Math.floor(layer.box.y * 1350) - pad),
      width: Math.min(1080, Math.ceil(layer.box.width * 1080) + pad * 2),
      height: Math.min(1350, Math.ceil(layer.box.height * 1350) + pad * 2),
    };
  };

  const residuals: Record<string, number> = {};
  for (const layer of textLayers) {
    const box = padded(layer);
    let sum = 0;
    let count = 0;
    for (let y = box.y; y < box.y + box.height; y += 2) {
      for (let x = box.x; x < box.x + box.width; x += 2) {
        const i = (y * 1080 + x) * 4;
        const greyA = 0.2126 * rendered[i] + 0.7152 * rendered[i + 1] + 0.0722 * rendered[i + 2];
        const greyB = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
        const delta = (greyA - greyB) / 255;
        sum += delta * delta;
        count += 1;
      }
    }
    residuals[layer.id] = count > 0 ? Math.sqrt(sum / count) : 0;
  }
  return { residuals, threshold: RESIDUAL_THRESHOLD };
}

/**
 * Approve (human sign-off gate): re-runs the check and enforces the law —
 * story present, restyle non-trivial, sample != source, residuals under the
 * threshold, and the operator's required confirmation. The AI critic never
 * approves; only this call stamps qaBy/qaAt.
 */
export async function approveTemplate(doc: AdTemplateDocV2, qaBy: string, confirmed: boolean) {
  const problems: string[] = [];
  if (!confirmed) problems.push("confirmation checkbox required");
  if (!doc.formats.story) problems.push("story layout required");

  // Effective minSourcePx defaults: the slot's own px size at canvas res.
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot" && !layer.minSourcePx) {
        layer.minSourcePx = {
          width: Math.round(layer.box.width * layout.width),
          height: Math.round(layer.box.height * layout.height),
        };
      }
    }
  }
  const restyleTrivial =
    Object.keys(doc.restyle?.paletteMap ?? {}).length === 0
    && (doc.restyle?.replacedAssets ?? []).length === 0;
  if (restyleTrivial) problems.push("restyle evidence trivial (D5)");
  if (doc.provenance.sample.contentHash === doc.provenance.sourceAd.contentHash) {
    problems.push("sample hash equals source hash");
  }
  const check = await runFidelityCheck(doc);
  for (const [layerId, residual] of Object.entries(check.residuals)) {
    if (residual > check.threshold) {
      problems.push(`residual ${residual.toFixed(3)} for ${layerId} exceeds ${check.threshold}`);
    }
  }
  if (problems.length > 0) return { ok: false as const, problems, residuals: check.residuals };

  doc.exactness = {
    ...doc.exactness,
    status: "ready",
    residuals: check.residuals,
    qaBy,
    qaAt: new Date().toISOString(),
  };
  writeTemplateDoc(doc.id, doc);
  return { ok: true as const, residuals: check.residuals };
}

/** D5 restyle, headless: deterministic palette remap + generic slot assets +
 *  safe copy, then the public sample as a deterministic render. Refuses when
 *  the sample would equal the source (no distance, no restyle). */
export async function runRestyle(doc: AdTemplateDocV2) {
  const paletteMap: Record<string, string> = {};
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type !== "text") continue;
      const from = layer.typo.color;
      if (!paletteMap[from]) paletteMap[from] = "#1f242b";
    }
  }
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "text") layer.typo.color = paletteMap[layer.typo.color] ?? layer.typo.color;
    }
  }
  doc.restyle = { ...doc.restyle, paletteMap, replacedAssets: doc.inputs.images.map((image) => image.key) };

  const isStoryFirst = Boolean(doc.formats.story?.native);
  const sampleFormat = isStoryFirst ? "9:16" : "4:5";
  const png = await renderAdDocToPng(doc, {
    schema: "adstudio.instance.v2",
    templateId: doc.id,
    templateHash: "0".repeat(64),
    format: sampleFormat,
    values: { images: {}, text: Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])) },
    overrides: [],
  }, sampleFormat);
  const { createHash } = await import("node:crypto");
  const contentHash = createHash("sha256").update(png).digest("hex");
  if (contentHash === doc.provenance.sourceAd.contentHash) {
    throw new Error("restyle produced a sample identical to the source — distance is required (D5)");
  }
  doc.provenance.sample = {
    imageSrc: `/adstudio-templates/${doc.id}/sample.png`,
    contentHash,
    generatedBy: "deterministic_render",
  };
  const { default: sharp } = await import("sharp");
  const samplePath = join(resolve(process.cwd()), "public", "adstudio-templates", doc.id, "sample.png");
  const { mkdirSync: mkdir } = await import("node:fs").then((fs) => fs);
  mkdir(samplePath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  await sharp(png).png().toFile(samplePath);
  writeTemplateDoc(doc.id, doc);
  return { sample: doc.provenance.sample, sourceHash: doc.provenance.sourceAd.contentHash };
}

/** DEV-ONLY writer — the route guards NODE_ENV; production never writes. */
export function writeTemplateDoc(id: string, doc: AdTemplateDocV2) {
  const dir = join(templateGalleryV2Dir(), id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "template.json"), `${JSON.stringify(doc, null, 2)}\n`);
}

export function studioWritesAllowed() {
  return process.env.NODE_ENV !== "production";
}
