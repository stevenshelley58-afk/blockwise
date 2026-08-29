import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { loadSafeReplacementAssets } from "../../src/lib/adstudio/v2/restyle-assets.ts";
import { hasNonTrivialRestyle } from "../../src/lib/adstudio/v2/template-doc.ts";

const bytes = Buffer.from("safe-property-fixture");
const hash = createHash("sha256").update(bytes).digest("hex");

function doc(assets = [{ inputKey: "property", src: "/slots/property.png", sha256: hash }]) {
  return {
    id: "meta-feed-test",
    inputs: { images: [
      { key: "property", label: "Property", required: true },
      { key: "logo_slot", label: "Logo", required: false },
    ] },
    restyle: { safeReplacementAssets: assets },
  };
}

describe("safe replacement assets", () => {
  it("allows optional logo slots to remain empty while loading required fixtures", () => {
    const root = mkdtempSync(join(os.tmpdir(), "adstudio-restyle-assets-"));
    try {
      mkdirSync(join(root, "public", "slots"), { recursive: true });
      writeFileSync(join(root, "public", "slots", "property.png"), bytes);
      const loaded = loadSafeReplacementAssets(doc(), root);
      assert.deepEqual([...loaded.slotBytes.keys()], ["property"]);
      assert.deepEqual(Object.keys(loaded.imageRefs), ["property"]);
      assert.equal(hasNonTrivialRestyle(doc()), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still fails closed when a required image fixture is missing", () => {
    const root = mkdtempSync(join(os.tmpdir(), "adstudio-restyle-assets-missing-"));
    try {
      assert.throws(() => loadSafeReplacementAssets(doc([]), root), /safe replacement asset for \"property\"/);
      assert.equal(hasNonTrivialRestyle(doc([])), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
