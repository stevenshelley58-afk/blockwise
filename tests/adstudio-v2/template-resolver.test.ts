import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  redactTemplateV2ForCustomer,
  resolveReadyTemplateV2,
} from "../../src/lib/adstudio/v2/template-resolver.ts";

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

    const source = {
      current(templateId: string) {
        const path = join(galleryDir, templateId, "template.json");
        return JSON.parse(readFileSync(path, "utf8"));
      },
      history() {
        return [];
      },
    };
    assert.equal(resolveReadyTemplateV2("meta-qa", source), null, "QA must map to the route's 404 branch");
    assert.equal(resolveReadyTemplateV2("meta-ready", source)?.id, "meta-ready");
  } finally {
    rmSync(galleryDir, { recursive: true, force: true });
  }
});

test("customer projection retains editing geometry but removes private render refs and review identity", () => {
  const source = JSON.parse(readFileSync(join(fixtureRoot, "meta-fixture-effects", "template.json"), "utf8"));
  source.provenance.sourceAd = {
    file: "/private/source.png",
    creativeId: "private-creative-id",
    contentHash: "1".repeat(64),
  };
  source.provenance.sample = {
    imageSrc: "/adstudio-templates/meta-fixture-effects/sample.png",
    contentHash: "2".repeat(64),
    generatedBy: "deterministic_render",
  };
  source.formats.feed.plate = {
    src: "/adstudio-templates/meta-fixture-effects/plate-feed.webp",
    sha256: "3".repeat(64),
  };
  source.exactness.reviewEvidence = {
    reviewerUserId: "00000000-0000-4000-8000-000000000000",
    reviewerEmail: "operator@example.test",
  };

  const customer = redactTemplateV2ForCustomer(source);
  assert.deepEqual(customer.provenance.sourceAd, { contentHash: "2".repeat(64) });
  assert.equal(customer.formats.feed.plate.src, source.provenance.sample.imageSrc);
  assert.equal(customer.formats.feed.plate.sha256, source.provenance.sample.contentHash);
  assert.equal(customer.formats.feed.layers.length, source.formats.feed.layers.length);
  assert.equal(customer.exactness.reviewEvidence, undefined);
  assert.match(source.formats.feed.plate.src, /plate-feed/);
});
