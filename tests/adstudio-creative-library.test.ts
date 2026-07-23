import assert from "node:assert/strict";
import test from "node:test";

import { buildAdStudioCreativeLibrary } from "../src/lib/adstudio/creative-library.ts";

test("creative library puts unpublished ads first and sorts each status newest first", () => {
  const library = buildAdStudioCreativeLibrary(
    [
      { id: "published-new", name: "Published new", status: "ready", updated_at: "2026-07-22T03:00:00Z" },
      { id: "draft-old", name: "Draft old", status: "ready", updated_at: "2026-07-20T03:00:00Z" },
      { id: "draft-new", name: "Draft new", status: "ready", updated_at: "2026-07-21T03:00:00Z" },
      { id: "published-old", name: "Published old", status: "ready", updated_at: "2026-07-19T03:00:00Z" },
      { id: "archived", name: "Archived", status: "archived", updated_at: "2026-07-23T03:00:00Z" },
    ],
    [],
    [
      { adstudio_campaign_id: "published-new", status: "paused_live" },
      { adstudio_campaign_id: "published-old", status: "paused_live" },
    ],
  );

  assert.deepEqual(
    library.map((item) => [item.campaignId, item.status]),
    [
      ["draft-new", "unpublished"],
      ["draft-old", "unpublished"],
      ["published-new", "published"],
      ["published-old", "published"],
    ],
  );
});

test("creative library prefers a Feed artwork preview and falls back safely", () => {
  const library = buildAdStudioCreativeLibrary(
    [{ id: "campaign", name: "Scarborough listing", status: "ready", created_at: "2026-07-20T03:00:00Z" }],
    [
      {
        campaign_id: "campaign",
        format: "9:16",
        canvas_json: { objects: [{ role: "primary_image", content: "/story.jpg" }] },
        updated_at: "2026-07-22T03:00:00Z",
      },
      {
        campaign_id: "campaign",
        format: "4:5",
        canvas_json: { objects: [{ role: "primary_image", content: "/feed.jpg" }] },
        updated_at: "2026-07-22T02:00:00Z",
      },
    ],
    [],
  );

  assert.equal(library[0]?.previewSrc, "/feed.jpg");
  assert.equal(library[0]?.format, "4:5");
  assert.equal(library[0]?.updatedAt, "2026-07-20T03:00:00Z");
});
