#!/usr/bin/env node
//
// Generates skeleton SVG layout previews for every AdStudio gallery template.
// Each SVG is a wireframe: shapes/images as filled rects, text as <text> elements
// using sampleCopy where available. Written to public/adstudio-samples/meta/<id>.svg.
//
// Run: node scripts/generate-adstudio-samples.mjs

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const GAL = join(root, "src", "lib", "adstudio", "template-gallery");
const OUT = join(root, "public", "adstudio-samples", "meta");

mkdirSync(OUT, { recursive: true });

const files = readdirSync(GAL).filter((n) => /^meta-.*\.json$/u.test(n)).sort();

let count = 0;
for (const fn of files) {
  const t = JSON.parse(readFileSync(join(GAL, fn), "utf8"));
  const id = t.id;
  const W = t.canvas?.width ?? 1080;
  const H = t.canvas?.height ?? 1350;
  const objs = Array.isArray(t.canvas?.objects) ? t.canvas.objects : [];
  const sample = t.sampleCopy ?? {};

  // Map role → sample copy text
  const copyByRole = {
    headline: sample.headline ?? "",
    subheadline: sample.description ?? "",
    cta_text: sample.cta ?? "",
    value_proposition: sample.primaryText ?? "",
    body_text: sample.primaryText ?? "",
    primary_text: sample.primaryText ?? "",
    description_text: sample.description ?? "",
  };

  const elements = [];

  // Background
  elements.push(`<rect width="${W}" height="${H}" fill="#f0ede8"/>`);

  for (const o of objs) {
    const x = o.x ?? 0;
    const y = o.y ?? 0;
    const w = o.width ?? 100;
    const h = o.height ?? 40;
    const fill = o.fill ?? "#cccccc";

    if (o.type === "image") {
      // Image slot: neutral grey with a label
      const label = o.role ?? "photo";
      const cx = x + w / 2;
      const cy = y + h / 2;
      const fs = Math.min(28, Math.max(14, Math.round(h * 0.15)));
      elements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d0cdc8" rx="4"/>`);
      elements.push(
        `<text x="${cx}" y="${cy + fs / 3}" text-anchor="middle" font-family="sans-serif" font-size="${fs}" fill="#888">[${label}]</text>`,
      );
    } else if (o.type === "text") {
      // Text: render with sample copy where available
      const rawText = copyByRole[o.role] || o.content || "";
      const text = rawText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const fs = Math.max(o.size ?? 24, 12);
      const fw = o.weight ?? 400;
      const anchor = o.align === "center" ? "middle" : o.align === "right" ? "end" : "start";
      const tx = o.align === "center" ? x + w / 2 : o.align === "right" ? x + w : x;
      const ty = y + fs;
      const textFill = fill && fill !== "#00000000" ? fill : "#222222";
      // Clip long text to the declared width
      elements.push(
        `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="sans-serif" font-size="${fs}" font-weight="${fw}" fill="${textFill}" clip-path="url(#clip-${o.objectId})">${text}</text>`,
      );
      elements.push(
        `<clipPath id="clip-${o.objectId}"><rect x="${x}" y="${y}" width="${w}" height="${h + fs}"/></clipPath>`,
      );
    } else if (o.type === "shape") {
      const r = o.radius ?? 0;
      elements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${r}"/>`);
      // If shape has content (e.g. badge), render it
      if (o.content) {
        const cx = x + w / 2;
        const cy = y + h / 2 + 5;
        const safeContent = o.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        elements.push(
          `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#fff">${safeContent}</text>`,
        );
      }
    } else if (o.type === "logo") {
      elements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#888" rx="4"/>`);
      const cx = x + w / 2;
      const cy = y + h / 2 + 5;
      elements.push(
        `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#fff">[logo]</text>`,
      );
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n  ${elements.join("\n  ")}\n</svg>\n`;

  const outPath = join(OUT, `${id}.svg`);
  writeFileSync(outPath, svg, "utf8");
  count++;
}

console.log(`Generated ${count} SVG sample(s) → ${OUT}`);
