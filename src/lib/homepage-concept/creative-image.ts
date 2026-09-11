import { withBasePath } from "./content.ts";

/**
 * Widths the homepage creative variants are generated at, smallest first.
 *
 * Every image these feed renders in a card between 150px and 326px wide. Sized
 * for the real slots rather than round numbers: 192 covers the 150px library
 * strip at 1x and 1.25x, 384 covers the 326px Feed card at 1x and the story and
 * strip cards at 2x, 576 covers the 276px story card at 2x, and 750 covers the
 * 326px Feed card at 2x. The full-size source stays as the last candidate for 3x
 * and for the sources that are narrower than a step.
 */
export const CREATIVE_WIDTH_STEPS = [192, 384, 576, 750] as const;

/**
 * True pixel width of each homepage creative source.
 *
 * This is what makes the `w` descriptors honest. A srcset may only advertise a
 * candidate that exists and is the width it claims, so the ladder is derived
 * from these numbers instead of guessed: a 585px source must not offer a "750w"
 * file, because the browser that picks it downloads a 404 and renders nothing
 * (that regression shipped once, from a srcset built without this map).
 *
 * `tests/homepage-creative-variants.test.ts` measures every file with sharp and
 * fails if a number here drifts from the file, if an image used by the homepage
 * is missing from the map, or if a generated variant is absent or mis-sized.
 * Regenerate the variants with `npm run build:creative-variants`.
 */
export const CREATIVE_SOURCE_WIDTHS: Readonly<Record<string, number>> = {
  "/home/home-dusk.webp": 1000,
  "/home/home-pool.webp": 1000,
  "/home/mt-lawley-federation.webp": 1000,
  "/home/open-home-living.webp": 1000,
  "/home/workspace-hero/agent-ad.webp": 683,
  "/hero/hero-tall.webp": 585,
  "/ads/ad-coastline.webp": 682,
  "/ads/ad-hillview.webp": 682,
  "/adstudio-fixtures/meta-agent-intro-feed-037/property-photo.webp": 1672,
  "/adstudio-thumbnails/meta/0899efc11fc68e177c731321421454f0001a393bbc8b0211dafad4a7f3b89347-preview.webp": 1024,
  "/adstudio-thumbnails/meta/127c60b3d1e238b9289dbe501dba65f249fa99e96fd5be4bd8848733e089fd35-preview.webp": 1024,
  "/adstudio-thumbnails/meta/1c119a3dae9089ca621e947afe16c7f5307748d3ea956a826750e61d078fe94c-preview.webp": 1080,
  "/adstudio-thumbnails/meta/6b49016814ffdb9e64eb33943667efda84f3f55e0020d0fc00cbab4f121754d3-preview.webp": 1080,
  "/adstudio-thumbnails/meta/8f909f4b8f396a6d3fa1a3940fccb64292ac3df511761d2d8b72b6b39f0ca8de-preview.webp": 1080,
  "/adstudio-thumbnails/meta/eb4bce514070f6ce1566fc8fd2570755157d99eb50518e210739b276a6a1f370-preview.webp": 1080,
  "/adstudio-thumbnails/meta/fdc9222b4d16c2666d7767372301545b54679819d1beb3359aef4c05170e59b0-preview.webp": 1080,
};

/**
 * `srcSet` for a homepage creative image, or `""` when the source has no
 * measured width.
 *
 * Variants are written beside their source with the same stem, so
 * `/x/y.webp` yields `/x/y-192.webp`, `/x/y-384.webp` and `/x/y-750.webp`. The
 * source itself is always the last, widest candidate. An unmapped image returns
 * an empty string so the element keeps its plain `src` rather than advertising a
 * file that may not exist.
 */
export function creativeImageSrcSet(image: string): string {
  const sourceWidth = CREATIVE_SOURCE_WIDTHS[image];
  if (!sourceWidth) return "";

  const stem = image.replace(/\.webp$/, "");
  const candidates = CREATIVE_WIDTH_STEPS.filter((width) => width < sourceWidth).map(
    (width) => `${withBasePath(`${stem}-${width}.webp`)} ${width}w`,
  );
  candidates.push(`${withBasePath(image)} ${sourceWidth}w`);

  return candidates.join(", ");
}
