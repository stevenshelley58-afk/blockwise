#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { chartSvg } from "../../src/lib/email-design/line-chart.ts";

const fixture = JSON.parse(await readFile(resolve("src/lib/email-design/notification-examples.json"), "utf8"));
const output = resolve("public/email-assets");
await mkdir(output, { recursive: true });
const charts = [
  ["daily", fixture["daily-digest"].standard.chart],
  ["weekly", fixture["weekly-performance"].standard.chart],
];
for (const [name, chart] of charts) {
  for (const theme of ["light", "dark"]) {
    const svg = chartSvg(chart.values, { title: chart.title, unit: chart.unit, theme });
    const destination = resolve(output, `${name}-line-${theme}.png`);
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(destination);
    const metadata = await sharp(destination).metadata();
    if (metadata.width !== 1040 || metadata.height !== 360) throw new Error(`Unexpected dimensions for ${destination}`);
    console.log(`${destination} ${metadata.size ?? ""}`);
  }
}

