// Downloads only the exact open-source Google Font faces that passed the
// offline Magic Layers fidelity gates, then records their immutable hashes.
// Low-confidence regions keep their measured spec but do not receive a
// fontFile, which forces the safe image-model edit path at runtime.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { APILicense, APIv2 } from "google-font-metadata";
import {
  MAGIC_LAYER_MIN_FONT_FIT,
  MAGIC_LAYER_MIN_REGION_CONFIDENCE,
} from "../../../src/lib/adstudio/magic-layers-config.mjs";
import { parseArgs, selectTemplateFiles } from "./type-specs-args.mjs";

const ROOT = process.cwd();
const GALLERY_DIR = path.join(ROOT, "src/lib/adstudio/template-gallery");
const OUTPUT_DIR = path.join(ROOT, "public/fonts/adstudio");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function faceName(spec) {
  return `${spec.fontId}-${spec.weight}${spec.italic ? "-italic" : ""}.woff2`;
}

function eligible(spec) {
  return Number(spec?.fitScore) >= MAGIC_LAYER_MIN_FONT_FIT
    && Number(spec?.detectionScore) >= MAGIC_LAYER_MIN_REGION_CONFIDENCE;
}

async function main() {
  const { help, templateIds } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("Usage: node scripts/build/font-corpus/build-runtime-fonts.mjs [--template <id[,id...]>]");
    return;
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  const allFiles = (await readdir(GALLERY_DIR)).filter((file) => file.endsWith(".json")).sort();
  const files = selectTemplateFiles(allFiles, templateIds);
  const targeted = templateIds.size > 0;
  const templates = [];
  const wanted = new Map();
  const excluded = new Map();

  for (const file of files) {
    const filePath = path.join(GALLERY_DIR, file);
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    templates.push({ filePath, raw });
    for (const spec of Object.values(raw.typography ?? {})) {
      delete spec.fontFile;
      if (!eligible(spec)) continue;
      const metadata = APIv2[spec.fontId];
      const license = APILicense[spec.fontId];
      const style = spec.italic ? "italic" : "normal";
      const sourceUrl = metadata?.variants?.[String(spec.weight)]?.[style]?.latin?.url?.woff2;
      if (!sourceUrl || !license?.license?.type) {
        excluded.set(`${spec.fontId}:${spec.weight}:${style}`, {
          fontId: spec.fontId,
          weight: spec.weight,
          italic: spec.italic,
          reason: !sourceUrl ? "no Google Fonts Latin woff2" : "no verified open-font license",
        });
        continue;
      }
      const name = faceName(spec);
      wanted.set(name, {
        file: `/fonts/adstudio/${name}`,
        fontId: spec.fontId,
        family: spec.family,
        weight: spec.weight,
        italic: spec.italic,
        sourceUrl,
        license: license.license.type,
        licenseUrl: license.license.url,
      });
    }
  }

  let existingManifest = { faces: [], excluded: [] };
  if (targeted) {
    try {
      existingManifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    } catch {
      // A targeted first run simply creates the manifest.
    }
  }
  const downloadedFaces = [];
  for (const [name, face] of [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = existingManifest.faces.find((entry) => entry.file === face.file);
    if (existing) {
      downloadedFaces.push(existing);
      continue;
    }
    const response = await fetch(face.sourceUrl);
    if (!response.ok) throw new Error(`Could not download ${face.sourceUrl} (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(path.join(OUTPUT_DIR, name), bytes);
    downloadedFaces.push({ ...face, sha256: hash(bytes), bytes: bytes.byteLength });
  }

  const manifest = targeted
    ? [...new Map(
        [...existingManifest.faces, ...downloadedFaces].map((face) => [face.file, face]),
      ).values()].sort((left, right) => left.file.localeCompare(right.file))
    : downloadedFaces;
  const available = new Set(manifest.map((face) => face.file));
  let liveRegions = 0;
  for (const { filePath, raw } of templates) {
    for (const spec of Object.values(raw.typography ?? {})) {
      if (!eligible(spec)) continue;
      const file = `/fonts/adstudio/${faceName(spec)}`;
      if (!available.has(file)) continue;
      spec.fontFile = file;
      liveRegions += 1;
    }
    await writeFile(filePath, `${JSON.stringify(raw, null, 2)}\n`);
  }

  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      gates: {
        minFontFit: MAGIC_LAYER_MIN_FONT_FIT,
        minRegionConfidence: MAGIC_LAYER_MIN_REGION_CONFIDENCE,
      },
      faces: manifest,
      excluded: targeted
        ? [...new Map(
            [...(existingManifest.excluded ?? []), ...excluded.values()]
              .map((entry) => [`${entry.fontId}:${entry.weight}:${entry.italic}`, entry]),
          ).values()]
        : [...excluded.values()],
    }, null, 2)}\n`,
  );
  console.log(
    `${targeted ? "Updated" : "Wrote"} ${downloadedFaces.length} selected face(s) `
    + `for ${liveRegions} high-confidence text region(s); manifest has ${manifest.length} face(s).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
