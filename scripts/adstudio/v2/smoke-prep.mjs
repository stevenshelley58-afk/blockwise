#!/usr/bin/env node
// §10.1 #9 prep (owner-delegated): the smoke/stress matrix must not throw on
// ready templates. When a text layer cannot fit the template's own sample
// copy above the 0.85 autofit floor, the law's escape hatch is bake: source
// pixels stay, the key becomes non-editable. Bounded by the layer count;
// the gate then verifies, and the approve flow re-stamps.

import { runBake, runRestyle, runFidelityCheck, approveTemplate } from "../../../src/lib/adstudio/v2/studio.ts";
import { renderAdDocToPng } from "../../../src/lib/adstudio/v2/render/server.ts";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const QA = "owner-delegated auto-QA (Steven, 2026-08-06) — review pending";
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

for (const id of readdirSync(gallery)) {
  const p = join(gallery, id, "template.json");
  if (!existsSync(p)) continue;
  let doc;
  try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
  if (doc.schema !== "adstudio.template.v2") continue;

  let guard = 0;
  for (;;) {
    const failingLayer = await smoke(doc);
    if (!failingLayer || guard >= 8) break;
    const key = failingLayer.replace(/^text-/, "");
    if (doc.exactness.bakedTextKeys.includes(key)) break;
    const baked = await runBake(doc, key, true);
    doc.exactness.bakedTextKeys = baked.baked;
    doc = await runRestyle(doc);
    const check = await runFidelityCheck(doc);
    doc.exactness.residuals = check.residuals;
    guard += 1;
  }
  if (guard > 0) {
    const result = await approveTemplate(doc, QA, true);
    writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(id, result.ok ? `smoke-prepped (${guard} baked)` : `REJECTED ${result.problems.join("; ").slice(0, 120)}`);
  }
}
console.log("SMOKE-PREP DONE");
