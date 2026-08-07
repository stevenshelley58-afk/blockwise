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
const { readdirSync, readFileSync, writeFileSync, existsSync } = await import("node:fs");
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

// Editable text layers whose boxes overlap by more than 5% of the smaller box
// on any layout — the schema forbids them; the repair loop bakes one of them.
const overlapViolators = (doc) => {
  const out = [];
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    const texts = layout.layers.filter((layer) => layer.type === "text" && !doc.exactness.bakedTextKeys.includes(layer.inputKey));
    for (let left = 0; left < texts.length; left += 1) {
      for (let right = left + 1; right < texts.length; right += 1) {
        const a = texts[left].box;
        const b = texts[right].box;
        const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        const inter = ix * iy;
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (smaller > 0 && inter / smaller > 0.05) out.push(texts[right].id);
      }
    }
  }
  return out;
};

// loadTemplateV2 validates; docs carrying stale (pre-clamp) residuals throw.
// Auto-QA is the repair tool, so it falls back to the in-memory doc.
const loadSafe = (tid) => {
  try {
    return loadTemplateV2(tid);
  } catch {
    return null;
  }
};

for (const id of ids) {
  try {
    let doc = null;
    try {
      doc = loadTemplateV2(id);
    } catch {
      // Corrupted docs (stale null residuals from the pre-clamp era) can't
      // parse; sanitize the residuals (they recompute) and reload.
      const rawPath = join(gallery, id, "template.json");
      if (existsSync(rawPath)) {
        const raw = JSON.parse(readFileSync(rawPath, "utf8"));
        if (raw?.schema === "adstudio.template.v2" && raw.exactness) {
          const liveLayerIds = new Set(
            [...(raw.formats?.feed?.layers ?? []), ...(raw.formats?.story?.layers ?? [])].map((layer) => layer.id),
          );
          raw.exactness.residuals = Object.fromEntries(
            Object.entries(raw.exactness.residuals ?? {}).filter(
              ([layerId, value]) => typeof value === "number" && liveLayerIds.has(layerId),
            ),
          );
          // Overlapping editables also make the schema throw; bake one side of
          // each pair so the doc loads and the normal repair loop takes over.
          const originalBaked = new Set(raw.exactness.bakedTextKeys ?? []);
          const baked = new Set(originalBaked);
          for (const layout of [raw.formats?.feed, raw.formats?.story]) {
            if (!layout) continue;
            const texts = (layout.layers ?? []).filter((layer) => layer.type === "text" && !baked.has(layer.inputKey));
            for (let left = 0; left < texts.length; left += 1) {
              for (let right = left + 1; right < texts.length; right += 1) {
                const a = texts[left].box;
                const b = texts[right].box;
                const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
                const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
                const inter = ix * iy;
                const smaller = Math.min(a.width * a.height, b.width * b.height);
                if (smaller > 0 && inter / smaller > 0.05) baked.add(texts[right].inputKey);
              }
            }
            layout.layers = (layout.layers ?? []).filter(
              (layer) => !(layer.type === "text" && baked.has(layer.inputKey)),
            );
          }
          const newlyBaked = [...baked].filter((key) => !originalBaked.has(key));
          for (const key of newlyBaked) delete raw.exactness.residuals?.[`text-${key}`];
          raw.exactness.bakedTextKeys = [...baked];
          writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
          doc = loadSafe(id);
          // Raw baking removed layers without rebuilding the plate with the
          // source pixels; unbake now so the repair loop's runBake(redo)
          // rebuilds the plate honestly.
          for (const key of newlyBaked) {
            if (!doc) break;
            try {
              const un = await runBake(doc, key, false);
              doc = { ...doc, exactness: { ...doc.exactness, bakedTextKeys: un.baked } };
            } catch {
              // leave as-is; the repair loop will take over
            }
          }
          // The restored layers need recorded residuals for the schema;
          // recompute and persist before reloading.
          if (doc) {
            const refreshed = await runFidelityCheck(doc);
            doc.exactness.residuals = refreshed.residuals;
            writeFileSync(rawPath, `${JSON.stringify(doc, null, 2)}\n`);
            doc = loadSafe(id);
          }
        }
      }
    }
    if (!doc) {
      summary.skipped.push(id);
      continue;
    }
    if (doc.exactness.status === "ready") {
      // Revalidate ready docs (some approvals predate the residual-clamp fix
      // and may carry contaminated nulls/over-threshold editables). The law:
      // ready requires residuals <= threshold AND no schema violations
      // (overlapping editables); repair honestly or demote.
      const recheck = await runFidelityCheck(doc);
      const over = Object.entries(recheck.residuals)
        .filter(([, residual]) => residual > recheck.threshold)
        .map(([layerId]) => layerId);
      const overlaps = overlapViolators(doc);
      if (over.length === 0 && overlaps.length === 0) {
        // Persist the fresh residuals so stale (pre-clamp) keys never linger
        // on disk (schema requires every residual to be a live layer id).
        doc.exactness.residuals = recheck.residuals;
        writeFileSync(join(gallery, id, "template.json"), `${JSON.stringify(doc, null, 2)}\n`);
        summary.skipped.push(`${id} (ready, revalidated)`);
        continue;
      }
      doc.exactness.status = "qa";
      // fall through to the bake/restyle/approve flow below
    }

    // Drafts without plates (no budget for inpaint): heal with --no-inpaint.
    if (doc.exactness.status === "draft") {
      if (!runStep("decompose", id)) runStep("decompose", id, ["--no-inpaint"]);
      runStep("story-draft", id);
      runStep("restyle", id);
      runStep("check", id);
      doc = loadSafe(id) ?? doc;
    }

    // 1. fidelity check
    let check = await runFidelityCheck(doc);
    // Persist fresh residuals so later writes never re-save stale nulls.
    doc.exactness.residuals = check.residuals;
    // 2. repair loop: bake over-threshold editables AND overlap violators
    // (the designed escape hatch — source pixels stay; nothing ships
    // approximately right). Bounded: the source's own design wins after 4
    // rounds and the doc remains qa for the human review.
    for (let round = 0; round < 4; round += 1) {
      const over = Object.entries(check.residuals)
        .filter(([, residual]) => residual > check.threshold)
        .map(([layerId]) => layerId);
      // Overlap violations surface in the schema; repair by baking one side.
      const overlaps = overlapViolators(doc);
      const toBake = [...new Set([...over, ...overlaps])]
        .map((layerId) => ({ layerId, key: layerId.replace(/^text-/, "") }))
        .filter(({ key }) => !doc.exactness.bakedTextKeys.includes(key));
      if (toBake.length === 0) break;
      for (const { key } of toBake) {
        const result = await runBake(doc, key, true);
        doc = { ...doc, exactness: { ...doc.exactness, bakedTextKeys: result.baked } };
      }
      await runRestyle(doc);
      doc = loadSafe(id) ?? doc;
      check = await runFidelityCheck(doc);
      doc.exactness.residuals = check.residuals;
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
