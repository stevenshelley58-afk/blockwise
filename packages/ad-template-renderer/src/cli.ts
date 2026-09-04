#!/usr/bin/env node
// @ts-nocheck
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { renderBoth } from "./renderer.js";

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
async function main() {
  const args = process.argv.slice(2);
  const inputPath = option(args, "--input");
  const assetsDir = resolve(option(args, "--assets-dir", "."));
  const outDir = resolve(option(args, "--out-dir", "./rendered"));
  if (!inputPath) { console.error("Usage: ad-template-render --input artifact.json [--assets-dir dir] [--out-dir dir]"); process.exitCode = 2; return; }
  const artifact = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const template = artifact?.template;
  if (!template || template.schema !== "blockwise.ad-template") throw new Error("invalid_template_artifact");
  const imageValues = {};
  for (const [assetKey, declared] of Object.entries(template.assets ?? {})) {
    const supplied = (artifact.assets ?? []).find((asset) => asset.assetKey === assetKey);
    const fileName = supplied?.fileName ?? declared.fileName;
    imageValues[assetKey] = supplied?.bytesBase64 ? Buffer.from(supplied.bytesBase64, "base64") : await readFile(join(assetsDir, basename(fileName)));
  }
  for (const input of template.imageInputs ?? []) {
    const key = input.defaultAssetKey;
    if (typeof key === "string" && !imageValues[input.key] && imageValues[key]) imageValues[input.key] = imageValues[key];
  }
  const fontValues = {};
  for (const font of template.fonts ?? []) {
    const file = basename(font.file);
    try { fontValues[font.file] = await readFile(join(assetsDir, file)); } catch {}
  }
  const [feed, story] = await renderBoth({ template: template, imageValues, textValues: Object.fromEntries((template.textInputs ?? []).map((input) => [input.key, input.placeholder])), colourMap: template.semanticColours, fontValues });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "feed.png"), feed.png);
  await writeFile(join(outDir, "story.png"), story.png);
  const receipt = { templateId: template.templateId, outputs: { feed: { path: join(outDir, "feed.png"), width: feed.width, height: feed.height }, story: { path: join(outDir, "story.png"), width: story.width, height: story.height } } };
  await writeFile(join(outDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
