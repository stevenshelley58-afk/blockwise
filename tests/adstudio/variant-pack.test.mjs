import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { INITIAL_PORTFOLIO_IDS, initialPortfolioSpecs } from "../../scripts/adstudio/v2/initial-portfolio-specs.mjs";
import { INITIAL_FIXTURE_ASSIGNMENTS, SAFE_FIXTURE_CATALOG, resolveSafeFixtureCatalog, validateInitialFixtureAssignments } from "../../scripts/adstudio/v2/variant-pack.mjs";
import { hashCanonicalJson } from "../../src/lib/adstudio/v2/template-hash.ts";
import { assertCandidateEvidence } from "../../scripts/adstudio/v2/pack-release.mjs";
import { appendGeneration, createGenerationTrace } from "../../scripts/adstudio/v2/generation-trace.mjs";

// ---------------------------------------------------------------------------
// Authoritative pack-size regression: a request for "exactly 5 templates"
// must produce exactly five complete layered templates, each with native 4:5
// portrait AND 9:16 Story formats, all assets, editable inputs, the Meta
// publish block, and distinct layout skeletons — and the pack must pass the
// canonical verify gate (pack-aware) plus the pinned fixture corpus checks.
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE = process.execPath;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runNode(args, { cwd = ROOT, env = {}, timeout = 240_000 } = {}) {
  const result = spawnSync(NODE, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout });
  return result;
}

function skeletonSignature(doc) {
  const boxes = [];
  const q = (v) => Math.min(11, Math.max(0, Math.round(v * 12)));
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    if (!layout) continue;
    for (const layer of layout.layers) {
      boxes.push([q(layer.box.x), q(layer.box.y), q(layer.box.x + layer.box.width), q(layer.box.y + layer.box.height)].join(","));
    }
  }
  for (const box of Object.values(doc.__textBoxes ?? {})) {
    boxes.push([q(box.x), q(box.y), q(box.x + box.width), q(box.y + box.height)].join(","));
  }
  return boxes.sort().join("|");
}

const KNOWN_CREATIVE_FEATURES = [
  "adapt_to_placement", "image_touchups", "image_templates", "inline_comment",
  "enhance_cta", "text_optimizations", "image_animation", "image_background_gen",
  "video_auto_crop", "translate_voiceover", "text_translation", "media_type_automation",
  "product_extensions",
];

function assertCompleteVariant(docPath, index, sourceHash) {
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  assert.equal(doc.schema, "adstudio.template.v2");
  assert.equal(doc.provenance.packId, "meta-regression-pack-e67bfaec");
  assert.equal(doc.provenance.packVariantIndex, index);
  assert.equal(doc.provenance.sourceAd.contentHash, sourceHash);
  assert.ok(!doc.exactness.bakedTextKeys.length, "variants must expose editable text (nothing baked)");

  // both placements, native formats
  assert.equal(doc.formats.feed.format, "4:5");
  assert.equal(doc.formats.story.format, "9:16");
  assert.equal(doc.formats.feed.width, 1080);
  assert.equal(doc.formats.feed.height, 1350);
  assert.equal(doc.formats.story.width, 1080);
  assert.equal(doc.formats.story.height, 1920);

  // image slot + editable text inputs
  const slotKeys = new Set();
  for (const layout of [doc.formats.feed, doc.formats.story]) {
    for (const layer of layout.layers) {
      if (layer.type === "image_slot") slotKeys.add(layer.inputKey);
    }
  }
  for (const input of doc.inputs.images) assert.ok(slotKeys.has(input.key), `image input ${input.key} must have a slot`);
  assert.ok(doc.inputs.text.some((input) => input.key === "headline"));

  // publish block
  assert.equal(doc.publish.platform, "meta");
  assert.equal(doc.publish.cta, "LEARN_MORE");
  assert.ok(doc.publish.leadForm.questions.length >= 1);
  assert.ok((doc.publish.placements.facebookPositions ?? []).length > 0);
  assert.equal(doc.publish.formatRouting.feed, "4:5");
  assert.equal(doc.publish.formatRouting.story, "9:16");
  for (const field of ["primaryText", "headlines", "descriptions"]) {
    const values = doc.publish.copy[field];
    assert.ok(values.length >= 1 && values.length <= 5, `${field} must have 1..5 entries`);
  }
  for (const key of KNOWN_CREATIVE_FEATURES) assert.ok(key in doc.publish.creativeFeatures, `creativeFeatures must cover ${key}`);
  return doc;
}

describe("variant-pack — authoritative exactly-five pack", () => {
  it("derives exactly 5 complete templates with 4:5 + 9:16 from one source, and passes the verify gate", () => {
    const candidate = mkdtempSync(join(os.tmpdir(), "adstudio-pack-test-"));
    try {
      const source = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");
      const contract = {
        schema: "adstudio.variant-pack.contract.v1",
        mode: "multi-concept",
        packId: "meta-regression-pack-e67bfaec",
        count: 5,
        name: "Regression Pack",
        goal: "buyer_leads",
        offerId: "buyer-guide",
        category: "real-estate",
        tags: ["meta", "buyer-leads", "source-free", "regression"],
        audienceIntent: "buyers",
        classification: { ad_type: "single_image", primary_intent: "other", property_or_agent_focus: "property" },
        sourceAd: { file: "e67bfaec/int-bedroom.png", contentHash: sha256(readFileSync(source)) },
        text: { headline: "COSTLY MISTAKES", supporting: "When Buying a Home", handle: "@yourhandle", arrow: ">" },
      };
      const contractPath = join(candidate, "contract.json");
      writeFileSync(contractPath, JSON.stringify(contract));

      const result = runNode(["scripts/adstudio/v2/variant-pack.mjs", "--contract", contractPath, "--repo", candidate, "--source", source]);
      assert.equal(result.status, 0, `variant-pack failed:\n${result.stderr}`);
      const manifest = JSON.parse(result.stdout);
      assert.equal(manifest.count, 5);
      assert.equal(manifest.variantIds.length, 5);
      assert.ok(manifest.fixtureCorpus.copied && !manifest.fixtureCorpus.symlinked, "corpus must be copied, never symlinked");

      // exactly five template dirs in the candidate gallery
      const gallery = join(candidate, "src", "lib", "adstudio", "template-gallery-v2");
      const ids = readdirSync(gallery).filter((name) => !name.startsWith(".")).sort();
      assert.deepEqual(ids, manifest.variantIds.sort());

      // corpus is a REGULAR FILE inside the candidate (no dangling symlink)
      const corpusFile = join(candidate, "public", "adstudio-samples", "photos", "int-bedroom.png");
      assert.ok(existsSync(corpusFile), "candidate must carry the committed fixture corpus");
      const corpusStat = statSync(corpusFile);
      assert.ok(corpusStat.isFile() && !corpusStat.isSymbolicLink());

      // The default customer-photo slot must be the committed real safe photo,
      // not the abstract portrait placeholder. The slot remains a declared
      // editable input in every generated template.
      const slotFile = join(candidate, "public", "slots", "photo-portrait.png");
      assert.deepEqual(readFileSync(slotFile), readFileSync(source), "default gallery/editor slot must use the committed real photo");

      // every variant: complete doc + assets + distinct skeleton
      const signatures = new Set();
      for (let i = 0; i < 5; i += 1) {
        const id = manifest.variantIds[i];
        const doc = assertCompleteVariant(join(gallery, id, "template.json"), i + 1, contract.sourceAd.contentHash);
        assert.equal(doc.restyle.safeReplacementAssets.find((asset) => asset.inputKey === "customer_photo")?.sha256, sha256(readFileSync(source)));
        for (const [format, layout] of [["feed", doc.formats.feed], ["story", doc.formats.story]]) {
          const platePath = join(candidate, "src", "lib", "adstudio", "template-assets-v2", id, `plate-${format}.webp`);
          assert.ok(existsSync(platePath), `${id} ${format} plate missing`);
          assert.equal(sha256(readFileSync(platePath)), layout.plate.sha256, `${id} ${format} plate hash mismatch`);
        }
        const samplePath = join(candidate, "public", "adstudio-templates", id, "sample.png");
        assert.ok(existsSync(samplePath), `${id} sample missing`);
        assert.equal(sha256(readFileSync(samplePath)), doc.provenance.sample.contentHash);
        assert.notEqual(doc.provenance.sample.contentHash, doc.provenance.sourceAd.contentHash);
        assert.ok(existsSync(join(gallery, id, "evidence.json")));
        const evidence = JSON.parse(readFileSync(join(gallery, id, "evidence.json"), "utf8"));
        assert.equal(evidence.iteration.authority, "seed-only");
        assert.equal(evidence.iteration.accepted, false);
        assert.equal(evidence.iteration.durableRunRequired, true);
        signatures.add(skeletonSignature({ ...doc, __textBoxes: evidence.textBoxes ?? {} }));
      }
      assert.equal(signatures.size, 5, `variants must have 5 distinct layout skeletons, got ${signatures.size}`);

      // the canonical verify gate must PASS on the pack (fast mode)
      const verify = runNode(
        ["scripts/verify/adstudio-templates-v2.mjs"],
        {
          env: {
            ADSTUDIO_GALLERY_V2_DIR: gallery,
            ADSTUDIO_PRIVATE_V2: join(candidate, "src", "lib", "adstudio", "template-assets-v2"),
            ADSTUDIO_PUBLIC_DIR: join(candidate, "public"),
            ADSTUDIO_V2_GATE_FAST: "1",
          },
          timeout: 240_000,
        },
      );
      assert.equal(verify.status, 0, `verify gate failed on the pack:\n${verify.stdout}\n${verify.stderr}`);

      // the pack also passes the pinned fixture corpus check inside the candidate
      const gateCheck = runNode(
        ["-e", "import { verifyPinnedFixtureCorpus } from './scripts/adstudio/v2/subject-invariance.mjs'; verifyPinnedFixtureCorpus(process.argv[1]).then(()=>console.log('OK')).catch((e)=>{console.error(e);process.exit(1)})", candidate],
        { timeout: 120_000 },
      );
      assert.equal(gateCheck.status, 0, `fixture corpus check failed in candidate:\n${gateCheck.stderr}`);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  });

  it("assigns archetype-safe, unique fixtures across the 20-template launch portfolio", () => {
    const catalog = resolveSafeFixtureCatalog(ROOT);
    assert.ok(Object.keys(SAFE_FIXTURE_CATALOG).length >= 24, "the source-free fixture corpus should remain intentionally broad");
    validateInitialFixtureAssignments(catalog);
    const allKeys = INITIAL_PORTFOLIO_IDS.flatMap((id) => {
      const assignment = INITIAL_FIXTURE_ASSIGNMENTS[id];
      assert.ok(assignment, `${id} needs an explicit art-directed fixture assignment`);
      assert.equal(assignment.length, initialPortfolioSpecs[id].mediaCount, `${id} fixture count must match property media count`);
      assert.equal(new Set(assignment).size, assignment.length, `${id} must not reuse a fixture within its own slots`);
      for (const key of assignment) {
        assert.ok(catalog.has(key), `${id} references an unknown safe fixture ${key}`);
        const fixture = catalog.get(key);
        if (fixture.path) assert.match(fixture.path, /\\public\\(?:ads|home|adstudio-samples)\\/u, `${id} fixture must come from a safe public corpus`);
        else assert.ok(fixture.procedural, `${id} procedural fixture must declare source-free provenance`);
      }
      return assignment;
    });

    // Twenty-four safe fixtures are available. The lower bound and full-set
    // assertion catch accidental regression to the old three-house rotation
    // while allowing the one-slot archetypes to reuse assets across templates.
    assert.ok(new Set(allKeys).size >= 24, `launch corpus is too narrow: ${new Set(allKeys).size} unique fixtures`);
    assert.deepEqual(new Set(allKeys), new Set(Object.keys(SAFE_FIXTURE_CATALOG)), "every catalog fixture should be exercised by the launch portfolio");
    const heroKeys = INITIAL_PORTFOLIO_IDS.map((id) => INITIAL_FIXTURE_ASSIGNMENTS[id][0]);
    assert.equal(new Set(heroKeys).size, INITIAL_PORTFOLIO_IDS.length, "every launch ID needs a distinct hero fixture");
    const maxUse = Math.max(...[...new Set(allKeys)].map((key) => allKeys.filter((value) => value === key).length));
    assert.ok(maxUse <= 5, `one fixture is overused across the launch portfolio (${maxUse} slots)`);
    for (const [key, fixture] of catalog) {
      if (fixture.path) assert.ok(existsSync(fixture.path), `${key} must resolve to a committed file`);
      else assert.ok(fixture.procedural, `${key} must have a deterministic procedural definition`);
    }
  });

  it("single-template mode emits one semantic ID with Feed and Story layouts", () => {
    const candidate = mkdtempSync(join(os.tmpdir(), "adstudio-single-test-"));
    try {
      const source = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");
      const contract = {
        schema: "adstudio.variant-pack.contract.v1", mode: "single-template",
        packId: "meta-single-source-e67bfaec", name: "Single", goal: "buyer_leads", offerId: "buyer-guide",
        category: "real-estate", tags: ["meta"], audienceIntent: "buyers",
        classification: { ad_type: "single_image", primary_intent: "other", property_or_agent_focus: "property" },
        sourceAd: { file: "e67bfaec/int-bedroom.png", contentHash: sha256(readFileSync(source)) },
        text: { headline: "COSTLY MISTAKES", supporting: "When Buying a Home", handle: "@yourhandle", arrow: ">" },
      };
      const contractPath = join(candidate, "contract.json");
      writeFileSync(contractPath, JSON.stringify(contract));
      const result = runNode(["scripts/adstudio/v2/variant-pack.mjs", "--contract", contractPath, "--repo", candidate, "--source", source]);
      assert.equal(result.status, 0, result.stderr);
      const manifest = JSON.parse(result.stdout);
      assert.equal(manifest.mode, "single-template");
      assert.equal(manifest.count, 1);
      assert.equal(manifest.variantIds.length, 1);
      const gallery = join(candidate, "src", "lib", "adstudio", "template-gallery-v2");
      const doc = JSON.parse(readFileSync(join(gallery, manifest.variantIds[0], "template.json"), "utf8"));
      assert.equal(doc.formats.feed.format, "4:5");
      assert.equal(doc.formats.story.format, "9:16");
      assert.equal(doc.formats.feed.width, 1080);
      assert.equal(doc.formats.story.height, 1920);
      assert.equal(doc.name, "Single");

      // Release previews must derive the declared required image key rather
      // than assuming the builder's historical customer_photo name. Guidance
      // from the template publish contract must survive packaging too.
      const renamedDocPath = join(candidate, "src", "lib", "adstudio", "template-gallery-v2", manifest.variantIds[0], "template.json");
      const renamedDoc = JSON.parse(JSON.stringify(doc).replaceAll("customer_photo", "customer_image"));
      renamedDoc.publish.aiWritingGuidance = {
        summary: "Use the approved overlay and off-canvas wording.",
        fields: { headline: "Use the declared headline constraint." },
        overlay: "Keep the badge factual.",
        offCanvas: { primaryText: "Do not invent offer details." },
      };
      writeFileSync(renamedDocPath, JSON.stringify(renamedDoc));

      const signingDir = join(candidate, "signing");
      mkdirSync(signingDir, { recursive: true });
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const signingKey = join(signingDir, "pack-signing.pem");
      writeFileSync(signingKey, privateKey.export({ type: "pkcs8", format: "pem" }));
      const approvalReceipt = join(signingDir, "approval.json");
      writeFileSync(approvalReceipt, JSON.stringify({
        decision: "approved",
        gate: "native-pixel-human-approval",
        receipt_ref: "hermes://receipts/native-pixel-test-approval",
        decided_at: "2026-08-29T00:00:00.000Z",
      }));
      const publicRoot = join(candidate, "public-releases");
      const released = runNode([
        "scripts/adstudio/v2/pack-release.mjs", "--candidate", candidate,
        "--run", "trun_1234567890abcdef1234567890abcdef", "--trace", "trace-test",
        "--job", "single release test", "--scope", "blockwise", "--settings-revision", "1",
        "--approval", approvalReceipt,
      ], { env: {
        HERMES_HOME: join(candidate, "hermes-home"),
        FRANK_PUBLIC_RELEASE_ROOT: publicRoot,
        FRANK_PACK_SIGNING_KEY_FILE: signingKey,
      } });
      // A newly generated candidate remains `qa` until the iterative fidelity,
      // stress, and native-pixel review receipts are attached.  Approval alone
      // must never upgrade it into a releasable pack.
      assert.equal(released.status, 1);
      assert.match(`${released.stdout}\n${released.stderr}`, /requires exactness\.status=ready/);

      // The first attempt intentionally proves that a fresh seed cannot be
      // released.  Now attach the same evidence a completed Frank/Hermes run
      // would persist and exercise the success path that used to be hidden by
      // the unconditional return above.
      const templatePath = join(gallery, manifest.variantIds[0], "template.json");
      const evidencePath = join(gallery, manifest.variantIds[0], "evidence.json");
      const readyDoc = JSON.parse(readFileSync(templatePath, "utf8"));
      readyDoc.exactness.status = "ready";
      const fidelityHash = hashCanonicalJson({
        ...readyDoc,
        exactness: { bakedTextKeys: [...(readyDoc.exactness.bakedTextKeys ?? [])].sort() },
      });
      const residual = { templateHash: fidelityHash, outside: { differingPixels: 0 } };
      const stressEntries = Array.from({ length: 10 }, (_, index) => ({
        format: index < 5 ? "4:5" : "9:16",
        scenario: ["longest-copy", "one-character-copy", "minimum-resolution", "all-portrait", "all-landscape"][index % 5],
        renderHash: readyDoc.provenance.sample.contentHash,
      }));
      const stress = {
        templateHash: fidelityHash,
        entries: stressEntries,
        matrixHash: hashCanonicalJson({ templateHash: fidelityHash, entries: stressEntries }),
      };
      readyDoc.exactness.residualEvidence = residual;
      readyDoc.exactness.stressEvidence = stress;
      readyDoc.exactness.reviewEvidence = {
        templateHash: fidelityHash,
        sourceContentHash: readyDoc.provenance.sourceAd.contentHash,
        sampleContentHash: readyDoc.provenance.sample.contentHash,
        fidelityEvidenceHash: hashCanonicalJson(residual),
        stressEvidenceHash: hashCanonicalJson(stress),
      };
      writeFileSync(templatePath, `${JSON.stringify(readyDoc, null, 2)}\n`);

      const readyTrace = appendGeneration(
        createGenerationTrace({
          templateId: manifest.variantIds[0],
          sourceSha256: readyDoc.provenance.sourceAd.contentHash,
          seedSha256: readyDoc.provenance.sample.contentHash,
        }),
        {
          feedSha256: readyDoc.provenance.sample.contentHash,
          storySha256: readyDoc.provenance.storySample.contentHash,
          renderSetSha256: "d".repeat(64),
          primaryReviewer: "vision-primary-v1",
          strictReviewer: "vision-strict-v1",
          primaryScore: 9.8,
          strictScore: 9.6,
          revisionReason: "Both independent reviewers accepted the current render",
        },
      );
      const readyTemplateBytes = readFileSync(templatePath);
      const readyEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      readyEvidence.templateSha256 = sha256(readyTemplateBytes);
      readyEvidence.iteration = {
        ...readyEvidence.iteration,
        status: "accepted",
        authority: "durable-run",
        accepted: true,
        durableRunRequired: true,
      };
      readyEvidence.generationTrace = readyTrace;
      readyEvidence.qa = {
        feedPassed: true,
        storyPassed: true,
        stressFixtureResults: Object.fromEntries(stressEntries.map((_, index) => [`case-${index}`, { passed: true }])),
      };
      writeFileSync(evidencePath, `${JSON.stringify(readyEvidence, null, 2)}\n`);

      const acceptedEvidence = JSON.parse(readFileSync(evidencePath, "utf8"));
      const acceptedDoc = JSON.parse(readFileSync(templatePath, "utf8"));
      const acceptedTemplateBytes = readFileSync(templatePath);
      const qaEvidence = assertCandidateEvidence({
        templateId: manifest.variantIds[0],
        doc: acceptedDoc,
        evidence: acceptedEvidence,
        templateBytes: acceptedTemplateBytes,
      });
      assert.equal(qaEvidence.feedPassed, true);
      assert.equal(qaEvidence.storyPassed, true);
      assert.equal(Object.keys(qaEvidence.stressFixtureResults).length, 10);
    } finally {
      const privateReleaseRoot = join(candidate, "hermes-home", "tool_releases", "ad-template-generator");
      if (existsSync(privateReleaseRoot)) {
        for (const releaseId of readdirSync(privateReleaseRoot)) {
          try { chmodSync(join(privateReleaseRoot, releaseId), 0o755); } catch {}
        }
      }
      rmSync(candidate, { recursive: true, force: true });
    }
  });

  it("two INDEPENDENT templates from one source still fail the gate (no weakening)", () => {
    const candidate = mkdtempSync(join(os.tmpdir(), "adstudio-dup-test-"));
    try {
      const source = join(ROOT, "public", "adstudio-samples", "photos", "int-bedroom.png");
      const contract = {
        schema: "adstudio.variant-pack.contract.v1",
        mode: "multi-concept",
        packId: "meta-dup-source-e67bfaec",
        count: 2,
        name: "Dup Source",
        goal: "buyer_leads",
        offerId: "buyer-guide",
        category: "real-estate",
        tags: ["meta"],
        audienceIntent: "buyers",
        classification: { ad_type: "single_image", primary_intent: "other", property_or_agent_focus: "property" },
        sourceAd: { file: "e67bfaec/int-bedroom.png", contentHash: sha256(readFileSync(source)) },
        text: { headline: "COSTLY MISTAKES", supporting: "When Buying a Home", handle: "@yourhandle", arrow: ">" },
      };
      const contractPath = join(candidate, "contract.json");
      writeFileSync(contractPath, JSON.stringify(contract));
      const built = runNode(["scripts/adstudio/v2/variant-pack.mjs", "--contract", contractPath, "--repo", candidate, "--source", source]);
      assert.equal(built.status, 0, built.stderr);

      // strip the pack declaration from the SECOND doc -> an independent same-source template
      const gallery = join(candidate, "src", "lib", "adstudio", "template-gallery-v2");
      const secondId = JSON.parse(readFileSync(join(candidate, "variant-pack.manifest.json"), "utf8")).variantIds[1];
      const docPath = join(gallery, secondId, "template.json");
      const doc = JSON.parse(readFileSync(docPath, "utf8"));
      delete doc.provenance.packId;
      delete doc.provenance.packVariantIndex;
      writeFileSync(docPath, JSON.stringify(doc));

      const verify = runNode(
        ["scripts/verify/adstudio-templates-v2.mjs"],
        {
          env: {
            ADSTUDIO_GALLERY_V2_DIR: gallery,
            ADSTUDIO_PRIVATE_V2: join(candidate, "src", "lib", "adstudio", "template-assets-v2"),
            ADSTUDIO_PUBLIC_DIR: join(candidate, "public"),
            ADSTUDIO_V2_GATE_FAST: "1",
          },
        },
      );
      assert.notEqual(verify.status, 0, "same-source duplicate without pack declaration must fail");
      assert.match(verify.stdout + verify.stderr, /one source, one template/);
    } finally {
      rmSync(candidate, { recursive: true, force: true });
    }
  });
});
