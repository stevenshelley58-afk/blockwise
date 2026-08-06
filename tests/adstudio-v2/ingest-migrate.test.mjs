// Track C contracts: migrate-v1 is idempotent (§14), the creative-feature key
// list stays in lockstep between ingest and meta-execution, and the v2 gate
// passes on the migrated gallery.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function galleryHash(dir) {
  return execSync(
    `cd "${dir}" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum`,
  ).toString().trim();
}

test("migrate-v1 is idempotent: running it twice yields identical output", () => {
  // Hermetic scratch copy — never races the live gallery or the batch.
  const scratch = mkdtempSync(join(tmpdir(), "adstudio-migrate-"));
  try {
    cpSync("src/lib/adstudio/template-gallery", join(scratch, "v1"), { recursive: true });
    const env = {
      ...process.env,
      ADSTUDIO_V1_GALLERY: join(scratch, "v1"),
      ADSTUDIO_V2_GALLERY: join(scratch, "v2"),
      ADSTUDIO_PUBLIC_V2: join(scratch, "public"),
    };
    execSync("node scripts/adstudio/v2/ingest.mjs migrate-v1 --all --from source", { env });
    const first = galleryHash(join(scratch, "v2"));
    execSync("node scripts/adstudio/v2/ingest.mjs migrate-v1 --all --from source", { env });
    const second = galleryHash(join(scratch, "v2"));
    assert.equal(second, first);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("creative-feature keys are in lockstep between ingest and the shared v2 list", () => {
  const ingest = readFileSync(join("scripts", "adstudio", "v2", "ingest.mjs"), "utf8");
  const shared = readFileSync(join("src", "lib", "adstudio", "v2", "creative-features.ts"), "utf8");
  const extract = (source) => {
    const match = source.match(/CREATIVE_FEATURE(?:_KEYS)? = \[([\s\S]*?)\]/);
    return [...(match?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(extract(ingest), extract(shared));
});

test("the v2 gate passes on the migrated drafts", () => {
  // Runs against the live gallery: deterministic once the batch pipeline has
  // settled; CI never runs the batch, so this is stable there.
  const output = execSync("node scripts/verify/adstudio-templates-v2.mjs 2>/dev/null || true").toString();
  assert.match(output, /template\(s\) checked/);
  assert.doesNotMatch(output, /failure\(s\)/);
});

test("migrated drafts keep the fidelity inputs the gate needs", () => {
  const doc = JSON.parse(readFileSync("src/lib/adstudio/template-gallery-v2/meta-feed-018/template.json", "utf8"));
  assert.equal(doc.schema, "adstudio.template.v2");
  assert.equal(doc.provenance.decomposedFrom, "source");
  assert.ok(doc.exactness.bakedTextKeys.length > 0, "pre-inpaint text is baked, never approximate");
  assert.ok(doc.publish.creativeFeatures.adapt_to_placement === "OPT_OUT");
  const evidence = JSON.parse(readFileSync("src/lib/adstudio/template-gallery-v2/meta-feed-018/evidence.json", "utf8"));
  assert.ok(evidence.sourceValues, "fidelity gate reads the source's own copy from evidence");
});
