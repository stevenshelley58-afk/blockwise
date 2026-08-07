#!/usr/bin/env node
// Track F auto-QA, owner-delegated (2026-08-06: "auto approve everything by
// default, will then review latter"). For every draft/qa template:
//   1. run the fidelity check (§10.2)
//   2. bake every editable text key whose residual exceeds 0.14 (the designed
//      escape hatch: source pixels stay; never "approximately right")
//   3. restyle (renders the public sample from the post-bake doc)
//   4. re-check; approve with an auditable, owner-delegated qaBy stamp.
// The approve gate still enforces story + restyle distance + thresholds; the
// owner's delegation is recorded verbatim in qaBy for later human review.

const QA_BY = "owner-delegated auto-QA (Steven, 2026-08-06) — review pending";

const { runFidelityCheck, runBake, runRestyle, approveTemplate } = await import(
  "../../../src/lib/adstudio/v2/studio.ts"
);
const { loadTemplateV2 } = await import("../../../src/lib/adstudio/v2/template-resolver.ts");
const { readdirSync } = await import("node:fs");
const { join } = await import("node:path");

const gallery = join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2");
const ids = readdirSync(gallery, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const { execFileSync } = await import("node:child_process");
const runStep = (step, id, extra = []) => {
  try {
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "adstudio", "v2", "ingest.mjs"), step, "--id", id, ...extra], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const summary = { approved: [], skipped: [], failed: {} };

for (const id of ids) {
  try {
    let doc = loadTemplateV2(id);
    if (!doc) {
      summary.skipped.push(id);
      continue;
    }
    if (doc.exactness.status === "ready") {
      summary.skipped.push(`${id} (already ready)`);
      continue;
    }

    // Drafts without plates (no budget for inpaint): heal with --no-inpaint.
    if (doc.exactness.status === "draft") {
      if (!runStep("decompose", id)) runStep("decompose", id, ["--no-inpaint"]);
      runStep("story-draft", id);
      runStep("restyle", id);
      runStep("check", id);
      doc = loadTemplateV2(id) ?? doc;
    }

    // 1. fidelity check
    let check = await runFidelityCheck(doc);
    // 2. bake over-threshold editable keys
    const over = Object.entries(check.residuals)
      .filter(([, residual]) => residual > check.threshold)
      .map(([layerId]) => layerId);
    for (const layerId of over) {
      const key = layerId.replace(/^text-/, "");
      if (doc.exactness.bakedTextKeys.includes(key)) continue;
      const layer = doc.formats.feed.layers.find((layer) => layer.id === layerId);
      if (!layer || layer.type !== "text") continue;
      const fresh = await runBake(doc, key, true);
      doc = { ...doc, exactness: { ...doc.exactness, bakedTextKeys: fresh.baked } };
    }
    // 3. restyle with the post-bake layers
    await runRestyle(doc);
    doc = loadTemplateV2(id) ?? doc;
    // 4. re-check then approve (gate re-verifies everything)
    check = await runFidelityCheck(doc);
    const stillOver = Object.entries(check.residuals).filter(([, r]) => r > check.threshold);
    if (stillOver.length > 0) {
      summary.failed[id] = `residuals over after bake: ${stillOver.map(([k]) => k).join(", ")}`;
      continue;
    }
    const result = await approveTemplate(doc, QA_BY, true);
    if (!result.ok) {
      summary.failed[id] = result.problems.join("; ");
      continue;
    }
    summary.approved.push(id);
    process.stdout.write(`${id} approved (${over.length} baked)\n`);
  } catch (error) {
    summary.failed[id] = error?.message ?? String(error);
    process.stdout.write(`${id} FAILED: ${summary.failed[id].slice(0, 120)}\n`);
  }
}

console.log(`\nAUTO-QA DONE: ${summary.approved.length} approved, ${summary.skipped.length} skipped, ${Object.keys(summary.failed).length} failed`);
for (const [id, reason] of Object.entries(summary.failed)) console.log(`  ${id}: ${reason.slice(0, 160)}`);
