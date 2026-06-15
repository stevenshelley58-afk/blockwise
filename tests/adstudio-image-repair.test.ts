import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTruthPreservingRepairPrompt,
  repairAssetMetadata,
  repairStoragePath,
  validateImageRepairRequest,
} from "../src/lib/adstudio/image-repair.ts";

test("validateImageRepairRequest requires source image and valid target formats", () => {
  assert.throws(
    () => validateImageRepairRequest({ sourceImage: "", targetFormats: ["1:1"] }),
    /sourceImage is required/,
  );
  assert.throws(
    () => validateImageRepairRequest({ sourceImage: "/api/adstudio/media?path=workspace%2Fimage.jpg", targetFormats: ["16:9"] }),
    /targetFormats must include valid Ad Studio formats/,
  );

  const parsed = validateImageRepairRequest({
    brandKitId: "kit_1",
    sourceImage: "/api/adstudio/media?path=workspace%2Fimage.jpg",
    targetFormats: ["9:16", "4:5", "4:5"],
    campaignContext: { market: "Scarborough, WA" },
    layoutBriefs: { "9:16": "leave top third clear" },
  });

  assert.deepEqual(parsed.targetFormats, ["9:16", "4:5"]);
  assert.equal(parsed.brandKitId, "kit_1");
  assert.equal(parsed.layoutBriefs["9:16"], "leave top third clear");
});

test("repair prompt encodes truth-preserving real estate constraints", () => {
  const prompt = buildTruthPreservingRepairPrompt({
    format: "4:5",
    campaignContext: {
      market: "Subiaco, WA",
      propertyType: "Townhouses",
      headline: "Subiaco townhouse",
    },
    layoutBrief: "copy safe area on left",
  });

  assert.match(prompt, /Use the supplied reference photo as the real property/);
  assert.match(prompt, /Preserve the actual architecture/);
  assert.match(prompt, /Do not invent pools, views, rooms/);
  assert.match(prompt, /Target format: 4:5/);
});

test("repair metadata and storage path preserve provenance without a migration", () => {
  const metadata = repairAssetMetadata({
    sourceImage: "/api/adstudio/media?path=workspace%2Foriginal.jpg",
    targetFormat: "1:1",
    model: "reference-model",
    provider: "openrouter",
    contentType: "image/png",
  });

  assert.deepEqual(metadata, {
    generated: true,
    aiRepair: true,
    repairMode: "truth_preserving_fit",
    sourceImage: "/api/adstudio/media?path=workspace%2Foriginal.jpg",
    targetFormat: "1:1",
    model: "reference-model",
    provider: "openrouter",
    contentType: "image/png",
  });
  assert.equal(
    repairStoragePath({ workspaceId: "workspace_1", seed: "repair_1", format: "1:1", extension: "png" }),
    "workspace_1/adstudio/repaired/repair_1-1x1.png",
  );
});
