#!/usr/bin/env node

// QA-only contact sheet builder for layered Ad Studio candidates. It never
// mutates candidate assets; it reads native samples and writes one overview.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import sharp from "sharp";

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const rootValue = arg("--root");
const outValue = arg("--out");
const placement = arg("--placement") || "feed";
const columns = Number(arg("--columns") || 5);
if (!rootValue || !outValue || !["feed", "story"].includes(placement) || !Number.isInteger(columns) || columns < 1) {
  throw new Error("usage: contact-sheet.mjs --root <public/adstudio-templates> --out <sheet.png> --placement <feed|story> [--columns 5]");
}
const root = resolve(rootValue);
const out = resolve(outValue);
if (!existsSync(root)) throw new Error(`sample root does not exist: ${root}`);

const fileName = placement === "story" ? "sample-story.png" : "sample.png";
const entries = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, fileName)))
  .sort((left, right) => left.name.localeCompare(right.name));
if (entries.length === 0) throw new Error(`no ${fileName} files beneath ${root}`);

const tileWidth = placement === "story" ? 180 : 216;
const imageHeight = placement === "story" ? 320 : 270;
const labelHeight = 34;
const gutter = 12;
const tileHeight = labelHeight + imageHeight;
const rows = Math.ceil(entries.length / columns);
const width = columns * tileWidth + (columns + 1) * gutter;
const height = rows * tileHeight + (rows + 1) * gutter;
const escapeXml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const composites = [];
for (const [index, entry] of entries.entries()) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = gutter + column * (tileWidth + gutter);
  const top = gutter + row * (tileHeight + gutter);
  const sample = await sharp(join(root, entry.name, fileName))
    .resize(tileWidth, imageHeight, { fit: "fill" })
    .png()
    .toBuffer();
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${labelHeight}">
    <rect width="100%" height="100%" fill="#18181b"/>
    <text x="10" y="23" fill="#fafafa" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(entry.name)} · ${placement.toUpperCase()}</text>
  </svg>`);
  composites.push({ input: label, left, top });
  composites.push({ input: sample, left, top: top + labelHeight });
}

await sharp({ create: { width, height, channels: 4, background: "#e4e4e7" } })
  .composite(composites)
  .png()
  .toFile(out);

process.stdout.write(`${JSON.stringify({ out, placement, templates: entries.length, width, height })}\n`);
