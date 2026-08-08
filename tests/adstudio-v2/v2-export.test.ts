import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { renderStoredFlatCloneExports } from "../../src/lib/adstudio/export-render-storage.ts";
import type { AdDocInstance } from "../../src/lib/adstudio/v2/template-doc.ts";
import { buildCloneTestPack } from "../adstudio-clone-fixture.ts";

test("v2 export packages use the canonical workspace render", async () => {
  const workspaceId = "workspace_v2_export";
  const pack = buildCloneTestPack(workspaceId);
  const feed = pack.creatives.find((creative) => creative.format === "4:5")!;
  const canvas: AdDocInstance = {
    schema: "adstudio.instance.v2",
    templateId: "meta-export-v2",
    templateHash: "a".repeat(64),
    format: "4:5",
    values: { images: {}, text: {} },
    overrides: [],
    renders: { feed: `${workspaceId}/adstudio/renders/feed-${"b".repeat(64)}.png` },
  };
  pack.creatives = [{ ...feed, canvas }];

  const downloaded: string[] = [];
  const bytes = readFileSync("tests/fixtures/adstudio-v2/public/slots/photo-square.png");
  const supabase = {
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloaded.push(path);
          return { data: new Blob([bytes], { type: "image/png" }), error: null };
        },
      }),
    },
  };

  const renders = await renderStoredFlatCloneExports(supabase, workspaceId, pack);
  assert.deepEqual(downloaded, [canvas.renders!.feed]);
  assert.deepEqual(renders.map((render) => render.mimeType), ["image/png", "image/jpeg"]);
  assert.ok(renders.every((render) => render.width === 1080 && render.height === 1350));
});
