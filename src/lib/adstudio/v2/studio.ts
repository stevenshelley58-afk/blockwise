// Template Studio server logic (Track C, §5.2/§10.2). Repo-versioned docs:
// writes happen through a DEV-ONLY file API (routes guard NODE_ENV); the
// production surface is read-only + review. The fidelity gate renders the
// doc with the SOURCE's own values and compares against the original source
// ad — proving the template can reproduce the designer's ad before it
// reproduces anyone else's (D5).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  fidelityTemplateHash,
  runNativeSurfaceFidelity,
  runStressMatrix,
} from "./fidelity-stress.ts";
import { buildRestyleSampleRenderInput } from "./restyle-assets.ts";
import { renderAdDocToPng } from "./render/server.ts";
import { hashCanonicalJson } from "./template-hash.ts";
import { snapshotTemplateBeforeWrite } from "./template-history.ts";
import { templateGalleryV2Dir } from "./template-resolver.ts";
import { hasNonTrivialRestyle, normalizeCanonicalJson, templateDocV2Schema, type AdTemplateDocV2, type TextLayer } from "./template-doc.ts";

const SOURCE_DIR = join(process.cwd(), "meta_ad_candidates");
const PUBLIC_DIR = join(process.cwd(), "public");
const V1_GALLERY_DIR = join(process.cwd(), "src", "lib", "adstudio", "template-gallery");
const PRIVATE_TEMPLATE_ASSET_DIR = join(process.cwd(), "src", "lib", "adstudio", "template-assets-v2");
const RESIDUAL_THRESHOLD = 0.14;
const OPERATOR_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPERATOR_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PUBLIC_ASSET = /^\/adstudio-safe-assets\/[a-z0-9-]+\.webp$/;

export type TemplateReviewer = { userId: string; email: string };

type TemplateEvidence = {
  sourceValues?: Record<string, string>;
  sourceCuration?: {
    accepted: boolean;
    reviewerUserId: string;
    reviewerEmail: string;
    reviewedAt: string;
    classification: AdTemplateDocV2["classification"];
    rationale: string;
  };
  [key: string]: unknown;
};

function evidencePathFor(doc: Pick<AdTemplateDocV2, "id">): string {
  return join(templateGalleryV2Dir(), doc.id, "evidence.json");
}

function evidenceFor(doc: Pick<AdTemplateDocV2, "id">): TemplateEvidence {
  const path = evidencePathFor(doc);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as TemplateEvidence : {};
}

function editableTextKeys(doc: AdTemplateDocV2): string[] {
  const baked = new Set(doc.exactness.bakedTextKeys);
  return doc.inputs.text.map((input) => input.key).filter((key) => !baked.has(key));
}

function sourceValuesFor(doc: AdTemplateDocV2): Record<string, string> {
  const sourceValues = evidenceFor(doc).sourceValues ?? {};
  for (const key of editableTextKeys(doc)) {
    if (typeof sourceValues[key] !== "string" || sourceValues[key].trim().length === 0) {
      throw new Error(`sourceValues.${key} must contain the source ad's visible text before fidelity can run`);
    }
  }
  return sourceValues;
}

function sourceCurationProblem(doc: AdTemplateDocV2): string | null {
  const curation = evidenceFor(doc).sourceCuration;
  if (!curation?.accepted
    || !OPERATOR_USER_ID.test(curation.reviewerUserId ?? "")
    || !OPERATOR_EMAIL.test(curation.reviewerEmail ?? "")
    || typeof curation.reviewedAt !== "string"
    || Number.isNaN(Date.parse(curation.reviewedAt))
    || !curation.classification
    || !String(curation.rationale ?? "").trim()) {
    return "ready requires accepted source curation with authenticated reviewer, timestamp, classification, and rationale";
  }
  if (normalizeCanonicalJson(curation.classification) !== normalizeCanonicalJson(doc.classification)) {
    return "source curation classification does not match template classification";
  }
  return null;
}

function sourceCurationFor(doc: AdTemplateDocV2) {
  const curation = evidenceFor(doc).sourceCuration;
  if (!curation) throw new Error("source curation evidence is missing");
  return curation;
}

export function sourceCurationStatus(doc: AdTemplateDocV2) {
  return evidenceFor(doc).sourceCuration ?? null;
}

export function recordSourceCuration(doc: AdTemplateDocV2, reviewer: TemplateReviewer, rationale: string) {
  if (!OPERATOR_USER_ID.test(reviewer.userId) || !OPERATOR_EMAIL.test(reviewer.email)) {
    throw new Error("source curation requires an authenticated operator identity");
  }
  if (!rationale.trim()) throw new Error("source curation requires a concise quality rationale");
  const path = evidencePathFor(doc);
  const evidence = evidenceFor(doc);
  const sourceCuration = {
    accepted: true,
    reviewerUserId: reviewer.userId,
    reviewerEmail: reviewer.email,
    reviewedAt: new Date().toISOString(),
    classification: doc.classification,
    rationale: rationale.trim(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...evidence, sourceCuration }, null, 2)}\n`);
  return sourceCuration;
}

function safeSampleCopyProblems(doc: AdTemplateDocV2): string[] {
  const sourceValues = sourceValuesFor(doc);
  const problems: string[] = [];
  for (const input of doc.inputs.text) {
    if (doc.exactness.bakedTextKeys.includes(input.key)) continue;
    if (!input.sample.trim()) problems.push(`safe sample copy for ${input.key} is blank`);
    if (input.sample.trim() === sourceValues[input.key]?.trim()) {
      problems.push(`safe sample copy for ${input.key} still equals the private source text`);
    }
  }
  return problems;
}

function safeReplacementAssetProblems(doc: AdTemplateDocV2): string[] {
  const problems: string[] = [];
  for (const asset of doc.restyle.safeReplacementAssets ?? []) {
    const path = join(PUBLIC_DIR, asset.src.replace(/^\//, ""));
    if (!existsSync(/* turbopackIgnore: true */ path)) {
      problems.push(`safe replacement asset missing: ${asset.src}`);
      continue;
    }
    const actual = createHash("sha256")
      .update(readFileSync(/* turbopackIgnore: true */ path))
      .digest("hex");
    if (actual !== asset.sha256) problems.push(`safe replacement asset hash mismatch: ${asset.src}`);
  }
  return problems;
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
  const sourceValues = sourceValuesFor(doc);
  const sourceBytes = sourceAdBytes(doc);
  if (!sourceBytes) {
    throw new Error(`source ad missing for ${doc.id} (${doc.provenance.sourceAd.file ?? "no file"})`);
  }
  const result = await runNativeSurfaceFidelity(doc, { sourceBytes, sourceValues });
  return {
    residuals: result.residuals,
    threshold: RESIDUAL_THRESHOLD,
    residualEvidence: result,
  };
}
/**
 * Approve (human sign-off gate): re-runs the check and enforces the law —
 * story present, restyle non-trivial, sample != source, residuals under the
 * threshold, and the operator's required confirmation bound to the exact
 * fidelity and stress hashes they inspected. The AI critic never approves.
 */
export async function approveTemplate(
  doc: AdTemplateDocV2,
  reviewer: TemplateReviewer,
  confirmation: { confirmed: boolean; templateHash?: string; stressMatrixHash?: string },
) {
  const problems: string[] = [];
  if (!confirmation.confirmed) problems.push("confirmation checkbox required");
  if (!OPERATOR_USER_ID.test(reviewer.userId) || !OPERATOR_EMAIL.test(reviewer.email)) {
    problems.push("approval requires the authenticated operator user ID and email");
  }
  if (!doc.formats.story) problems.push("story layout required");
  if (editableTextKeys(doc).length === 0) problems.push("ready requires at least one customer-visible editable text field");
  if (doc.exactness.bakedTextKeys.length > 0) problems.push("ready cannot expose source text as baked pixels");

  // Image quality is a template authoring decision, not something approval
  // silently repairs after the reviewer has inspected a different document.
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      if (layer.type === "image_slot" && !layer.minSourcePx) {
        problems.push(`slot ${layer.id} requires minSourcePx before review`);
      }
    }
  }
  if (!hasNonTrivialRestyle(doc)) problems.push("public sample is missing hashed safe replacement assets");
  problems.push(...safeReplacementAssetProblems(doc));
  problems.push(...safeSampleCopyProblems(doc));
  const curationProblem = sourceCurationProblem(doc);
  if (curationProblem) problems.push(curationProblem);
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

  let check: Awaited<ReturnType<typeof runFidelityCheck>>;
  let stress: Awaited<ReturnType<typeof runStressMatrix>>;
  try {
    check = await runFidelityCheck(doc);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "fidelity check failed");
    return { ok: false as const, problems, residuals: {} };
  }
  for (const [layerId, residual] of Object.entries(check.residuals)) {
    if (residual > check.threshold) {
      problems.push(`residual ${residual.toFixed(3)} for ${layerId} exceeds ${check.threshold}`);
    }
  }
  try {
    stress = await runStressMatrix(doc);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "stress matrix failed");
    return { ok: false as const, problems, residuals: check.residuals };
  }
  if (confirmation.templateHash !== check.residualEvidence.templateHash) {
    problems.push("reviewed template hash is missing or stale; rerun Check in Studio");
  }
  if (confirmation.stressMatrixHash !== stress.hash) {
    problems.push("reviewed stress matrix hash is missing or stale; inspect the full Stress preview in Studio");
  }
  if (problems.length > 0) return { ok: false as const, problems, residuals: check.residuals };

  const reviewedAt = new Date().toISOString();
  const stressEvidence = {
    templateHash: stress.templateHash,
    checkedAt: reviewedAt,
    matrixHash: stress.hash,
    entries: stress.entries,
  };
  const sourceCuration = sourceCurationFor(doc);
  doc.exactness = {
    ...doc.exactness,
    status: "ready",
    residuals: check.residuals,
    residualEvidence: check.residualEvidence,
    stressEvidence,
    reviewEvidence: {
      reviewerUserId: reviewer.userId,
      reviewerEmail: reviewer.email,
      reviewedAt,
      confirmation: "inspected-at-100-percent",
      templateHash: check.residualEvidence.templateHash,
      sourceContentHash: doc.provenance.sourceAd.contentHash,
      sampleContentHash: doc.provenance.sample.contentHash,
      sourceCurationHash: hashCanonicalJson(sourceCuration),
      fidelityEvidenceHash: hashCanonicalJson(check.residualEvidence),
      stressEvidenceHash: hashCanonicalJson(stressEvidence),
    },
  };
  writeTemplateDoc(doc.id, doc);
  return { ok: true as const, residuals: check.residuals, stressMatrixHash: stress.hash };
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

  const v1 = JSON.parse(readFileSync(join(V1_GALLERY_DIR, `${doc.id}.json`), "utf8"));
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
    const sourceBytes = readFileSync(join(SOURCE_DIR, doc.provenance.sourceAd.file));
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
      const currentPlate = readFileSync(join(PRIVATE_TEMPLATE_ASSET_DIR, doc.id, layout === doc.formats.feed ? "plate-feed.webp" : "plate-story.webp"));
      // Preserve the recorded restyle plate remap: re-apply it to the baked
      // cut before compositing (runRestyle recorded it verbatim).
      const cut = await sharp(sourceLayout).composite([{ input: maskSvg, blend: "dest-in" }]).png().toBuffer();
      const hueShift = doc.restyle?.plateRemap?.hue ?? 0;
      const bakedCut = hueShift
        ? await sharp(cut).modulate({ hue: hueShift }).png().toBuffer()
        : cut;
      const rebuilt = await sharp(currentPlate).composite([{ input: bakedCut, blend: "over" }]).webp({ lossless: true }).toBuffer();
      const plateFile = layout === doc.formats.feed ? "plate-feed.webp" : "plate-story.webp";
      const platePath = join(PRIVATE_TEMPLATE_ASSET_DIR, doc.id, plateFile);
      write(platePath, rebuilt);
      layout.plate.sha256 = (await import("node:crypto")).createHash("sha256").update(rebuilt).digest("hex");
    }
  }
  writeTemplateDoc(doc.id, doc);
  return { baked: doc.exactness.bakedTextKeys };
}

/**
 * Build the safe public sample through the same deterministic renderer that
 * customers use. It preserves the source design; distance comes from explicit
 * safe copy and verified replacement photos, never a mandatory hue gimmick.
 */
export async function runRestyle(
  doc: AdTemplateDocV2,
  input: { text: Record<string, string>; assets: Record<string, string> },
) {
  const sourceValues = sourceValuesFor(doc);
  for (const field of doc.inputs.text) {
    const value = input.text[field.key];
    if (typeof value !== "string" || (field.required && !value.trim())) {
      throw new Error(`safe sample copy is required for ${field.key}`);
    }
    if (value.length > field.maxLength) {
      throw new Error(`safe sample copy for ${field.key} exceeds ${field.maxLength} characters`);
    }
    if (!doc.exactness.bakedTextKeys.includes(field.key) && value.trim() === sourceValues[field.key]?.trim()) {
      throw new Error(`safe sample copy for ${field.key} must differ from the private source text`);
    }
    field.sample = value;
  }

  const safeReplacementAssets = doc.inputs.images.map((field) => {
    const src = input.assets[field.key];
    if (!src || !SAFE_PUBLIC_ASSET.test(src)) {
      throw new Error(`choose a verified safe replacement photo for ${field.key}`);
    }
    const path = join(PUBLIC_DIR, src.slice(1));
    if (!existsSync(/* turbopackIgnore: true */ path)) {
      throw new Error(`safe replacement asset missing: ${src}`);
    }
    return {
      inputKey: field.key,
      src,
      sha256: createHash("sha256")
        .update(readFileSync(/* turbopackIgnore: true */ path))
        .digest("hex"),
    };
  });
  doc.restyle = {
    ...doc.restyle,
    paletteMap: Object.fromEntries(Object.entries(doc.restyle.paletteMap).filter(([from, to]) => from !== to)),
    replacedAssets: doc.inputs.images.map((field) => field.key),
    safeReplacementAssets,
    note: "Public sample uses operator-supplied safe copy and hash-verified synthetic replacement photography.",
  };
  doc.exactness = {
    status: "qa",
    residuals: {},
    bakedTextKeys: [...doc.exactness.bakedTextKeys],
  };

  const isStoryFirst = Boolean(doc.formats.story?.native);
  const sampleFormat = isStoryFirst ? "9:16" : "4:5";
  const renderInput = buildRestyleSampleRenderInput({ doc, format: sampleFormat, text: input.text });
  const png = await renderAdDocToPng(doc, renderInput.instance, sampleFormat, { slotBytes: renderInput.slotBytes });
  const contentHash = createHash("sha256").update(png).digest("hex");
  if (contentHash === doc.provenance.sourceAd.contentHash) {
    throw new Error("restyle produced a sample identical to the source — distance is required (D5)");
  }
  doc.provenance.sample = {
    imageSrc: `/adstudio-templates/${doc.id}/sample.png`,
    contentHash,
    generatedBy: "deterministic_render",
  };
  const samplePath = join(PUBLIC_DIR, "adstudio-templates", doc.id, "sample.png");
  const sampleDir = dirname(samplePath);
  mkdirSync(/* turbopackIgnore: true */ sampleDir, { recursive: true });
  // Write the render bytes verbatim: the declared hash is sha(png), so any
  // re-encode would break the identity contract.
  writeFileSync(/* turbopackIgnore: true */ samplePath, png);
  writeTemplateDoc(doc.id, doc);
  return { sample: doc.provenance.sample, sourceHash: doc.provenance.sourceAd.contentHash };
}

/** DEV-ONLY writer — the route guards NODE_ENV; production never writes. */
export function writeTemplateDoc(id: string, doc: AdTemplateDocV2) {
  const parsed = templateDocV2Schema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`refusing to write invalid template ${id}: ${parsed.error.issues[0]?.message}`);
  }
  if (parsed.data.id !== id) throw new Error(`refusing to write ${parsed.data.id} into ${id}`);
  const dir = join(templateGalleryV2Dir(), id);
  mkdirSync(dir, { recursive: true });
  snapshotTemplateBeforeWrite(dir, parsed.data);
  const target = join(dir, "template.json");
  const temporary = join(dir, `.template.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(parsed.data, null, 2)}\n`, { flag: "wx" });
  try {
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function studioWritesAllowed() {
  return process.env.NODE_ENV !== "production";
}
