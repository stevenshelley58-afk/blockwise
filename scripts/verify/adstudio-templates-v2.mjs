#!/usr/bin/env node

// AdStudio v2 template gate — skeleton (Phase 0 of the v2 rebuild).
//
// Implements §10.1 checks 1–3 (schema / assets / fonts) against the v2
// gallery. Runs during the transition NEXT TO the v1 gate; Track H swaps the
// two. With zero v2 templates every check passes vacuously — the moment the
// first template.json lands, the full discipline bites.
//
//   1. schema   — template-gallery-v2/*/template.json parses the v2 schema;
//                 id === dirname; no duplicate ids; no duplicate source ad
//                 across v1 + v2 combined.
//   2. assets   — plate/patch/sample files exist; sha256 matches the doc;
//                 plate dims equal the layout dims; sample hash ≠ source
//                 hash; nothing under public/adstudio-templates/ orphaned.
//   3. fonts    — every fonts[] entry exists in the font manifest with a
//                 matching sha256 and a license.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { templateDocV2Schema } from "../../src/lib/adstudio/v2/template-doc.ts";

const root = process.cwd();
const galleryDir = resolve(process.env.ADSTUDIO_GALLERY_V2_DIR ?? join(root, "src", "lib", "adstudio", "template-gallery-v2"));
const v1GalleryDir = resolve(join(root, "src", "lib", "adstudio", "template-gallery"));
const publicDir = resolve(join(root, "public"));
const v2PublicDir = join(publicDir, "adstudio-templates");
const fontManifestPath = join(publicDir, "fonts", "adstudio", "manifest.json");

const failures = [];
function fail(message) {
  failures.push(message);
}

const fontManifest = existsSync(fontManifestPath)
  ? JSON.parse(readFileSync(fontManifestPath, "utf8"))
  : { faces: [] };
const fontFaces = new Map((fontManifest.faces ?? []).map((face) => [face.fontId, face]));

// ─── load docs ──────────────────────────────────────────────────────────────

const docs = [];
if (existsSync(galleryDir)) {
  for (const entry of readdirSync(galleryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(galleryDir, entry.name, "template.json");
    if (!existsSync(path)) {
      fail(`${entry.name}: missing template.json`);
      continue;
    }
    const parsed = templateDocV2Schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        fail(`${entry.name}: schema ${issue.path.join(".")}: ${issue.message}`);
      }
      continue;
    }
    if (parsed.data.id !== entry.name) {
      fail(`${entry.name}: doc id "${parsed.data.id}" does not match its directory name`);
    }
    docs.push(parsed.data);
  }
}

const seenIds = new Set();
for (const doc of docs) {
  if (seenIds.has(doc.id)) fail(`duplicate v2 template id ${doc.id}`);
  seenIds.add(doc.id);
}

// No source ad may feed two templates, across BOTH generations of gallery.
const sourceHashes = new Map();
if (existsSync(v1GalleryDir)) {
  for (const entry of readdirSync(v1GalleryDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.name.endsWith(".json")) continue;
    const path = entry.isDirectory()
      ? join(v1GalleryDir, entry.name, "template.json")
      : join(v1GalleryDir, entry.name);
    if (!existsSync(path)) continue;
    try {
      const v1 = JSON.parse(readFileSync(path, "utf8"));
      if (v1.sourceAd?.contentHash) sourceHashes.set(v1.sourceAd.contentHash, `v1:${v1.id ?? entry.name}`);
    } catch {
      // v1 files that are not JSON docs are not this gate's business
    }
  }
}
for (const doc of docs) {
  const owner = sourceHashes.get(doc.provenance.sourceAd.contentHash);
  if (owner) fail(`${doc.id}: source ad already used by ${owner} — one source, one template`);
  sourceHashes.set(doc.provenance.sourceAd.contentHash, `v2:${doc.id}`);
}

// ─── assets ─────────────────────────────────────────────────────────────────

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readPngDimensions(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const referencedFiles = new Set();

for (const doc of docs) {
  const layouts = [doc.formats.feed, doc.formats.story].filter(Boolean);
  for (const layout of layouts) {
    const platePath = join(publicDir, layout.plate.src.replace(/^\//, ""));
    referencedFiles.add(layout.plate.src);
    if (!existsSync(platePath)) {
      fail(`${doc.id}: plate missing at ${layout.plate.src}`);
      continue;
    }
    if (sha256File(platePath) !== layout.plate.sha256) {
      fail(`${doc.id}: plate sha256 mismatch for ${layout.plate.src}`);
    }
    const dims = readPngDimensions(platePath);
    if (dims.width !== layout.width || dims.height !== layout.height) {
      fail(`${doc.id}: plate ${layout.plate.src} is ${dims.width}x${dims.height}, layout wants ${layout.width}x${layout.height}`);
    }
    for (const layer of layout.layers) {
      if (layer.type !== "overlay_patch") continue;
      const patchPath = join(publicDir, layer.src.replace(/^\//, ""));
      referencedFiles.add(layer.src);
      if (!existsSync(patchPath)) {
        fail(`${doc.id}: overlay patch missing at ${layer.src}`);
      } else if (sha256File(patchPath) !== layer.sha256) {
        fail(`${doc.id}: overlay patch sha256 mismatch for ${layer.src}`);
      }
    }
  }
  const samplePath = join(publicDir, doc.provenance.sample.imageSrc.replace(/^\//, ""));
  referencedFiles.add(doc.provenance.sample.imageSrc);
  if (!existsSync(samplePath)) {
    fail(`${doc.id}: sample missing at ${doc.provenance.sample.imageSrc}`);
  } else if (sha256File(samplePath) !== doc.provenance.sample.contentHash) {
    fail(`${doc.id}: sample sha256 mismatch`);
  }
  if (doc.provenance.sample.contentHash === doc.provenance.sourceAd.contentHash) {
    fail(`${doc.id}: sample hash equals source hash — the restyle distance is gone`);
  }
}

if (existsSync(v2PublicDir)) {
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), src);
      else if (!referencedFiles.has(src)) fail(`orphaned file under public/adstudio-templates: ${src}`);
    }
  };
  walk(v2PublicDir, "/adstudio-templates");
}

// ─── fonts ──────────────────────────────────────────────────────────────────

for (const doc of docs) {
  for (const font of doc.fonts) {
    const face = fontFaces.get(font.fontId);
    if (!face) {
      fail(`${doc.id}: font ${font.fontId} not in public/fonts/adstudio/manifest.json`);
      continue;
    }
    if (face.sha256 !== font.sha256) fail(`${doc.id}: font ${font.fontId} sha256 mismatch vs manifest`);
    if (!face.license) fail(`${doc.id}: font ${font.fontId} has no license in the manifest`);
    if (face.weight !== font.weight || Boolean(face.italic) !== font.italic) {
      fail(`${doc.id}: font ${font.fontId} weight/italic mismatch vs manifest`);
    }
  }
}

// ─── report ─────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`adstudio-templates-v2: ${failures.length} failure(s)`);
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`adstudio-templates-v2: ${docs.length} template(s) checked — schema, assets, fonts OK`);
