import test from "node:test";
import assert from "node:assert/strict";

import { mediaDownloadHeaders, sanitizeDownloadFilename } from "../src/lib/adstudio/media-download.ts";
import { savedAdDownloadPaths } from "../src/lib/adstudio/library-read-model.ts";

test("media download headers preserve a safe requested filename", () => {
  assert.deepEqual(mediaDownloadHeaders(true, "Spring listing/feed.png"), {
    "content-disposition": 'attachment; filename="Spring_listing_feed.png"',
  });
  assert.deepEqual(mediaDownloadHeaders(false, "ignored.png"), {});
  assert.equal(sanitizeDownloadFilename(""), "blockwise-ad.png");
});

test("media download filename cannot inject response headers", () => {
  assert.equal(sanitizeDownloadFilename('x"\r\nSet-Cookie: bad'), "x___Set-Cookie__bad");
});

test("library mapping preserves canonical Feed and Story render paths", () => {
  assert.deepEqual(
    savedAdDownloadPaths({
      feed_png_path: "workspace/feed.png",
      story_png_path: "workspace/story.png",
    }),
    { feed: "workspace/feed.png", story: "workspace/story.png" },
  );
  assert.deepEqual(savedAdDownloadPaths({ feed_png_path: null }), { feed: null, story: null });
});
