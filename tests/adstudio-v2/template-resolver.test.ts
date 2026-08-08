import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveReadyTemplateV2 } from "../../src/lib/adstudio/v2/template-resolver.ts";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "adstudio-v2");

test("public resolver hides a QA template and returns an approved template", () => {
  const galleryDir = mkdtempSync(join(tmpdir(), "adstudio-v2-public-resolver-"));
  try {
    cpSync(join(fixtureRoot, "meta-fixture-story"), join(galleryDir, "meta-ready"), { recursive: true });
    const readyPath = join(galleryDir, "meta-ready", "template.json");
    const ready = JSON.parse(readFileSync(readyPath, "utf8"));
    ready.id = "meta-ready";
    writeFileSync(readyPath, `${JSON.stringify(ready, null, 2)}\n`);

    cpSync(join(galleryDir, "meta-ready"), join(galleryDir, "meta-qa"), { recursive: true });
    const qaPath = join(galleryDir, "meta-qa", "template.json");
    const qa = JSON.parse(readFileSync(qaPath, "utf8"));
    qa.id = "meta-qa";
    qa.exactness.status = "qa";
    writeFileSync(qaPath, `${JSON.stringify(qa, null, 2)}\n`);

    const env = { ...process.env, ADSTUDIO_GALLERY_V2_DIR: galleryDir };
    assert.equal(resolveReadyTemplateV2("meta-qa", env), null, "QA must map to the route's 404 branch");
    assert.equal(resolveReadyTemplateV2("meta-ready", env)?.id, "meta-ready");
  } finally {
    rmSync(galleryDir, { recursive: true, force: true });
  }
});
