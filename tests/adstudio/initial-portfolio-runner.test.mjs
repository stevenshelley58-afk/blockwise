import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { initialPortfolioSpecs, validateInitialPortfolioContract } from "../../scripts/adstudio/v2/initial-portfolio-specs.mjs";

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
