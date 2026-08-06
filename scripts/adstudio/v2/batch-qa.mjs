#!/usr/bin/env node
// Track F batch: run decompose → story-draft → restyle → check over every
// v2 draft. Per-template error isolation; summary at the end. Build-time
// only (uses OPENAI_API_KEY for one masked inpaint per template).

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const gallery = join(process.cwd(), "src", "lib", "adstudio", "template-gallery-v2");
const ids = readdirSync(gallery, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const summary = { ok: [], failed: {} };
const steps = ["migrate-v1", "decompose", "story-draft", "restyle", "check"];

for (const id of ids) {
  for (const step of steps) {
    const stepArgs = [join(process.cwd(), "scripts", "adstudio", "v2", "ingest.mjs"), step, "--id", id];
    if (step === "migrate-v1" && process.env.BATCH_FORCE === "1") stepArgs.push("--force");
    const result = spawnSync(process.execPath, stepArgs, {
      encoding: "utf8",
      timeout: 240_000,
    });
    if (result.status !== 0) {
      summary.failed[id] = { step, error: (result.stderr ?? result.stdout ?? "").split("\n").slice(0, 4).join(" | ") };
      break;
    }
  }
  if (!summary.failed[id]) summary.ok.push(id);
  process.stdout.write(`${summary.ok.length + Object.keys(summary.failed).length}/${ids.length} ${id} ${summary.failed[id] ? `FAIL@${summary.failed[id].step}` : "ok"}\n`);
}

console.log(`\nBATCH DONE: ${summary.ok.length} ok, ${Object.keys(summary.failed).length} failed`);
for (const [id, info] of Object.entries(summary.failed)) console.log(`  ${id}: ${info.step} — ${info.error.slice(0, 200)}`);
