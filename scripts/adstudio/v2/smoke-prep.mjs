#!/usr/bin/env node
// Read-only smoke report. It may identify a layout that needs an operator to
// bake or repair, but it never mutates templates, restyles samples, or grants
// QA approval. The owner must make those decisions in Template Studio.

import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const gallery = join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2");

const smoke = async (doc) => {
  if (!doc.provenance?.sourceAd?.file) return null;
  const values = { images: {}, text: Object.fromEntries(doc.inputs.text.map((i) => [i.key, i.sample])) };
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    try {
      await renderAdDocToPng(doc, { schema: "adstudio.instance.v2", templateId: doc.id, templateHash: "0".repeat(64), format: layout.format, values, overrides: [] }, layout.format);
    } catch (error) {
      if (error?.layerId) return error.layerId;
    }
  }
  return null;
};

let failures = 0;
for (const id of readdirSync(gallery)) {
  const p = join(gallery, id, "template.json");
  if (!existsSync(p)) continue;
  let doc;
  try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  if (doc.schema !== "adstudio.template.v2") continue;

  const failingLayer = await smoke(doc);
  if (failingLayer) {
    failures += 1;
    console.log(`${id}: ${failingLayer} does not fit; repair or bake it in Template Studio, then rerun the real gate.`);
  }
}
console.log(`SMOKE REPORT DONE: ${failures} template(s) need operator attention; no files changed.`);
