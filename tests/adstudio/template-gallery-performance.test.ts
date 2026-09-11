import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regression guard for the Ad Studio template gallery render storm.
 *
 * Before this, the gallery rendered every reviewed template as a live Konva
 * canvas through the authenticated sample route, with a plain <img> and no
 * lazy loading. One visit to /ad-studio/templates with 61 templates issued 61
 * full-resolution renders (40.8 MB, 19.1 s to the load event), and the route's
 * 30-per-5-minutes limit turned 31 of them into 429s that rendered as broken
 * cards. These tests fail if that shape returns.
 */

const root = join(fileURLToPath(new URL("../..", import.meta.url)));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("Ad Studio template gallery stays cheap to render", () => {
  it("keeps gallery samples lazy and bounded in size", () => {
    const gallery = read("src/components/adstudio/template-gallery.tsx");

    assert.match(
      gallery,
      /loading="lazy"/,
      "gallery samples must be lazy; eager rendering is what caused the storm",
    );
    assert.match(
      gallery,
      /&w=\d+/,
      "the gallery must request a downscaled sample, not the full Feed/Story render",
    );
    assert.match(gallery, /decoding="async"/, "decoding must not block the main thread");
    assert.doesNotMatch(
      gallery,
      /from "next\/image"/,
      "next/image cannot be used here: its optimiser does not forward cookies, so it cannot fetch the authenticated sample route and every card 400s",
    );
  });

  it("lets one gallery view render without tripping its own rate limit", () => {
    const route = read("src/app/api/adstudio/templates/[templateId]/sample/route.ts");
    const limit = route.match(/maxRequests:\s*(\d+)/u);

    assert.ok(limit, "the sample route must declare a render budget");
    assert.ok(
      Number(limit[1]) >= 120,
      `a single gallery view renders one sample per reviewed template, so the budget must exceed that; found ${limit?.[1]}`,
    );
  });

  it("downscales on the server and makes renders revalidatable", () => {
    const route = read("src/app/api/adstudio/templates/[templateId]/sample/route.ts");

    assert.match(route, /sharp/u, "the route must downscale rather than serving a full-size render");
    assert.match(route, /etag/iu, "samples must carry an ETag so a repeat view gets a 304");
    assert.match(
      route,
      /max-age=\d{3,}/u,
      "samples must carry a real freshness lifetime so repeat views stay free",
    );
    assert.doesNotMatch(
      route,
      /cache-control":\s*"private, max-age=300"/u,
      "the old 5-minute private cache is what forced repeated canvas renders",
    );
  });
});
