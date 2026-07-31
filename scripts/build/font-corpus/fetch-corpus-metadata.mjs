// Merges Google Fonts' public metadata endpoint (category/stroke/thickness/
// slant/width per family+weight — used for the cheap Stage A metric
// shortlist) with google-font-metadata's APIv2 (actual woff2/ttf download
// URLs per family/weight/style — used for Stage B pixel matching).
//
// Output is a build-time cache, not committed: scripts/build/font-corpus
// re-fetches it on demand. Only the *winning* typeSpecs and subset woff2
// faces get committed to the repo.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = path.resolve(process.cwd(), ".cache/font-corpus");
const OUT_FILE = path.join(CACHE_DIR, "corpus-metadata.json");

async function fetchGoogleFontsMetadata() {
  const response = await fetch("https://fonts.google.com/metadata/fonts", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BlockwiseAdStudioFontBuild/1.0)" },
  });
  if (!response.ok) throw new Error(`fonts.google.com/metadata/fonts failed: ${response.status}`);
  const text = await response.text();
  // Google prefixes this endpoint's body with an anti-JSON-hijacking guard.
  const jsonText = text.startsWith(")]}'") ? text.slice(text.indexOf("\n") + 1) : text;
  return JSON.parse(jsonText);
}

function normalizeWeightStyleKey(weightKey) {
  // fonts.google.com metadata keys are like "400", "400i", "700", "700i".
  const italic = weightKey.endsWith("i");
  const weight = Number.parseInt(weightKey, 10);
  return { weight, italic };
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  console.log("Fetching google-font-metadata APIv2 (download URLs)...");
  const gfm = await import("google-font-metadata");
  const apiV2 = gfm.APIv2;

  console.log("Fetching fonts.google.com/metadata/fonts (category/stroke/thickness/slant/width)...");
  const googleMeta = await fetchGoogleFontsMetadata();

  const metaByFamily = new Map();
  for (const entry of googleMeta.familyMetadataList) {
    metaByFamily.set(entry.family, entry);
  }

  const merged = [];
  let missingMeta = 0;
  for (const key of Object.keys(apiV2)) {
    const fam = apiV2[key];
    const meta = metaByFamily.get(fam.family);
    if (!meta) {
      missingMeta += 1;
      continue;
    }
    const faces = [];
    for (const weightKey of Object.keys(fam.variants ?? {})) {
      for (const styleKey of Object.keys(fam.variants[weightKey])) {
        const subsetsForStyle = fam.variants[weightKey][styleKey];
        // Prefer the widest-coverage subset with both woff2 and ttf.
        const subset = subsetsForStyle.latin ?? Object.values(subsetsForStyle)[0];
        if (!subset?.url?.truetype) continue;
        const metaKey = `${weightKey}${styleKey === "italic" ? "i" : ""}`;
        const fontsMeta = meta.fonts?.[metaKey];
        faces.push({
          weight: Number.parseInt(weightKey, 10),
          italic: styleKey === "italic",
          ttfUrl: subset.url.truetype,
          woff2Url: subset.url.woff2,
          thickness: fontsMeta?.thickness ?? null,
          slant: fontsMeta?.slant ?? null,
          width: fontsMeta?.width ?? null,
          lineHeight: fontsMeta?.lineHeight ?? null,
        });
      }
    }
    if (faces.length === 0) continue;
    merged.push({
      family: fam.family,
      id: fam.id,
      category: meta.category ?? null,
      stroke: meta.stroke ?? null,
      classifications: meta.classifications ?? [],
      isOpenSource: meta.isOpenSource !== false,
      popularity: meta.popularity ?? null,
      faces,
    });
  }

  console.log(`Merged ${merged.length} families (${missingMeta} had no fonts.google.com metadata match).`);
  const totalFaces = merged.reduce((sum, fam) => sum + fam.faces.length, 0);
  console.log(`Total faces available for matching: ${totalFaces}`);

  await writeFile(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), families: merged }, null, 0));
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
