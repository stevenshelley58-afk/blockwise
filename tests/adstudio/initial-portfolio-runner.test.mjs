import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { initialPortfolioSpecs, validateInitialPortfolioContract } from "../../scripts/adstudio/v2/initial-portfolio-specs.mjs";
import { runStressMatrix } from "../../src/lib/adstudio/v2/fidelity-stress.ts";
import { buildRestyleSampleRenderInput } from "../../src/lib/adstudio/v2/restyle-assets.ts";
import { renderAdDocToPng } from "../../src/lib/adstudio/v2/render/server.ts";
import { hashCanonicalJson } from "../../src/lib/adstudio/v2/template-hash.ts";
import { templateDocV2Schema } from "../../src/lib/adstudio/v2/template-doc.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const RUNNER = join(ROOT, "scripts", "adstudio", "v2", "initial-portfolio-runner.mjs");
const VARIANT_PACK = join(ROOT, "scripts", "adstudio", "v2", "variant-pack.mjs");

const run = (args) => spawnSync(process.execPath, [RUNNER, ...args], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 30_000,
});

test("initial portfolio runner exposes a one-template durable-run interface", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--id <006\|meta-feed-006> --source <private-source-path>/);
});

test("initial portfolio runner refuses committed-checkout output", () => {
  const result = run(["--out", ROOT]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private assets root/);
});

test("initial portfolio runner rejects IDs outside the approved 20", () => {
  const out = mkdtempSync(join(tmpdir(), "blockwise-initial-portfolio-runner-"));
  try {
    const result = run(["--out", out, "--id", "999", "--source", join(ROOT, "package.json")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approved initial portfolio IDs/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("Frank skill requires one visible run per initial template and human approval", () => {
  const skill = readFileSync(join(ROOT, "hermes", "skills", "adstudio-template-builder-v2", "SKILL.md"), "utf8");
  assert.match(skill, /one durable, visible Frank\s+run/);
  assert.match(skill, /do not combine the 20 attachments into one invisible bulk run/i);
  assert.match(skill, /blocked_pending_human_approval/);
});

test("ID 006 cannot bypass the canonical authored runner contract", () => {
  assert.match(readFileSync(VARIANT_PACK, "utf8"), /validateInitialPortfolioContract\(contract\)/);
  assert.throws(
    () => validateInitialPortfolioContract({ templateId: "meta-006-canary", mode: "single-template" }),
    /canonical templateId meta-feed-006/,
  );
  assert.throws(
    () => validateInitialPortfolioContract({ templateId: "meta-feed-006", mode: "single-template" }),
    /canonical initial portfolioSpec/,
  );
  const canonical = validateInitialPortfolioContract({ templateId: "meta-feed-006", portfolioSpec: initialPortfolioSpecs["006"] });
  assert.equal(canonical.portfolioSpec.formats.feed.geometryFingerprint, initialPortfolioSpecs["006"].formats.feed.geometryFingerprint);
  const altered = structuredClone(initialPortfolioSpecs["006"]);
  altered.formats.story.geometryFingerprint = "[]";
  assert.throws(
    () => validateInitialPortfolioContract({ templateId: "meta-feed-006", portfolioSpec: altered }),
    /geometry\/structure must match/,
  );
});

test("ID 006 survives all ten long-copy and replacement-image stress renders", async () => {
  const out = mkdtempSync(join(tmpdir(), "blockwise-initial-006-stress-"));
  try {
    const source = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");
    const spec = initialPortfolioSpecs["006"];
    const samples = Object.fromEntries(spec.inputs.text.map((input) => [input.key, input.sample]));
    const contract = {
      schema: "adstudio.variant-pack.contract.v1",
      mode: "single-template",
      templateId: "meta-feed-006",
      packId: "meta-initial-006-stress",
      name: "Blockwise just-listed card+feature grid",
      sourceAd: {
        file: "01_feed_4x5_best/meta_006.png",
        contentHash: createHash("sha256").update(readFileSync(source)).digest("hex"),
      },
      text: {
        brand_name: samples.brand_name,
        headline: samples.headline,
        supporting: samples.supporting,
        handle: samples.contact,
        arrow: ">",
      },
      semanticValues: samples,
      portfolioSpec: spec,
      palette: spec.palette,
    };
    const contractPath = join(out, "meta-feed-006.contract.json");
    writeFileSync(contractPath, JSON.stringify(contract));
    const result = spawnSync(process.execPath, [
      VARIANT_PACK,
      "--contract",
      contractPath,
      "--repo",
      out,
      "--source",
      source,
      "--slot",
      source,
    ], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const candidate = out;
    const doc = JSON.parse(readFileSync(join(
      candidate,
      "src",
      "lib",
      "adstudio",
      "template-gallery-v2",
      "meta-feed-006",
      "template.json",
    ), "utf8"));
    const parsedDoc = templateDocV2Schema.parse(doc);
    assert.equal(hashCanonicalJson(parsedDoc), hashCanonicalJson(doc), "schema projection must preserve the complete generated document");
    assert.equal(parsedDoc.inputs.images[0].kind, "image");
    assert.equal(parsedDoc.inputs.images[0].sample, "SOURCE-FREE FIXTURE SLOT");
    assert.equal(parsedDoc.publish.requirements, null);
    assert.ok(parsedDoc.formats.feed.layers.some((layer) => layer.type === "icon" && layer.colourRole === "accent"));
    const legacySingleLineDoc = structuredClone(doc);
    for (const placement of ["feed", "story"]) {
      for (const layer of legacySingleLineDoc.formats[placement].layers) {
        if (layer.type !== "text" || !["headline", "address", "price"].includes(layer.inputKey)) continue;
        layer.constraints.maxLines = 1;
        delete layer.constraints.preferSingleLine;
      }
    }
    const text = Object.fromEntries(doc.inputs.text.map((input) => [input.key, input.sample]));
    for (const format of ["4:5", "9:16"]) {
      const current = buildRestyleSampleRenderInput({ doc, format, text, repoRoot: candidate });
      const legacy = buildRestyleSampleRenderInput({ doc: legacySingleLineDoc, format, text, repoRoot: candidate });
      const currentPng = await renderAdDocToPng(doc, current.instance, format, { repoRoot: candidate, slotBytes: current.slotBytes });
      const legacyPng = await renderAdDocToPng(legacySingleLineDoc, legacy.instance, format, { repoRoot: candidate, slotBytes: legacy.slotBytes });
      assert.deepEqual(currentPng, legacyPng, `${format} sample pixels must remain unchanged`);
    }
    const stress = await runStressMatrix(doc, { renderOptions: { repoRoot: candidate } });
    assert.equal(stress.entries.length, 10);
    assert.deepEqual(new Set(stress.entries.map((entry) => entry.scenario)), new Set([
      "longest-copy",
      "one-character-copy",
      "minimum-resolution",
      "all-portrait",
      "all-landscape",
    ]));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
