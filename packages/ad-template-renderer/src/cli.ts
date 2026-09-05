#!/usr/bin/env node
// @ts-nocheck
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { renderBoth } from "./renderer.js";
import { adTemplateSchema } from "@blockwise/ad-template-contract";

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
  const parsed = adTemplateSchema.safeParse(artifact?.template);
  if (!parsed.success) throw new Error(formatContractError(parsed.error.issues));
  const template = parsed.data;
  validateSuppliedAssets(artifact?.assets, template.assets);
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

function formatContractError(issues) {
  const bounded = issues.slice(0, 32).map((issue) => ({ path: issue.path.slice(0, 12).map(String).join(".") || "template", message: String(issue.message).slice(0, 240) }));
  return `invalid_template_artifact ${JSON.stringify({ issues: bounded })}`;
}

function validateSuppliedAssets(suppliedAssets, declarations) {
  if (suppliedAssets === undefined) return;
  if (!Array.isArray(suppliedAssets)) throw new Error("invalid_template_artifact {\"issues\":[{\"path\":\"assets\",\"message\":\"must be an array\"}]}");
  const seen = new Set();
  for (const asset of suppliedAssets) {
    if (!asset || typeof asset !== "object" || typeof asset.assetKey !== "string") throw new Error("invalid_template_artifact {\"issues\":[{\"path\":\"assets\",\"message\":\"invalid supplied asset declaration\"}]}");
    if (seen.has(asset.assetKey)) throw new Error(`invalid_template_artifact {"issues":[{"path":"assets.${asset.assetKey}","message":"duplicate asset key"}]}`);
    seen.add(asset.assetKey);
    const declaration = declarations[asset.assetKey];
    if (!declaration) throw new Error(`invalid_template_artifact {"issues":[{"path":"assets.${asset.assetKey}","message":"asset key is not declared by template"}]}`);
    if (asset.fileName !== declaration.fileName || asset.mimeType !== declaration.mimeType) throw new Error(`invalid_template_artifact {"issues":[{"path":"assets.${asset.assetKey}","message":"fileName/mimeType does not match template declaration"}]}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
