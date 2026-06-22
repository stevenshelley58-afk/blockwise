// Renders gallery sample cards for standalone Ad Studio templates.
// Each standalone template owns its SVG; this script only rasterizes via sharp.
//   node scripts/adstudio-render-standalone-template-sample-cards.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderModernHouseForSaleSvg, modernHouseForSaleSample } from "../src/lib/adstudio/standalone-templates/modern-house-for-sale.ts";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PHOTOS = path.join(ROOT, "public/adstudio-samples/generated-au-properties");
const OUT = path.join(ROOT, "public/adstudio-samples/standalone");
async function durl(file, width) {
  const buf = await sharp(path.join(PHOTOS, file)).resize({ width, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
const s = modernHouseForSaleSample;
const svg = renderModernHouseForSaleSvg({
  format: "9:16",
  topLabel: s.content.topLabel,
  headline: s.content.headline,
  priceLabel: s.content.priceLabel,
  price: s.content.price,
  footer: s.content.footer,
  heroPhoto: await durl(s.heroPhoto, 1080),
  stripPhotos: await Promise.all(s.stripPhotos.map((f) => durl(f, 560))),
});
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, "standalone_modern_house_for_sale.png");
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outFile);
console.log("gallery sample written:", outFile);
