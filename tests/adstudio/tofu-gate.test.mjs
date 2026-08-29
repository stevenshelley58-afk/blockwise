import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const REPO = join(import.meta.dirname, "..", "..");
const runNode = (args, env = {}) => spawnSync("node", args, { cwd: REPO, encoding: "utf8", env: { ...process.env, ...env }, timeout: 240000 });

const CONTRACT = {
  schema: "adstudio.variant-pack.contract.v1",
  mode: "multi-concept",
  packId: "meta-tofu-gate-test",
  count: 5,
  name: "Tofu Gate Test Pack",
  goal: "buyer_leads",
  offerId: "tofu-gate",
  category: "real-estate",
  tags: ["test"],
  audienceIntent: "buyers",
  classification: { ad_type: "single_image", primary_intent: "other", property_or_agent_focus: "property" },
  sourceAd: { file: "fixtures/int-bedroom.png", contentHash: "" },
  text: { headline: "COSTLY MISTAKES", supporting: "When Buying a Home", handle: "@yourhandle", arrow: ">" },
};

function gateEnv(candidate) {
  return {
    ADSTUDIO_GALLERY_V2_DIR: join(candidate, "src", "lib", "adstudio", "template-gallery-v2"),
    ADSTUDIO_PRIVATE_V2: join(candidate, "src", "lib", "adstudio", "template-assets-v2"),
    ADSTUDIO_PUBLIC_DIR: join(candidate, "public"),
    ADSTUDIO_V2_GATE_FAST: "1",
  };
}

describe("visual-output tofu gate", () => {
  it("healthy pack passes (fonts cover every codepoint; both placements render text)", () => {
    const candidate = mkdtempSync(join(os.tmpdir(), "adstudio-tofu-"));
    try {
      const sourceBytes = readFileSync(join(REPO, "public", "adstudio-samples", "photos", "int-bedroom.png"));
      CONTRACT.sourceAd.contentHash = createHash("sha256").update(sourceBytes).digest("hex");
      const contractPath = join(candidate, "contract.json");
      writeFileSync(contractPath, JSON.stringify(CONTRACT));
      const built = runNode(["scripts/adstudio/v2/variant-pack.mjs", "--contract", contractPath, "--repo", candidate, "--source", join(REPO, "public", "adstudio-samples", "photos", "int-bedroom.png")]);
      assert.equal(built.status, 0, built.stderr?.slice(0, 500));
      // both placements' samples must exist per variant
      for (let i = 1; i <= 5; i += 1) {
        const id = `meta-tofu-gate-test-v0${i}`;
        assert.ok(existsSync(join(candidate, "public", "adstudio-templates", id, "sample.png")), `${id} feed sample`);
        assert.ok(existsSync(join(candidate, "public", "adstudio-templates", id, "sample-story.png")), `${id} story sample`);
      }
      const gate = runNode(["scripts/verify/adstudio-templates-v2.mjs"], gateEnv(candidate));
      assert.equal(gate.status, 0, gate.stderr?.slice(0, 1200));
      assert.match(gate.stdout, /5 template\(s\) checked/);
      // hard-reset rerun: the release finalize re-runs every release-blocking
      // gate against the same candidate — a second, separate invocation must
      // produce the identical pass (cross-process determinism).
      const rerun = runNode(["scripts/verify/adstudio-templates-v2.mjs"], gateEnv(candidate));
      assert.equal(rerun.status, 0, rerun.stderr?.slice(0, 1200));
      assert.match(rerun.stdout, /5 template\(s\) checked/);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  });

  it("a face missing glyphs fails with an explicit tofu/missing-glyph report", () => {
    const candidate = mkdtempSync(join(os.tmpdir(), "adstudio-tofu-bad-"));
    try {
      const sourceBytes = readFileSync(join(REPO, "public", "adstudio-samples", "photos", "int-bedroom.png"));
      CONTRACT.sourceAd.contentHash = createHash("sha256").update(sourceBytes).digest("hex");
      const contractPath = join(candidate, "contract.json");
      writeFileSync(contractPath, JSON.stringify(CONTRACT));
      const built = runNode(["scripts/adstudio/v2/variant-pack.mjs", "--contract", contractPath, "--repo", candidate, "--source", join(REPO, "public", "adstudio-samples", "photos", "int-bedroom.png")]);
      assert.equal(built.status, 0);
      // replace barlow-600 with a stub woff2 (header only — not parseable as a
      // font carrying Latin glyphs), like the damaged corpus files
      const healthy = readFileSync(join(REPO, "public", "fonts", "adstudio", "barlow-600.woff2"));
      const broken = healthy.subarray(0, 48);
      writeFileSync(join(candidate, "public", "fonts", "adstudio", "barlow-600.woff2"), broken);
      const gate = runNode(["scripts/verify/adstudio-templates-v2.mjs"], gateEnv(candidate));
      assert.notEqual(gate.status, 0);
      assert.match(gate.stderr, /lacks glyphs|unreadable|no ink/);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  });
});
