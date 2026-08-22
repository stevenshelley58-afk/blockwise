#!/usr/bin/env node
// Automated QA is advisory only. It may inspect fidelity, but it never edits a
// template, bakes text, performs a restyle, supplies a human identity, or sets
// status=ready. Approval remains a deliberate authenticated Studio action.

const { runFidelityCheck } = await import("../../../src/lib/adstudio/v2/studio.ts");
const { loadTemplateV2 } = await import("../../../src/lib/adstudio/v2/template-resolver.ts");
const { readdirSync } = await import("node:fs");
const { join } = await import("node:path");

const gallery = join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2");
const ids = readdirSync(gallery, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const summary = { checked: [], blocked: {} };
for (const id of ids) {
  try {
    const doc = loadTemplateV2(id);
    if (!doc) throw new Error("template could not be loaded");
    const check = await runFidelityCheck(doc);
    const over = Object.entries(check.residuals)
      .filter(([, residual]) => residual > check.threshold)
      .map(([layerId]) => layerId);
    summary.checked.push(id);
    process.stdout.write(`${id}: ${over.length ? `needs repair (${over.join(", ")})` : "fidelity measured; human Studio review required"}\n`);
  } catch (error) {
    summary.blocked[id] = error?.message ?? String(error);
    process.stdout.write(`${id}: blocked — ${summary.blocked[id]}\n`);
  }
}

console.log(`\nAUTO-QA ADVISORY: ${summary.checked.length} checked, ${Object.keys(summary.blocked).length} blocked; no docs changed and none approved.`);
