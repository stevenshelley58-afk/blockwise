import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  CREATIVE_SOURCE_WIDTHS,
  CREATIVE_WIDTH_STEPS,
  creativeImageSrcSet,
} from "../src/lib/homepage-concept/creative-image.ts";
import { AD_EXAMPLES, AD_LIBRARY, SHOWCASE_ADS } from "../src/lib/homepage-concept/content.ts";

/** Measured width of a local image, 0 when it cannot be read. */
async function measureImageWidth(filePath: string): Promise<number> {
  try {
    return (await sharp(filePath).metadata()).width ?? 0;
  } catch {
    return 0;
  }
}

const HOMEPAGE_IMAGES = [
  ...new Set([
    ...SHOWCASE_ADS.map((ad) => ad.image),
    ...AD_EXAMPLES.map((example) => example.image),
    ...AD_LIBRARY.map((entry) => entry.image),
  ]),
].sort();

const publicPath = (url: string) => path.join("public", url.replace(/^\//, ""));

function parseCandidates(srcSet: string): { url: string; width: number }[] {
  return srcSet.split(",").map((candidate) => {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    assert.match(descriptor, /^\d+w$/, `${candidate} needs a width descriptor`);
    return { url, width: Number(descriptor.slice(0, -1)) };
  });
}

test("every homepage creative is measured and every advertises a real srcset", async () => {
  for (const image of HOMEPAGE_IMAGES) {
    assert.ok(CREATIVE_SOURCE_WIDTHS[image], `${image} is missing from CREATIVE_SOURCE_WIDTHS`);

    const srcSet = creativeImageSrcSet(image);
    assert.notEqual(srcSet, "", `${image} produced no srcset`);

    const candidates = parseCandidates(srcSet);
    assert.equal(candidates.at(-1)?.url, image, `${image} must keep its full-size source as the widest candidate`);
    assert.deepEqual(
      candidates.slice(0, -1).map((candidate) => candidate.width),
      CREATIVE_WIDTH_STEPS.filter((step) => step < CREATIVE_SOURCE_WIDTHS[image]),
      `${image} should offer exactly the ladder steps narrower than the source`,
    );
  }
});

test("every advertised candidate exists at exactly the width it claims", async () => {
  // The regression this guards: a srcset that advertised /hero/hero-tall-640.webp
  // for a 585px source. The file did not exist, the browser picked it on a 2x
  // display, and the hero deck rendered an empty card.
  for (const image of HOMEPAGE_IMAGES) {
    for (const candidate of parseCandidates(creativeImageSrcSet(image))) {
      const filePath = publicPath(candidate.url);
      assert.equal(
        await measureImageWidth(filePath),
        candidate.width,
        `${candidate.url} is advertised at ${candidate.width}w`,
      );
    }
  }
});

test("declared source widths match the files on disk", async () => {
  for (const [image, width] of Object.entries(CREATIVE_SOURCE_WIDTHS)) {
    assert.equal(await measureImageWidth(publicPath(image)), width, `${image} width drifted`);
  }
});

test("the homepage carries no stale width variants", () => {
  // A variant left behind by an older ladder is dead weight on every deploy and
  // hides the fact that the markup moved on. Only the current steps may exist.
  for (const image of HOMEPAGE_IMAGES) {
    const directory = path.dirname(publicPath(image));
    const stem = path.basename(image).replace(/\.webp$/, "");
    const siblings = readdirSync(directory).filter((name) =>
      new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.webp$`).test(name),
    );

    for (const sibling of siblings) {
      const width = Number(sibling.replace(/\.webp$/, "").split("-").at(-1));
      assert.ok(
        CREATIVE_WIDTH_STEPS.includes(width as (typeof CREATIVE_WIDTH_STEPS)[number]) && width < CREATIVE_SOURCE_WIDTHS[image],
        `${directory}/${sibling} is not part of the current ladder`,
      );
    }
  }
});

test("both homepage surfaces wire the shared srcset helper", () => {
  const hero = readFileSync("src/components/homepage-concept/hero-ad-showcase.tsx", "utf8");
  const workflow = readFileSync("src/components/homepage-concept/workflow-showcase.tsx", "utf8");

  assert.match(hero, /srcSet=\{creativeImageSrcSet\(ad\.image\)\}/);
  assert.match(workflow, /srcSet=\{creativeImageSrcSet\(STORY_AD\.image\)\}/);
  assert.match(workflow, /srcSet=\{creativeImageSrcSet\(ad\.image\)\}/);
  // One helper, so a fix cannot land on one surface and miss the other.
  assert.doesNotMatch(hero, /function deckImageSrcSet/);
  assert.doesNotMatch(workflow, /function \w*ImageSrcSet/);
});
