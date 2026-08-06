#!/usr/bin/env node

// AdStudio v2 ingestion CLI (Track C, §5). Build-time only — operator/dev
// machine/VPS, never Vercel. Subcommands:
//
//   analyse --source <path> --id <id>
//   decompose --id <id>          (needs OPENAI_API_KEY: gpt-image-2 masked
//                                 text-region inpaint; WITHOUT the key the
//                                 text layers are emitted BAKED — honest §0
//                                 escape hatch, never approximate)
//   restyle --id <id>
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
const v2Gallery = resolve(process.env.ADSTUDIO_V2_GALLERY ?? join(root, "src", "lib", "adstudio", "template-gallery-v2"));
const publicV2 = resolve(process.env.ADSTUDIO_PUBLIC_V2 ?? join(root, "public", "adstudio-templates"));
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
  const { extendPlateToStory, repositionLayersForStory } = await import("./lib/story.mjs");
  const docPath = join(v2Gallery, id, "template.json");
  const doc = readJson(docPath);
  // Story-first sources: decompose wrote the true story plate from the
  // source; never overwrite it with a band-extended feed.
  const storyFirst = Boolean(doc.formats.story?.native);
  if (storyFirst) {
    console.log(`story-draft ${id}: story-first source — keeping the decomposed story plate`);
    return;
  }
  const feedPlatePath = join(publicV2, id, "plate-feed.webp");
  if (!existsSync(feedPlatePath)) throw new Error(`plate-feed missing for ${id} — run decompose first`);
  const feedBytes = readFileSync(feedPlatePath);
  const storyBytes = await extendPlateToStory(feedBytes);
  const { toLosslessWebp, sha256Hex } = await import("./lib/plate.mjs");
  const webp = await toLosslessWebp(storyBytes);
  mkdirSync(join(publicV2, id), { recursive: true });
  writeFileSync(join(publicV2, id, "plate-story.webp"), webp);
  const sha = await sha256Hex(webp);

  const storyLayout = {
    format: "9:16",
    width: 1080,
    height: 1920,
    plate: { src: `/adstudio-templates/${id}/plate-story.webp`, sha256: sha },
    layers: repositionLayersForStory(doc.formats.feed.layers),
  };
  doc.formats.story = storyLayout;
  doc.publish.formatRouting.story = "9:16";
  writeJson(docPath, doc);
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
  if (!id) { console.error("usage: ingest.mjs decompose --id <id>"); process.exit(2); }
  await decompose(id);
} else if (command === "restyle") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs restyle --id <id>"); process.exit(2); }
  await restyle(id);
} else if (command === "check") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs check --id <id>"); process.exit(2); }
  await check(id);
} else {
  console.error("usage: ingest.mjs <migrate-v1|story-draft|decompose|restyle|check> --id <id>");
  process.exit(2);
}

// ── decompose: masked text inpaint on the source, truth-preserving plate ──

async function decompose(id) {
  const { envFromDotfiles, buildInpaintMask, buildCompositeMask, inpaintTextRegions, compositePlateFromSource, writeLosslessWebp } = await import("./lib/decompose.mjs");
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
  const boxes = Object.values(v1.typography ?? {}).map((typo) => typo.sampleBox).filter(Boolean);
  if (boxes.length === 0) throw new Error(`${id}: no measured text boxes in v1 typography`);

  const meta = await sharp(sourceBytes).metadata();
  const sourceDims = { width: meta.width, height: meta.height };
  const isStoryFirst = Boolean(doc.formats.story?.native);
  const layout = isStoryFirst ? doc.formats.story : doc.formats.feed;
  const layoutDims = { width: layout.width, height: layout.height };
  // The OpenAI mask is free-form (the model resamples internally); the
  // truth-preserving composite happens at LAYOUT dims so the plate and the
  // gate's source comparison share one resize chain — outside the holes the
  // pixels must be byte-identical, no resample halo.
  const sourceLayout = await sharp(sourceBytes).resize(layoutDims.width, layoutDims.height, { fit: "fill" }).png().toBuffer();
  const inpaintMask = await buildInpaintMask(sourceDims, boxes);

  console.log(`decompose ${id}: one masked gpt-image-2 call for ${boxes.length} text region(s)…`);
  const inpainted = await inpaintTextRegions(env, sourceBytes, inpaintMask);
  const inpaintedLayout = await sharp(inpainted).resize(layoutDims.width, layoutDims.height, { fit: "fill" }).png().toBuffer();
  const compositeMask = await buildCompositeMask(layoutDims, boxes);
  const platePng = await sharp(sourceLayout)
    .composite([{ input: await sharp(inpaintedLayout).composite([{ input: compositeMask, blend: "dest-in" }]).png().toBuffer(), blend: "over" }])
    .png()
    .toBuffer();

  const publicDir = join(publicV2, id);
  const plateFile = (fmt) => (fmt === "9:16" ? "plate-story.webp" : "plate-feed.webp");
  const writePlate = async (png, target) => {
    const { sha } = await writeLosslessWebp(png, join(publicDir, plateFile(target.format)));
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
      autoFitMinRatio: 0.85,
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
  }
  doc.exactness.bakedTextKeys = unfit.map(([key]) => key);
  doc.exactness.status = "qa";
  writeFileSync(docPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    `decompose ${id}: plate written (${finalPng.length} bytes); ${fitted.length} editable, `
    + `${unfit.length} baked (${unfit.map(([key]) => key).join(", ") || "none"}), status=qa`,
  );
}

// ── restyle: deterministic safe palette + generic sample render (D5) ───────

async function restyle(id) {
  const docPath = join(v2Gallery, id, "template.json");
  if (!existsSync(docPath)) throw new Error(`run migrate-v1 first: ${id}`);
  const doc = JSON.parse(readFileSync(docPath, "utf8"));

  // Deterministic safe-palette remap: every distinct text colour maps to a
  // neutral dark; recorded so the gate and the render share it exactly.
  const paletteMap = {};
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
  doc.restyle = {
    ...doc.restyle,
    paletteMap,
    replacedAssets: doc.inputs.images.map((image) => image.key),
  };

  // Public sample = deterministic render of the restyled doc with safe copy.
  // Story-first templates render the sample at their native 9:16 layout
  // (the 4:5 band boxes are derived and can degenerate); feed-first at 4:5.
  const isStoryFirst = Boolean(doc.formats.story?.native);
  const sampleFormat = isStoryFirst ? "9:16" : "4:5";
  const { renderAdDocToPng } = await import("../../../src/lib/adstudio/v2/render/server.ts");
  const instance = {
    schema: "adstudio.instance.v2",
    templateId: id,
    templateHash: "0".repeat(64),
    format: sampleFormat,
    values: {
      images: {},
      // Safe copy = the template's own measured sample values (they fit the
      // measured boxes by construction; RenderFitError refuses anything else).
      text: Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample])),
    },
    overrides: [],
  };
  const png = await renderAdDocToPng(doc, instance, sampleFormat);
  const { sha256Hex } = await import("./lib/decompose.mjs");
  const samplePath = join(publicV2, id, "sample.png");
  mkdirSync(join(publicV2, id), { recursive: true });
  writeFileSync(samplePath, png);
  const contentHash = await sha256Hex(png);
  doc.provenance.sample = {
    imageSrc: `/adstudio-templates/${id}/sample.png`,
    contentHash,
    generatedBy: "deterministic_render",
  };
  if (contentHash === doc.provenance.sourceAd.contentHash) {
    throw new Error("restyle produced a sample identical to the source — distance is required (D5)");
  }
  writeFileSync(docPath, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`restyle ${id}: palette remapped (${Object.keys(paletteMap).length} colour(s)), sample rendered ${png.length} bytes, hash differs from source`);
}

// ── check: the fidelity gate (§10.2) — source values vs the source ad ──────

async function check(id) {
  const { renderAdDocToPng } = await import("../../../src/lib/adstudio/v2/render/server.ts");
  const docPath = join(v2Gallery, id, "template.json");
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  const evidencePath = join(v2Gallery, id, "evidence.json");
  const evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : {};
  const sourceValues = evidence.sourceValues ?? {};
  const sourceBytes = readFileSync(join(root, "meta_ad_candidates", doc.provenance.sourceAd.file));

  const isStoryFirst = Boolean(doc.formats.story?.native);
  const layout = isStoryFirst ? doc.formats.story : doc.formats.feed;
  const W = layout.width;
  const H = layout.height;
  const instance = {
    schema: "adstudio.instance.v2",
    templateId: id,
    templateHash: "0".repeat(64),
    format: layout.format,
    values: { images: {}, text: sourceValues },
    overrides: [],
  };
  const rendered = await renderAdDocToPng(doc, instance, layout.format);
  const renderedRaw = await sharp(rendered).raw().ensureAlpha().toBuffer();
  const source = await sharp(sourceBytes).resize(W, H, { fit: "fill" }).raw().ensureAlpha().toBuffer();

  // Exclusion padding must match the inpaint mask's padding (TEXT_MASK_PADDING):
  // inside the cleanup annulus the model legitimately repaints text AA, so the
  // byte-identical guarantee applies outside the padded text boxes.
  const { TEXT_MASK_PADDING } = await import("./lib/decompose.mjs");
  const v1Typo = (() => {
    try {
      return JSON.parse(readFileSync(join(v1Gallery, `${id}.json`), "utf8")).typography ?? {};
    } catch {
      return {};
    }
  })();
  // Fitted layers AND baked keys get padded exclusions: baked boxes hold the
  // source pixels through a mask composite whose AA ring differs from the raw
  // resize by a pixel or two at the cut edge. (v1 boxes are in the source's
  // own coordinates, i.e. the primary layout's.)
  const bakePad = Math.ceil(TEXT_MASK_PADDING * Math.max(W, H));
  const bakedBoxes = (doc.exactness.bakedTextKeys ?? [])
    .filter((key) => v1Typo[key]?.sampleBox)
    .map((key) => {
      const b = v1Typo[key].sampleBox;
      return {
        id: `baked-${key}`,
        x: Math.max(0, Math.floor(b.x * W) - bakePad),
        y: Math.max(0, Math.floor(b.y * H) - bakePad),
        w: Math.min(W, Math.ceil(b.width * W) + bakePad * 2),
        h: Math.min(H, Math.ceil(b.height * H) + bakePad * 2),
      };
    });
  const paddedBoxes = [
    ...bakedBoxes,
    ...layout.layers
    .filter((layer) => layer.type === "text")
    .map((layer) => {
      const effects = layer.typo.effects;
      const bh = layer.box.height * H;
      const bw = layer.box.width * W;
      const spread = Math.ceil(
        (effects?.shadow ? effects.shadow.blurRatio * bh + Math.abs(effects.shadow.dx) * bw + Math.abs(effects.shadow.dy) * bh : 0)
        + (effects?.stroke ? effects.stroke.widthRatio * bh : 0),
      ) + Math.ceil(TEXT_MASK_PADDING * Math.max(W, H));
      return {
        id: layer.id,
        x: Math.max(0, Math.floor(layer.box.x * W) - spread),
        y: Math.max(0, Math.floor(layer.box.y * H) - spread),
        w: Math.min(W, Math.ceil(layer.box.width * W) + spread * 2),
        h: Math.min(H, Math.ceil(layer.box.height * H) + spread * 2),
      };
    }),
  ];
  const inBox = (x, y) => paddedBoxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

  let outsideDiffs = 0;
  let outsidePixels = 0;
  let dMinX = Infinity;
  let dMinY = Infinity;
  let dMaxX = -1;
  let dMaxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (inBox(x, y)) continue;
      const i = (y * W + x) * 4;
      outsidePixels += 1;
      if (renderedRaw[i] !== source[i] || renderedRaw[i + 1] !== source[i + 1] || renderedRaw[i + 2] !== source[i + 2]) {
        outsideDiffs += 1;
        if (x < dMinX) dMinX = x;
        if (y < dMinY) dMinY = y;
        if (x > dMaxX) dMaxX = x;
        if (y > dMaxY) dMaxY = y;
      }
    }
  }

  const residuals = {};
  const bakedResiduals = {};
  for (const b of paddedBoxes) {
    let sum = 0;
    let count = 0;
    for (let y = b.y; y < b.y + b.h; y += 2) {
      for (let x = b.x; x < b.x + b.w; x += 2) {
        const i = (y * W + x) * 4;
        const ga = 0.2126 * renderedRaw[i] + 0.7152 * renderedRaw[i + 1] + 0.0722 * renderedRaw[i + 2];
        const gb = 0.2126 * source[i] + 0.7152 * source[i + 1] + 0.0722 * source[i + 2];
        const d = (ga - gb) / 255;
        sum += d * d;
        count += 1;
      }
    }
    const rmse = count > 0 ? Math.sqrt(sum / count) : 0;
    if (b.id.startsWith("baked-")) bakedResiduals[b.id] = rmse;
    else residuals[b.id] = rmse;
  }

  // Stress matrix: longest legal copy and one-char copy must render (or be
  // honestly refused by RenderFitError — never silently microtype).
  const editable = doc.inputs.text.filter((input) => !doc.exactness.bakedTextKeys.includes(input.key));
  const stress = [];
  for (const [name, values] of [
    ["longest", Object.fromEntries(editable.map((input) => [input.key, "W".repeat(input.maxLength)]))],
    ["one-char", Object.fromEntries(editable.map((input) => [input.key, "W"]))],
  ]) {
    try {
      await renderAdDocToPng(doc, { ...instance, values: { images: {}, text: values } }, layout.format);
      stress.push(`${name}: renders`);
    } catch (error) {
      stress.push(`${name}: ${error?.name === "RenderFitError" ? "refused (tighten constraints or bake)" : (error?.message ?? "threw")}`);
    }
  }

  doc.exactness.residuals = residuals;
  writeFileSync(docPath, `${JSON.stringify(doc, null, 2)}\n`);
  // Baked-region plate quality is provenance evidence, not layer residuals
  // (the schema keys residuals by layer id only).
  const evidenceOut = { ...evidence, bakedResiduals };
  writeFileSync(evidencePath, `${JSON.stringify(evidenceOut, null, 2)}\n`);
  console.log(`check ${id}: outside-box diffs ${outsideDiffs}/${outsidePixels} (must be 0)` + (outsideDiffs > 0 ? ` diff bbox ${dMinX},${dMinY}-${dMaxX},${dMaxY}` : ""));
  console.log(`  residuals (<=0.14 to ship editable): ${JSON.stringify(Object.fromEntries(Object.entries(residuals).map(([key, value]) => [key, Number(value.toFixed(3))])))}`);
  console.log(`  stress: ${stress.join(" | ")}`);
}
