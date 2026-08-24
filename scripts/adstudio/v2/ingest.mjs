#!/usr/bin/env node

// AdStudio v2 ingestion CLI (Track C, §5). Build-time only — operator/dev
// machine/VPS, never Vercel. Subcommands:
//
//   analyse --source <path> --id <id>
//   decompose --id <id> [--inpainted <path>]
//                                (gpt-image-2 masked text-region cleanup, or
//                                 a supplied text-free reconstruction; only
//                                 declared masks are composited into the source)
//   restyle --id <id>           (disabled: complete safe assets + copy in Studio)
//   story-draft --id <id>        (deterministic sharp band-extend)
//   check --id <id>              (fidelity gate, §10.2)
//   migrate-v1 --id <id> | --all [--from source|sample]
//
// migrate-v1 converts v1 gallery docs to v2 drafts: typography -> text
// layers (measuredLines carried), imageBoxes -> slots, meta -> publish
// block. Fully deterministic: running it twice yields identical output.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = process.cwd();
// Env-overridable so tests run against a scratch copy (idempotence test is
// hermetic — never races the live gallery or the batch pipeline).
const v1Gallery = resolve(process.env.ADSTUDIO_V1_GALLERY ?? join(root, "src", "lib", "adstudio", "template-gallery"));
const v2Gallery = resolve(process.env.ADSTUDIO_V2_GALLERY ?? process.env.ADSTUDIO_GALLERY_V2_DIR ?? join(root, "src", "lib", "adstudio", "template-gallery-v2"));
// Shared v2 helpers resolve the gallery through this canonical variable. Keep
// the legacy ingest override working while ensuring every command addresses
// the same document directory.
process.env.ADSTUDIO_GALLERY_V2_DIR ??= v2Gallery;
const privateV2 = resolve(
  process.env.ADSTUDIO_PRIVATE_V2
    ?? join(root, "src", "lib", "adstudio", "template-assets-v2"),
);
const fontManifestPath = join(root, "public", "fonts", "adstudio", "manifest.json");
const fontManifest = existsSync(fontManifestPath)
  ? JSON.parse(readFileSync(fontManifestPath, "utf8"))
  : { faces: [] };
const fontByFile = new Map((fontManifest.faces ?? []).map((face) => [face.file, face]));
const manifestFaces = fontManifest.faces ?? [];

// v1 referenced fonts the runtime corpus never shipped (source-sans-3 is in
// the manifest's EXCLUDED list). Migration remaps to the nearest available
// family, recorded in evidence.json; the Studio's font picker makes the final
// call at QA. The renderer resolves families by fontId alias (case-insensitive),
// so family must be the manifest face's own family after a remap.
const FONT_REMAP = { "source-sans-3": "arimo" };
const FALLBACK_FAMILY = {
  "sans-serif": "arimo",
  serif: "noto-serif",
  monospace: "roboto-mono",
  cursive: "noto-serif",
};

function pickAvailableFace(fontId, weight, italic) {
  const candidates = manifestFaces.filter((face) => face.fontId === fontId);
  if (candidates.length === 0) return null;
  const sameStyle = candidates.filter((face) => Boolean(face.italic) === Boolean(italic));
  const pool = sameStyle.length > 0 ? sameStyle : candidates;
  return pool.reduce((best, face) =>
    Math.abs(face.weight - weight) < Math.abs(best.weight - weight) ? face : best,
  );
}

function resolveFont(fontId, family, weight, italic, fallbackFamily, remaps) {
  const existing = manifestFaces.find((face) => face.fontId === fontId && face.weight === weight && Boolean(face.italic) === Boolean(italic));
  if (existing) return { fontId, family, weight, italic, file: existing.file, sha256: existing.sha256 };
  // Family exists but not at this weight/style: ship the nearest weight of
  // the SAME family (the layer and fonts[] stay consistent), recorded.
  const familyFaces = manifestFaces.filter((face) => face.fontId === fontId && Boolean(face.italic) === Boolean(italic));
  if (familyFaces.length > 0) {
    const nearest = familyFaces.reduce((best, face) =>
      Math.abs(face.weight - weight) < Math.abs(best.weight - weight) ? face : best,
    );
    remaps.push(`${fontId}@${weight} -> ${nearest.fontId}@${nearest.weight}`);
    return { fontId: nearest.fontId, family: nearest.family, weight: nearest.weight, italic: Boolean(nearest.italic), file: nearest.file, sha256: nearest.sha256 };
  }
  const target = FONT_REMAP[fontId] ?? FALLBACK_FAMILY[fallbackFamily] ?? "arimo";
  const face = pickAvailableFace(target, weight, italic);
  if (!face) {
    return { fontId, family, weight, italic, file: `/fonts/adstudio/${fontId}-${weight}.woff2`, sha256: "0".repeat(64) };
  }
  remaps.push(`${fontId} -> ${face.fontId}`);
  return { fontId: face.fontId, family: face.family, weight: face.weight, italic: Boolean(face.italic), file: face.file, sha256: face.sha256 };
}

// Mirrors META_CREATIVE_FEATURE_KEYS in src/lib/providers/meta-execution.ts —
// keep the two lists in lockstep (the v2 verify gate cross-checks coverage).
const CREATIVE_FEATURE_KEYS = [
  "adapt_to_placement", "image_touchups", "image_templates", "inline_comment",
  "enhance_cta", "text_optimizations", "image_animation", "image_background_gen",
  "video_auto_crop", "translate_voiceover", "text_translation", "media_type_automation",
  "product_extensions",
];

const args = process.argv.slice(2);
const command = args[0];

function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ── migrate-v1 ─────────────────────────────────────────────────────────────

function v1ToV2(v1, id, from) {
  const formats = {};
  const isStory = v1.format === "9:16";
  const layout = {
    format: isStory ? "9:16" : "4:5",
    width: 1080,
    height: isStory ? 1920 : 1350,
    plate: { src: `/adstudio-templates/${id}/plate-${isStory ? "story" : "feed"}.webp`, sha256: "0".repeat(64) },
    layers: [],
  };

  let z = 1;
  for (const [key, box] of Object.entries(v1.deterministicEditing?.imageBoxes ?? {})) {
    layout.layers.push({
      id: `slot-${key}`,
      type: "image_slot",
      z: (z += 1),
      inputKey: key,
      fit: "cover",
      box,
      mask: { kind: "rect" },
    });
  }
  const textInputs = [];
  const bakedKeys = [];
  for (const [key, typo] of Object.entries(v1.typography ?? {})) {
    const maxLength = v1.inputs?.text?.find((input) => input.key === key)?.maxLength ?? 60;
    textInputs.push({
      key,
      label: v1.inputs?.text?.find((input) => input.key === key)?.label ?? key,
      required: true,
      maxLength,
      sample: v1.inputs?.text?.find((input) => input.key === key)?.sample ?? "",
    });
    // Migration runs BEFORE any inpaint: the text is still the source
    // designer's pixels in the plate, so it is BAKED — no editable layer
    // (§0 escape hatch). The Studio's decompose pass inpaints the plate and
    // re-adds the layer, unbaking the key. Typography still lands in
    // evidence.json for the fidelity gate.
    bakedKeys.push(key);
  }

  const fontRemaps = [];
  // One entry per (fontId, weight, italic) the layers actually use — the
  // schema requires every layer typo to resolve against fonts[].
  const fonts = [...new Map(Object.values(v1.typography ?? {}).map((typo) => [
    `${typo.fontId}@${typo.weight}@${Boolean(typo.italic)}`,
    typo,
  ])).values()].map((typo) => {
    return resolveFont(
      typo.fontId,
      typo.family ?? typo.fontId,
      typo.weight ?? 400,
      Boolean(typo.italic),
      typo.fallbackFamily ?? "sans-serif",
      fontRemaps,
    );
  });

  const meta = v1.meta ?? {};
  return {
    schema: "adstudio.template.v2",
    id,
    name: v1.name ?? id,
    goal: v1.goal ?? "leads",
    offerId: v1.offerId ?? "general",
    category: v1.category ?? "real-estate",
    tags: v1.tags ?? [],
    audienceIntent: v1.audienceIntent ?? "generic",
    classification: v1.classification ?? { ad_type: "feed", primary_intent: "other", property_or_agent_focus: "property" },
    provenance: {
      sourceAd: { file: v1.sourceAd?.file, contentHash: v1.sourceAd?.contentHash ?? "" },
      sample: { imageSrc: v1.sample?.imageSrc ?? "", contentHash: v1.sample?.contentHash ?? "", generatedBy: "deterministic_render" },
      decomposedFrom: "source",
    },
    restyle: {
      paletteMap: {},
      replacedAssets: [],
      note: fontRemaps.length > 0
        ? `migrated from v1 (${from}); font remaps: ${[...new Set(fontRemaps)].join(", ")}; restyle pass pending in Studio`
        : `migrated from v1 (${from}); restyle pass pending in Studio`,
    },
    fonts,
    formats: isStory
      ? {
          feed: {
            format: "4:5",
            width: 1080,
            height: 1350,
            plate: { src: `/adstudio-templates/${id}/plate-feed.webp`, sha256: "0".repeat(64) },
            layers: layout.layers
              .map((layer) => {
                if (layer.type !== "image_slot") return layer;
                const mapped = mapStoryBoxToFeed(layer.box);
                return mapped ? { ...layer, box: mapped } : null;
              })
              .filter(Boolean),
          },
          story: { ...layout, native: true },
        }
      : { feed: layout },
    inputs: {
      images: Object.entries(v1.deterministicEditing?.imageBoxes ?? {}).map(([key]) => ({
        key,
        label: key.replace(/_/g, " "),
        required: true,
        aspect: "portrait",
        description: "Customer photo drawn into the declared slot.",
      })),
      text: textInputs,
    },
    publish: {
      platform: "meta",
      objective: meta.objective ?? "OUTCOME_LEADS",
      specialAdCategory: meta.specialAdCategory ?? "housing",
      apiVersionMin: "v26.0",
      copy: {
        primaryText: meta.primaryText ?? [],
        headlines: meta.headlines ?? [],
        descriptions: meta.descriptions ?? [],
      },
      cta: meta.cta === "CONTACT_US" ? "LEARN_MORE" : (meta.cta ?? "LEARN_MORE"),
      leadForm: {
        headline: meta.leadForm?.headline ?? "Request a free appraisal",
        questions: meta.leadForm?.questions ?? [],
        thankYou: meta.leadForm?.thankYou ?? { title: "Thanks", body: "We'll be in touch." },
      },
      placements: {
        publisherPlatforms: meta.publisherPlatforms ?? ["facebook", "instagram"],
        facebookPositions: meta.facebookPositions ?? ["feed"],
        instagramPositions: meta.instagramPositions ?? ["stream"],
      },
      formatRouting: { feed: "4:5", story: null },
      creativeFeatures: Object.fromEntries(CREATIVE_FEATURE_KEYS.map((key) => [key, "OPT_OUT"])),
      previewFormats: ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD"],
    },
    editPolicy: { mode: "guided", advancedUnlockable: true, lockedLayerIds: [] },
    exactness: {
      status: "draft",
      residuals: {},
      bakedTextKeys: bakedKeys,
    },
  };
}

// ── story-first mapping lives in lib/story.mjs (unit-tested there) ────────
import { mapStoryBoxToFeed, STORY_DERIVED_FEED_TOP, STORY_DERIVED_FEED_BOTTOM } from "./lib/story.mjs";
const STORY_TOP_PX = STORY_DERIVED_FEED_TOP;
const STORY_BOTTOM_PX = STORY_DERIVED_FEED_BOTTOM;

function migrateOne(id, from, force = false) {
  const v1Path = join(v1Gallery, `${id}.json`);
  if (!existsSync(v1Path)) throw new Error(`no v1 template ${id}`);
  // Never clobber QA progress: once a doc has left draft (decompose/restyle
  // ran), re-running migrate --all must leave it untouched. --force rebuilds
  // after pipeline fixes (the operator's explicit opt-in).
  const existingPath = join(v2Gallery, id, "template.json");
  if (!force && existsSync(existingPath)) {
    const existing = readJson(existingPath);
    if (existing.exactness?.status && existing.exactness.status !== "draft") return false;
  }
  const v1 = readJson(v1Path);
  const doc = v1ToV2(v1, id, from);
  const dir = join(v2Gallery, id);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "template.json"), doc);
  writeJson(join(dir, "evidence.json"), {
    migratedFrom: "v1",
    source: from,
    // No timestamp: the migration must be idempotent — running it twice
    // yields byte-identical output (§14). Provenance lives in git.
    sourceValues: Object.fromEntries(Object.entries(v1.typography ?? {}).map(([key, typo]) => [key, (typo.measuredLines ?? []).map((line) => line.text).join(" ") || ""])),
    // Baked text boxes are visually part of the layout skeleton; the v2 gate's
    // diversity check includes them for drafts whose text lives in the plate.
    textBoxes: Object.fromEntries(Object.entries(v1.typography ?? {}).map(([key, typo]) => [key, typo.sampleBox])),
  });
  return id;
}

// ── story-draft (deterministic) ────────────────────────────────────────────

async function storyDraft(id) {
  const { extendPlateToStory, deriveStoryComposition, STORY_BACKING_COLOUR } = await import("./lib/story.mjs");
  const { writeTemplateDoc } = await import("../../../src/lib/adstudio/v2/studio.ts");
  const docPath = join(v2Gallery, id, "template.json");
  const doc = readJson(docPath);
  // Story-first sources: decompose wrote the true story plate from the
  // source; never overwrite it with a band-extended feed.
  const storyFirst = Boolean(doc.formats.story?.native);
  if (storyFirst) {
    console.log(`story-draft ${id}: story-first source — keeping the decomposed story plate`);
    return;
  }
  const feedPlatePath = join(privateV2, id, "plate-feed.webp");
  if (!existsSync(feedPlatePath)) throw new Error(`plate-feed missing for ${id} — run decompose first`);
  const feedBytes = readFileSync(feedPlatePath);
  const storyBytes = await extendPlateToStory(feedBytes);
  const { toLosslessWebp, sha256Hex } = await import("./lib/plate.mjs");
  const webp = await toLosslessWebp(storyBytes);
  mkdirSync(join(privateV2, id), { recursive: true });
  writeFileSync(join(privateV2, id, "plate-story.webp"), webp);
  const sha = await sha256Hex(webp);

  const composition = deriveStoryComposition(doc.formats.feed.layers);
  const storyLayers = composition.layers.map((layer) => {
    if (layer.type !== "overlay_patch") return layer;
    const backing = composition.backings.find((candidate) => candidate.id === layer.id);
    if (!backing) return layer;
    return {
      ...layer,
      src: layer.src.replace("__TEMPLATE_ID__", id),
      sha256: "0".repeat(64),
    };
  });

  // Backing patches are one-pixel ivory assets stretched over their declared
  // geometry by the deterministic renderer. They are source-free and keep
  // supporting copy legible even when the customer's photo is dark.
  for (const backing of composition.backings) {
    const patch = await sharp({
      create: { width: 1, height: 1, channels: 4, background: STORY_BACKING_COLOUR },
    }).png().toBuffer();
    const patchPath = join(privateV2, id, `patch-${backing.role}.webp`);
    const webpPatch = await sharp(patch).webp({ lossless: true }).toBuffer();
    writeFileSync(patchPath, webpPatch);
    const layer = storyLayers.find((candidate) => candidate.id === backing.id);
    if (layer) layer.sha256 = (await import("./lib/plate.mjs")).sha256Hex(webpPatch);
  }

  const storyLayout = {
    format: "9:16",
    width: 1080,
    height: 1920,
    plate: { src: `/adstudio-templates/${id}/plate-story.webp`, sha256: sha },
    layers: storyLayers,
    storyPolicy: composition.policy,
  };
  doc.formats.story = storyLayout;
  doc.publish.formatRouting.story = "9:16";
  writeTemplateDoc(doc.id, doc);
  console.log(`story-draft ${id}: safe-zone layout written`);
}

// ── entrypoint ─────────────────────────────────────────────────────────────

if (command === "migrate-v1") {
  const id = argValue("--id");
  const from = argValue("--from") ?? "source";
  const force = args.includes("--force");
  if (args.includes("--all")) {
    const ids = readdirSync(v1Gallery).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
    for (const templateId of ids) migrateOne(templateId, from, force);
    console.log(`migrate-v1 --all: ${ids.length} drafts written to template-gallery-v2`);
  } else if (id) {
    migrateOne(id, from, force);
    console.log(`migrate-v1 ${id}: draft written`);
  } else {
    console.error("usage: ingest.mjs migrate-v1 (--id <id> | --all) [--from source|sample] [--force]");
    process.exit(2);
  }
} else if (command === "story-draft") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs story-draft --id <id>"); process.exit(2); }
  await storyDraft(id);
} else if (command === "decompose") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs decompose --id <id> [--inpainted <path>]"); process.exit(2); }
  await decompose(id);
} else if (command === "restyle") {
  console.error("restyle is intentionally disabled: select verified generic assets and explicit safe copy in Template Studio, then run its canonical restyle action.");
  process.exit(2);
} else if (command === "check") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs check --id <id>"); process.exit(2); }
  await check(id);
} else {
  console.error("usage: ingest.mjs <migrate-v1|story-draft|decompose|check> --id <id> [--inpainted <path> for decompose] (restyle is Studio-only)");
  process.exit(2);
}

// ── decompose: masked text inpaint on the source, truth-preserving plate ──

async function decompose(id) {
  const { envFromDotfiles, buildInpaintMask, buildCompositeMask, inpaintTextRegions, compositePlateFromSource, writeLosslessWebp } = await import("./lib/decompose.mjs");
  const { writeTemplateDoc } = await import("../../../src/lib/adstudio/v2/studio.ts");
  const env = envFromDotfiles(root);
  const docPath = join(v2Gallery, id, "template.json");
  if (!existsSync(docPath)) throw new Error(`run migrate-v1 first: ${id}`);
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  const sourceFile = doc.provenance.sourceAd.file;
  if (!sourceFile) throw new Error(`${id}: no source file recorded`);
  const sourceBytes = readFileSync(join(root, "meta_ad_candidates", sourceFile));

  // Text boxes from the v1 typography measurement (evidence carries them too).
  const evidencePath = join(v2Gallery, id, "evidence.json");
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : {};
  const v1 = JSON.parse(readFileSync(join(v1Gallery, `${id}.json`), "utf8"));
  // A multi-line text field often has a loose parent sampleBox spanning
  // whitespace between lines. Sending that entire parent box to the image
  // model needlessly lets it alter non-text pixels. Use the measured line
  // geometry whenever it exists; only old single-box measurements fall back
  // to the parent. The same exact boxes drive both the provider mask and the
  // truth-preserving composite below.
  const boxes = collectTextMaskBoxes(v1.typography ?? {});
  if (boxes.length === 0) throw new Error(`${id}: no measured text boxes in v1 typography`);

  const meta = await sharp(sourceBytes).metadata();
  const sourceDims = { width: meta.width, height: meta.height };
  const isStoryFirst = Boolean(doc.formats.story?.native);
  const layout = isStoryFirst ? doc.formats.story : doc.formats.feed;
  const layoutDims = { width: layout.width, height: layout.height };

  // --no-inpaint: no image-model budget. Honest fallback (§0 escape hatch):
  // plates are the source's own pixels; EVERY text key is baked (not
  // editable). Nothing ships "approximately right"; topping up the OpenAI
  // account and re-running decompose unbakes via runBake(key, false).
  const noInpaint = args.includes("--no-inpaint");
  if (noInpaint) {
    const sourceLayout = await sharp(sourceBytes).resize(layoutDims.width, layoutDims.height, { fit: "fill" }).png().toBuffer();
    const assetDir = join(privateV2, id);
    const { writeLosslessWebp } = await import("./lib/decompose.mjs");
    const { webp, sha } = await writeLosslessWebp(sourceLayout, join(assetDir, isStoryFirst ? "plate-story.webp" : "plate-feed.webp"));
    layout.plate.sha256 = sha;
    if (isStoryFirst) {
      const feedPng = await sharp(sourceLayout).extract({ left: 0, top: STORY_TOP_PX, width: 1080, height: 1350 }).png().toBuffer();
      const feed = await writeLosslessWebp(feedPng, join(assetDir, "plate-feed.webp"));
      doc.formats.feed.plate.sha256 = feed.sha;
    }
    layout.layers = layout.layers.filter((layer) => layer.type !== "text");
    if (isStoryFirst) doc.formats.feed.layers = doc.formats.feed.layers.filter((layer) => layer.type !== "text");
    doc.exactness.bakedTextKeys = [...new Set([...doc.exactness.bakedTextKeys, ...Object.keys(v1.typography ?? {})])];
    doc.exactness.status = "qa";
    writeTemplateDoc(id, doc);
    console.log(`decompose ${id} (--no-inpaint): plates are source pixels; all ${Object.keys(v1.typography ?? {}).length} text key(s) baked, status=qa`);
    return;
  }
  // The OpenAI mask is free-form (the model resamples internally); the
  // truth-preserving composite happens at LAYOUT dims so the plate and the
  // gate's source comparison share one resize chain — outside the holes the
  // pixels must be byte-identical, no resample halo.
  const sourceLayout = await sharp(sourceBytes).resize(layoutDims.width, layoutDims.height, { fit: "fill" }).png().toBuffer();
  const inpaintMask = await buildInpaintMask(sourceDims, boxes);

  console.log(`decompose ${id}: reconstructing ${boxes.length} declared text region(s)…`);
  // Inpaint with retries: 70+ sequential image edits can trip provider rate
  // limits; back off and retry rather than fail a template.
  const suppliedInpaintPath = argValue("--inpainted");
  let inpainted = suppliedInpaintPath ? readFileSync(resolve(suppliedInpaintPath)) : null;
  if (suppliedInpaintPath) {
    console.log(`decompose ${id}: using supplied text-free reconstruction; source pixels still win outside the declared masks`);
  }
  for (let attempt = 1; !inpainted && attempt <= 3; attempt += 1) {
    try {
      inpainted = await inpaintTextRegions(env, sourceBytes, inpaintMask);
      break;
    } catch (error) {
      const message = error?.message ?? "";
      const retryable = /429|5\d\d|rate|quota|temporar/i.test(message);
      if (!retryable || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20_000 * attempt));
    }
  }
  const inpaintedLayout = await sharp(inpainted).resize(layoutDims.width, layoutDims.height, { fit: "fill" }).png().toBuffer();
  const compositeMask = await buildCompositeMask(layoutDims, boxes);
  const platePng = await sharp(sourceLayout)
    .composite([{ input: await sharp(inpaintedLayout).composite([{ input: compositeMask, blend: "dest-in" }]).png().toBuffer(), blend: "over" }])
    .png()
    .toBuffer();

  const assetDir = join(privateV2, id);
  const plateFile = (fmt) => (fmt === "9:16" ? "plate-story.webp" : "plate-feed.webp");
  const writePlate = async (png, target) => {
    const { sha } = await writeLosslessWebp(png, join(assetDir, plateFile(target.format)));
    target.plate.sha256 = sha;
  };
  // Write BEFORE the fit probes: the renderer verifies the plate's sha256 on
  // disk, so the doc and the file must agree when the probes run.
  await writePlate(platePng, layout);
  let finalPng = platePng;

  const buildTextLayer = ([key, typo], index) => {
    // The layer must reference the SAME resolved corpus face recorded in
    // fonts[] (gate: every typo resolves to a fonts[] entry).
    const resolved = resolveFont(typo.fontId, typo.family, typo.weight, Boolean(typo.italic), typo.fallbackFamily ?? "sans-serif", []);
    return {
      id: `text-${key}`,
      type: "text",
      z: 10 + index,
      inputKey: key,
      box: typo.sampleBox,
      typo: {
        fontId: resolved.fontId,
        family: resolved.family,
        fallbackFamily: typo.fallbackFamily ?? "sans-serif",
        weight: resolved.weight,
        italic: resolved.italic,
        case: typo.case ?? "none",
        sizeRatio: typo.sizeRatio,
      lineHeight: typo.lineHeight ?? 1,
      tracking: typo.tracking ?? 0,
      align: typo.align ?? "left",
      color: typo.color,
      ...(typo.measuredLines?.length
        ? { measuredLines: typo.measuredLines.map((line) => ({
            text: line.text,
            box: line.sampleBox,
            sizeRatio: line.sizeRatio,
            ...(line.scaleX !== undefined ? { scaleX: line.scaleX } : {}),
          })) }
        : {}),
      },
      constraints: {
      maxLength: v1.inputs?.text?.find((input) => input.key === key)?.maxLength ?? 60,
      maxLines: typo.sampleLineCount ?? 3,
            autoFitMinRatio: typo.autoFitMinRatio ?? 0.85,
    },
    measurement: {
      fitScore: typo.fitScore ?? 0,
      detectionScore: typo.detectionScore ?? 0,
      source: typo.measurementSource === "manual-verified" ? "manual-verified" : "ocr-v2",
      version: typo.measurementVersion ?? 1,
    },
    };
  };
  const entries = Object.entries(v1.typography ?? {});

  // Fit-verify each text key with a probe render (font metrics only, §0):
  // keys the corpus face cannot typeset at the measured size stay BAKED as
  // the designer's original pixels — never "approximately right".
  const { renderAdDocToPng } = await import("../../../src/lib/adstudio/v2/render/server.ts");
  const fitted = [];
  const unfit = [];
  for (const entry of entries) {
    const probe = JSON.parse(JSON.stringify(doc));
    probe.formats[isStoryFirst ? "story" : "feed"].layers = [buildTextLayer(entry, 0)];
    probe.exactness.bakedTextKeys = [];
    const probeInstance = {
      schema: "adstudio.instance.v2",
      templateId: id,
      templateHash: "0".repeat(64),
      format: layout.format,
      // Probe with the SAME value later renders will see (inputs sample is
      // what restyle/Studio hand the renderer), else the verification lies.
      values: {
        images: {},
        text: {
          [entry[0]]:
            v1.inputs?.text?.find((input) => input.key === entry[0])?.sample
            ?? entry[1].sample
            ?? "",
        },
      },
      overrides: [],
    };
    try {
      await renderAdDocToPng(probe, probeInstance, layout.format);
      fitted.push(entry);
    } catch (error) {
      if (error?.name === "RenderFitError") unfit.push(entry);
      else throw error;
    }
  }

  // Baked keys keep the ORIGINAL pixels: paste the source crop back over the
  // inpainted plate for exactly those boxes, then rewrite plate + sha.
  // Whole-doc validation first: probes pass in isolation but the combined
  // render can still refuse (block-wrap shares the line budget), so bake
  // until the combined render accepts the fitted set.
  const sampleFor = (key, typo) =>
    v1.inputs?.text?.find((input) => input.key === key)?.sample ?? typo.sample ?? "";
  for (;;) {
    const probe = JSON.parse(JSON.stringify(doc));
    probe.formats[isStoryFirst ? "story" : "feed"].layers = fitted.map(buildTextLayer);
    probe.exactness.bakedTextKeys = unfit.map(([key]) => key);
    const probeInstance = {
      schema: "adstudio.instance.v2",
      templateId: id,
      templateHash: "0".repeat(64),
      format: layout.format,
      values: { images: {}, text: Object.fromEntries(fitted.map(([key, typo]) => [key, sampleFor(key, typo)])) },
      overrides: [],
    };
    try {
      await renderAdDocToPng(probe, probeInstance, layout.format);
      break;
    } catch (error) {
      if (error?.name !== "RenderFitError" || fitted.length === 0) throw error;
      const idx = fitted.findIndex(([key]) => key === error.inputKey);
      const moved = idx >= 0 ? fitted.splice(idx, 1)[0] : fitted.pop();
      unfit.push(moved);
    }
  }
  if (unfit.length > 0) {
    const bakeMask = await buildCompositeMask(layoutDims, unfit.map(([, typo]) => typo.sampleBox));
    const cut = await sharp(sourceLayout).composite([{ input: bakeMask, blend: "dest-in" }]).png().toBuffer();
    finalPng = await sharp(platePng).composite([{ input: cut, blend: "over" }]).png().toBuffer();
    await writePlate(finalPng, layout);
  }

  layout.layers = [
    ...layout.layers.filter((layer) => layer.type !== "text"),
    ...fitted.map(buildTextLayer),
  ];
  // Story-first sources: the 4:5 feed is the centred band cropped from the
  // story plate, with the fitted text boxes mapped into band coordinates.
  if (isStoryFirst) {
    const feed = doc.formats.feed;
    feed.layers = [
      ...feed.layers.filter((layer) => layer.type !== "text"),
      ...fitted.map((entry, index) => {
        const mapped = mapStoryBoxToFeed(entry[1].sampleBox);
        return mapped ? { ...buildTextLayer(entry, index), box: mapped } : null;
      }).filter(Boolean),
    ];
    const feedPng = await sharp(finalPng).extract({ left: 0, top: STORY_TOP_PX, width: 1080, height: 1350 }).png().toBuffer();
    await writePlate(feedPng, feed);
  } else {
    // Any existing story is derived from the previous feed state. Remove it
    // before publishing the rebuilt native surface; story-draft will create a
    // fresh safe-zone mapping from these exact layers and plate bytes.
    delete doc.formats.story;
    doc.publish.formatRouting.story = null;
  }
  doc.exactness.bakedTextKeys = unfit.map(([key]) => key);
  doc.exactness.status = "qa";
  writeTemplateDoc(id, doc);
  console.log(
    `decompose ${id}: plate written (${finalPng.length} bytes); ${fitted.length} editable, `
    + `${unfit.length} baked (${unfit.map(([key]) => key).join(", ") || "none"}), status=qa`,
  );
}

function isNormalizedBox(box) {
  return Boolean(box)
    && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0
    && box.height > 0
    && box.x >= 0
    && box.y >= 0
    && box.x + box.width <= 1
    && box.y + box.height <= 1;
}

function collectTextMaskBoxes(typography) {
  const boxes = [];
  const seen = new Set();
  for (const [key, typo] of Object.entries(typography)) {
    const measuredLines = Array.isArray(typo?.measuredLines) ? typo.measuredLines : [];
    const candidates = measuredLines.length > 0
      ? measuredLines.map((line) => line?.sampleBox)
      : [typo?.sampleBox];
    for (const box of candidates) {
      if (!isNormalizedBox(box)) {
        const source = measuredLines.length > 0 ? "measured line" : "sample";
        throw new Error(`${key}: invalid ${source} box for text inpaint mask`);
      }
      // Overlapping lines should remain separate, but exact duplicates only
      // enlarge neither the provider hole nor the composite region.
      const fingerprint = [box.x, box.y, box.width, box.height].map((value) => value.toFixed(9)).join(":");
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        boxes.push(box);
      }
    }
  }
  if (boxes.length === 0) throw new Error("no measured text boxes in v1 typography");
  return boxes;
}

// ── check: read-only fidelity and stress gates ──────────────────────────────

async function check(id) {
  const docPath = join(v2Gallery, id, "template.json");
  if (!existsSync(docPath)) throw new Error(`template not found: ${id}`);
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  const { runFidelityCheck } = await import("../../../src/lib/adstudio/v2/studio.ts");
  const { runStressMatrix } = await import("../../../src/lib/adstudio/v2/fidelity-stress.ts");

  // These helpers are deliberately read-only. Studio approval is the sole
  // path that records residual or stress evidence on a template document.
  const [fidelityResult, stressResult] = await Promise.allSettled([
    runFidelityCheck(doc),
    runStressMatrix(doc),
  ]);
  const failures = [];
  if (fidelityResult.status === "rejected") {
    failures.push(`fidelity: ${fidelityResult.reason instanceof Error ? fidelityResult.reason.message : String(fidelityResult.reason)}`);
  } else {
    const overThreshold = Object.entries(fidelityResult.value.residuals)
      .filter(([, residual]) => residual > fidelityResult.value.threshold)
      .map(([layerId, residual]) => `${layerId}=${residual.toFixed(3)}`);
    if (overThreshold.length > 0) failures.push(`fidelity residuals exceed ${fidelityResult.value.threshold}: ${overThreshold.join(", ")}`);
  }
  if (stressResult.status === "rejected") {
    failures.push(`stress: ${stressResult.reason instanceof Error ? stressResult.reason.message : String(stressResult.reason)}`);
  }
  if (failures.length > 0) throw new Error(`check ${id} failed — ${failures.join("; ")}`);

  const residuals = Object.fromEntries(Object.entries(fidelityResult.value.residuals)
    .map(([layerId, residual]) => [layerId, Number(residual.toFixed(4))]));
  console.log(`check ${id}: fidelity template=${fidelityResult.value.residualEvidence.templateHash} source=${fidelityResult.value.residualEvidence.sourceContentHash} residuals=${JSON.stringify(residuals)}`);
  console.log(`check ${id}: stress template=${stressResult.value.templateHash} matrix=${stressResult.value.hash} renders=${stressResult.value.entries.length}`);
}
