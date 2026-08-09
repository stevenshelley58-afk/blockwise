import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const ROOT = process.cwd();
const MANIFEST_DIR = path.join(ROOT, "src/lib/adstudio/template-gallery");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUT_DIR = path.join(PUBLIC_DIR, "adstudio-thumbnails/meta");
const THUMBNAIL_MAX_BYTES = 100_000;
const PREVIEW_MAX_BYTES = 300_000;

await mkdir(OUTPUT_DIR, { recursive: true });
const files = (await readdir(MANIFEST_DIR))
  .filter((file) => file.endsWith(".json") && file !== "quality-locks.json")
  .sort();
let generated = 0;

for (const file of files) {
  const manifest = JSON.parse(await readFile(path.join(MANIFEST_DIR, file), "utf8"));
  const sourcePath = path.join(PUBLIC_DIR, String(manifest.sample.imageSrc).replace(/^\//, ""));
  const hash = String(manifest.sample.contentHash);
  await encodeBounded(sourcePath, path.join(OUTPUT_DIR, `${hash}-320.webp`), 320, THUMBNAIL_MAX_BYTES);
  await encodeBounded(sourcePath, path.join(OUTPUT_DIR, `${hash}-640.webp`), 640, THUMBNAIL_MAX_BYTES);
  await encodeBounded(sourcePath, path.join(OUTPUT_DIR, `${hash}-preview.webp`), 1080, PREVIEW_MAX_BYTES);
  generated += 3;
}

process.stdout.write(`Generated ${generated} content-hashed Ad Studio display variants.\n`);

async function encodeBounded(sourcePath, outputPath, width, maxBytes) {
  let quality = width >= 1080 ? 80 : 74;
  let output;
  do {
    output = await sharp(sourcePath)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    quality -= 4;
  } while (output.byteLength > maxBytes && quality >= 38);

  if (output.byteLength > maxBytes) {
    throw new Error(`${path.basename(outputPath)} is ${output.byteLength} bytes (limit ${maxBytes}).`);
  }
  await writeFile(outputPath, output);
  const size = (await stat(outputPath)).size;
  if (size !== output.byteLength) throw new Error(`Incomplete output: ${outputPath}`);
}
