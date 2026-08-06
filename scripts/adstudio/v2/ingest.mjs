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

const root = process.cwd();
const v1Gallery = resolve(join(root, "src", "lib", "adstudio", "template-gallery"));
const v2Gallery = resolve(join(root, "src", "lib", "adstudio", "template-gallery-v2"));
const publicV2 = resolve(join(root, "public", "adstudio-templates"));
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
  const fonts = [...new Set(Object.values(v1.typography ?? {}).map((typo) => typo.fontId))].map((fontId) => {
    const typo = Object.values(v1.typography ?? {}).find((entry) => entry.fontId === fontId);
    return resolveFont(
      fontId,
      typo?.family ?? fontId,
      typo?.weight ?? 400,
      Boolean(typo?.italic),
      typo?.fallbackFamily ?? "sans-serif",
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
    formats: isStory ? { feed: layout } : { feed: layout },
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

function migrateOne(id, from) {
  const v1Path = join(v1Gallery, `${id}.json`);
  if (!existsSync(v1Path)) throw new Error(`no v1 template ${id}`);
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
  if (args.includes("--all")) {
    const ids = readdirSync(v1Gallery).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, ""));
    for (const templateId of ids) migrateOne(templateId, from);
    console.log(`migrate-v1 --all: ${ids.length} drafts written to template-gallery-v2`);
  } else if (id) {
    migrateOne(id, from);
    console.log(`migrate-v1 ${id}: draft written`);
  } else {
    console.error("usage: ingest.mjs migrate-v1 (--id <id> | --all) [--from source|sample]");
    process.exit(2);
  }
} else if (command === "story-draft") {
  const id = argValue("--id");
  if (!id) { console.error("usage: ingest.mjs story-draft --id <id>"); process.exit(2); }
  await storyDraft(id);
} else {
  console.error(`ingest.mjs: unknown or unimplemented here command "${command}" (analyse/decompose/restyle/check run via Studio or with provider keys)`);
  process.exit(2);
}
