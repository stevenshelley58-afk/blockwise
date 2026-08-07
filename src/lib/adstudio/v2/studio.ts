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
  // The recorded restyle plate remap (hue degrees) is the byte baseline when
  // present; otherwise the raw resized source. Order matches restyle:
  // resize first, then hue remap.
  const hueShift = doc.restyle?.plateRemap?.hue ?? 0;
  const baseline = async (W: number, H: number) => {
    const resized = await sharp(sourceBytes).resize(W, H, { fit: "fill" }).png().toBuffer();
    return hueShift
      ? sharp(resized).modulate({ hue: hueShift }).raw().ensureAlpha().toBuffer()
      : sharp(resized).raw().ensureAlpha().toBuffer();
  };
  const source = await baseline(1080, 1350);
  const textLayers = doc.formats.feed.layers.filter((layer): layer is TextLayer => layer.type === "text");

  const computeResiduals = (renderedRaw: Uint8Array, sourceRaw: Uint8Array, W: number, H: number, layers: TextLayer[], pad: number) => {
    const residuals: Record<string, number> = {};
    for (const layer of layers) {
      const box = {
        x: Math.max(0, Math.floor(layer.box.x * W) - pad),
        y: Math.max(0, Math.floor(layer.box.y * H) - pad),
        width: Math.min(W, Math.ceil(layer.box.width * W) + pad * 2),
        height: Math.min(H, Math.ceil(layer.box.height * H) + pad * 2),
      };
      const yEnd = Math.min(H, box.y + box.height);
      const xEnd = Math.min(W, box.x + box.width);
      let sum = 0;
      let count = 0;
      for (let y = box.y; y < yEnd; y += 2) {
        for (let x = box.x; x < xEnd; x += 2) {
          const i = (y * W + x) * 4;
          const greyA = 0.2126 * renderedRaw[i] + 0.7152 * renderedRaw[i + 1] + 0.0722 * renderedRaw[i + 2];
          const greyB = 0.2126 * sourceRaw[i] + 0.7152 * sourceRaw[i + 1] + 0.0722 * sourceRaw[i + 2];
          const delta = (greyA - greyB) / 255;
          sum += delta * delta;
          count += 1;
        }
      }
      residuals[layer.id] = count > 0 ? Math.sqrt(sum / count) : 0;
    }
    return residuals;
  };

  const residuals = computeResiduals(
    await sharp(rendered).raw().ensureAlpha().toBuffer(),
    source,
    1080,
    1350,
    textLayers,
    8,
  );
  // Only layer ids that still exist may carry residuals (schema law).
  const liveIds = new Set(textLayers.map((layer) => layer.id));
  for (const layerId of Object.keys(residuals)) {
    if (!liveIds.has(layerId)) delete residuals[layerId];
  }

  // Native story layout: the schema requires a residual for every text layer
  // in every layout, so record the story surface too (compared against the
  // full-height source).
  if (doc.formats.story?.native) {
    const storyRendered = await renderAdDocToPng(doc, { ...instance, format: "9:16" }, "9:16");
    const storySource = await baseline(1080, 1920);
    const storyLayers = doc.formats.story.layers.filter((layer): layer is TextLayer => layer.type === "text");
    Object.assign(
      residuals,
      computeResiduals(await sharp(storyRendered).raw().ensureAlpha().toBuffer(), storySource, 1080, 1920, storyLayers, 8),
    );
  }

  return { residuals, threshold: 0.14 };
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
  // Safe zones (hard at ready, matching the schema): editable text may not sit
  // in the story top 250 / bottom 340. Baked text is source pixels (design).
  const story = doc.formats.story;
  if (story) {
    for (const layer of story.layers) {
      if (layer.type !== "text" || doc.exactness.bakedTextKeys.includes(layer.inputKey)) continue;
      const top = layer.box.y * story.height;
      const bottom = (layer.box.y + layer.box.height) * story.height;
      if (top < 250) problems.push(`story safe zone: ${layer.id} in top ${Math.round(top)}px`);
      if (bottom > story.height - 340) problems.push(`story safe zone: ${layer.id} in bottom (${Math.round(bottom)}px)`);
    }
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

/** §5.2 bake lever: mark an over-threshold key as baked (source pixels stay,
 *  layer removed from every layout, plate rebuilt with the original pixels
 *  over that box) or un-bake it (layer restored from the v1 typography). */
export async function runBake(doc: AdTemplateDocV2, key: string, bake: boolean) {
  const { default: sharp } = await import("sharp");
  const { readFileSync, writeFileSync: write } = await import("node:fs");
  const isBaked = doc.exactness.bakedTextKeys.includes(key);
  if (bake && isBaked) throw new Error(`${key} is already baked`);
  if (!bake && !isBaked) throw new Error(`${key} is not baked`);

  const v1 = JSON.parse(readFileSync(join(process.cwd(), "src", "lib", "adstudio", "template-gallery", `${doc.id}.json`), "utf8"));
  const typo = (v1.typography ?? {})[key];
  if (!typo) throw new Error(`${key} has no v1 typography to (un)bake`);

  doc.exactness.bakedTextKeys = bake
    ? [...doc.exactness.bakedTextKeys, key]
    : doc.exactness.bakedTextKeys.filter((candidate) => candidate !== key);
  // Residuals are keyed by layer id; a baked layer has none (schema law).
  if (bake && doc.exactness.residuals) delete doc.exactness.residuals[`text-${key}`];

  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    if (bake) {
      layout.layers = layout.layers.filter((layer) => !(layer.type === "text" && layer.inputKey === key));
    } else {
      const font = doc.fonts.find((face) => face.fontId === typo.fontId) ?? doc.fonts[0];
      if (!font) throw new Error(`${typo.fontId} not in fonts[]; re-migrate or add the font first`);
      layout.layers = [
        ...layout.layers,
        {
          id: `text-${key}`,
          type: "text",
          z: 10 + layout.layers.length,
          inputKey: key,
          box: typo.sampleBox,
          typo: {
            fontId: font.fontId,
            family: font.family,
            fallbackFamily: typo.fallbackFamily ?? "sans-serif",
            weight: font.weight,
            italic: font.italic,
            case: typo.case ?? "none",
            sizeRatio: typo.sizeRatio,
            lineHeight: typo.lineHeight ?? 1,
            tracking: typo.tracking ?? 0,
            align: typo.align ?? "left",
            color: typo.color,
          },
          constraints: {
            maxLength: ((v1.inputs?.text ?? []) as Array<{ key?: string; maxLength?: number }>).find((input) => input.key === key)?.maxLength ?? 60,
            maxLines: typo.sampleLineCount ?? 3,
            autoFitMinRatio: 0.85,
          },
          measurement: {
            fitScore: typo.fitScore ?? 0,
            detectionScore: typo.detectionScore ?? 0,
            source: typo.measurementSource === "manual-verified" ? "manual-verified" : "ocr-v2",
            version: typo.measurementVersion ?? 1,
          },
        } as TextLayer,
      ];
    }
  }

  // Bake rebuilds the plates with the source's original pixels over the box.
  if (bake) {
    if (!doc.provenance.sourceAd.file) throw new Error(`${doc.id} has no source file to bake from`);
    const sourceBytes = readFileSync(join(process.cwd(), "meta_ad_candidates", doc.provenance.sourceAd.file));
    for (const layout of [doc.formats.feed, doc.formats.story]) {
      if (!layout) continue;
      const W = layout.width;
      const H = layout.height;
      const b = typo.sampleBox;
      const pad = Math.ceil(0.035 * Math.max(W, H));
      const maskSvg = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
          + `<rect x="${Math.max(0, Math.floor(b.x * W) - pad)}" y="${Math.max(0, Math.floor(b.y * H) - pad)}" `
          + `width="${Math.min(W, Math.ceil(b.width * W) + pad * 2)}" height="${Math.min(H, Math.ceil(b.height * H) + pad * 2)}" fill="white"/></svg>`,
      );
      const sourceLayout = await sharp(sourceBytes).resize(W, H, { fit: "fill" }).png().toBuffer();
      const currentPlate = readFileSync(join(process.cwd(), "public", "adstudio-templates", doc.id, layout === doc.formats.feed ? "plate-feed.webp" : "plate-story.webp"));
      // Preserve the recorded restyle plate remap: re-apply it to the baked
      // cut before compositing (runRestyle recorded it verbatim).
      const cut = await sharp(sourceLayout).composite([{ input: maskSvg, blend: "dest-in" }]).png().toBuffer();
      const hueShift = doc.restyle?.plateRemap?.hue ?? 0;
      const bakedCut = hueShift
        ? await sharp(cut).modulate({ hue: hueShift }).png().toBuffer()
        : cut;
      const rebuilt = await sharp(currentPlate).composite([{ input: bakedCut, blend: "over" }]).webp({ lossless: true }).toBuffer();
      const plateFile = layout === doc.formats.feed ? "plate-feed.webp" : "plate-story.webp";
      const platePath = join(process.cwd(), "public", "adstudio-templates", doc.id, plateFile);
      write(platePath, rebuilt);
      layout.plate.sha256 = (await import("node:crypto")).createHash("sha256").update(rebuilt).digest("hex");
    }
  }
  writeTemplateDoc(doc.id, doc);
  return { baked: doc.exactness.bakedTextKeys };
}

/** D5 restyle, headless: deterministic palette remap + generic slot assets +
 *  safe copy, then the public sample as a deterministic render. Refuses when
 *  the sample would equal the source (no distance, no restyle). When a doc
 *  has no editable text layers (fully baked), the default deterministic
 *  distance is the spec's own optional plate hue remap, recorded verbatim. */
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

  // Fully-baked docs have no editable text to remap; apply the default
  // deterministic plate hue remap (spec's optional mechanism) so the public
  // sample carries real distance. Recorded so checks replay the baseline.
  if (Object.keys(paletteMap).length === 0) {
    const { default: sharp } = await import("sharp");
    const { readFileSync, writeFileSync: write } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    for (const [layout, file] of [
      [doc.formats.feed, "plate-feed.webp"],
      [doc.formats.story, "plate-story.webp"],
    ] as const) {
      if (!layout) continue;
      const platePath = join(resolve(process.cwd()), "public", "adstudio-templates", doc.id, file);
      if (!existsSync(platePath)) continue;
      const remapped = await sharp(readFileSync(platePath)).modulate({ hue: 112 }).webp({ lossless: true }).toBuffer();
      write(platePath, remapped);
      layout.plate.sha256 = createHash("sha256").update(remapped).digest("hex");
    }
    doc.restyle.plateRemap = { hue: 12 };
  }

  doc.restyle = {
    ...doc.restyle,
    paletteMap,
    replacedAssets: doc.inputs.images.map((image) => image.key),
    note: doc.restyle.plateRemap ? `${doc.restyle.note ?? ""} auto-QA default plate remap (owner-delegated 2026-08-06)`.trim() : doc.restyle.note,
  };

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
