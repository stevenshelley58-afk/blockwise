import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { initialTemplateBuildQueue } from "../../src/lib/adstudio/v2/initial-template-build-queue.ts";

const root = process.cwd();

test("launch portfolio registers exactly 20 unique 4:5 feed sources", () => {
  assert.equal(initialTemplateBuildQueue.length, 20);
  assert.equal(new Set(initialTemplateBuildQueue.map((template) => template.id)).size, 20);
  assert.equal(new Set(initialTemplateBuildQueue.map((template) => template.sourceFile)).size, 20);

  for (const template of initialTemplateBuildQueue) {
    assert.match(template.sourceFile, /^01_feed_4x5_best\/meta_\d{3}\.png$/);
    assert.match(template.sourceSha256, /^[a-f0-9]{64}$/);
    assert.ok(template.selectionReason.trim().length >= 16, `${template.id} needs a meaningful selection reason`);
    assert.ok(template.evidenceRef.trim().length > 0, `${template.id} is missing evidence provenance`);
    assert.doesNotMatch(template.sourceFile, /^(?:public|src|\.\.)(?:[\\/]|$)/i, `${template.id} exposes a tracked/public source path`);

    // Private candidate bytes are available to local builder runs, but are
    // deliberately absent from CI and Vercel. Validate them opportunistically.
    const sourcePath = join(root, "meta_ad_candidates", template.sourceFile);
    if (existsSync(sourcePath)) {
      const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
      assert.equal(sourceHash, template.sourceSha256, `${template.id} source hash drifted`);
    }
  }
});

test("private raw candidate inventory is ignored by git", () => {
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /(?:^|\r?\n)meta_ad_candidates\/(?:\r?\n|$)/);
});
