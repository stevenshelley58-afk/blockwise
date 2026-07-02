// Renders a JPEG sibling for every AdStudio gallery sample SVG. The clone
// pipeline sends the sample to image providers that accept only JPEG/PNG/WebP,
// and serverless sharp has no fontconfig — so the rasters are produced here
// (with real fonts) and committed. Run after adding or changing any sample:
//   node scripts/build/rasterize-adstudio-samples.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const dir = join(process.cwd(), "public", "adstudio-samples", "meta");
const svgs = readdirSync(dir).filter((name) => name.endsWith(".svg"));
if (svgs.length === 0) throw new Error(`No sample SVGs found in ${dir}.`);

let total = 0;
for (const name of svgs) {
  const jpeg = await sharp(readFileSync(join(dir, name)))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  const out = name.replace(/\.svg$/, ".jpg");
  writeFileSync(join(dir, out), jpeg);
  total += jpeg.length;
  console.log(`${out}  ${(jpeg.length / 1024).toFixed(0)} KB`);
}
console.log(`Rasterized ${svgs.length} sample(s), ${(total / 1024 / 1024).toFixed(1)} MB total.`);
