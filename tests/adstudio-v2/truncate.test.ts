// Truncation behaviour (Track B, §8): Meta's best-known 2026 values, kept in
// one re-checkable file. These are approximate by nature — the
// generatepreviews side-by-side is what keeps them honest.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DESC_FB_ONLY,
  FB_FEED_HEADLINE_VISIBLE_CHARS,
  FB_FEED_PRIMARY_SEE_MORE_CHARS,
  FB_FEED_PRIMARY_SEE_MORE_LINES,
  formatMetaPrimaryText,
  IG_CAPTION_MORE_CHARS,
  STORY_PRIMARY_OVERLAY_CHARS,
  truncateHeadline,
  truncateIgCaption,
  truncateStoryPrimary,
} from "../../src/lib/adstudio/v2/render/truncate.ts";

test("primary text under the limits renders untouched, no See more", () => {
  const result = formatMetaPrimaryText("Fresh homes in Scarborough this week.");
  assert.equal(result.visible, "Fresh homes in Scarborough this week.");
  assert.equal(result.truncated, false);
  assert.equal(result.suffix, "");
});

test("primary text over 125 chars truncates with an interactive See more", () => {
  const long = "x".repeat(FB_FEED_PRIMARY_SEE_MORE_CHARS + 40);
  const result = formatMetaPrimaryText(long);
  assert.equal(result.truncated, true);
  assert.ok(result.visible.length <= FB_FEED_PRIMARY_SEE_MORE_CHARS);
  assert.equal(result.suffix, "See more");
});

test("primary text keeps at most 3 visible lines", () => {
  const fourLines = ["one", "two", "three", "four"].join("\n");
  const result = formatMetaPrimaryText(fourLines);
  assert.equal(result.truncated, true);
  assert.equal(result.visible.split("\n").length, FB_FEED_PRIMARY_SEE_MORE_LINES);
});

test("headline ellipsizes at ~27 chars", () => {
  assert.equal(truncateHeadline("Short headline"), "Short headline");
  const long = "A very long Scarborough appraisal headline";
  const cut = truncateHeadline(long);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut.length, FB_FEED_HEADLINE_VISIBLE_CHARS + 1);
});

test("IG caption folds at ~125 chars, story overlay at ~40", () => {
  const caption = truncateIgCaption("y".repeat(IG_CAPTION_MORE_CHARS + 10));
  assert.equal(caption.truncated, true);
  assert.ok(caption.visible.endsWith("…"));
  assert.equal(truncateIgCaption("short caption").truncated, false);

  const story = truncateStoryPrimary("z".repeat(STORY_PRIMARY_OVERLAY_CHARS + 10));
  assert.equal(story.truncated, true);
  assert.equal(truncateStoryPrimary("under forty characters of story copy").truncated, false);
});

test("description renders on Facebook placements only", () => {
  assert.equal(DESC_FB_ONLY, true);
});
