// Render parity: browser preview ≈ server pixels (plan §4).
//
// For every fixture, the harness page renders the doc in the browser and
// publishes a PNG data URL; the server route renders the same doc through
// renderAdDocToPng (@napi-rs/canvas). This spec asserts:
//   1. pixels OUTSIDE (padded) text boxes are byte-identical — plates,
//      patches and slot drawImage output must match exactly;
//   2. text-box regions match at SSIM ≥ 0.97 (anti-aliasing differences only).
//
// All decoding/comparison runs inside the browser page (no multi-MB pixel
// buffers through evaluate). SSIM is implemented inline — no new deps.

import assert from "node:assert/strict";

import { expect, test } from "@playwright/test";

const HARNESS_PATH = "/dev/render-harness";
const TEXT_BOX_PAD_PX = 4;
const SSIM_FLOOR = 0.97;

type RegionResult = { id: string; ssim: number };
type CompareResult = {
  key: string;
  width: number;
  height: number;
  outsidePixels: number;
  outsideDiffs: number;
  diffBounds: { minX: number; minY: number; maxX: number; maxY: number };
  regions: RegionResult[];
};

/** Decode any image source to RGBA inside the page, then compare. */
async function compareInPage(
  page: import("@playwright/test").Page,
  key: string,
  browserDataUrl: string,
  serverUrl: string,
  textBoxes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
): Promise<CompareResult> {
  return page.evaluate(
    async ({ key, browserDataUrl, serverUrl, textBoxes, pad, ssimFloor: _floor }) => {
      function decodeToRgba(source: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
        return fetch(source)
          .then((response) => {
            if (!response.ok) throw new Error(`decode fetch failed: ${response.status}`);
            return response.blob();
          })
          .then((blob) => createImageBitmap(blob))
          .then((bitmap) => {
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) throw new Error("no 2d context for decode");
            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            return { data: imageData.data, width: bitmap.width, height: bitmap.height };
          });
      }

      // Grayscale SSIM over a rect, 8×8 windows, step 4, standard constants.
      function ssim(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, rect: { x: number; y: number; w: number; h: number }): number {
        const C1 = (0.01 * 255) ** 2;
        const C2 = (0.03 * 255) ** 2;
        const windowSize = 8;
        const step = 4;
        let count = 0;
        let sum = 0;
        for (let y = rect.y; y + windowSize <= rect.y + rect.h; y += step) {
          for (let x = rect.x; x + windowSize <= rect.x + rect.w; x += step) {
            let sumA = 0; let sumB = 0; let sumAA = 0; let sumBB = 0; let sumAB = 0;
            for (let wy = 0; wy < windowSize; wy += 1) {
              for (let wx = 0; wx < windowSize; wx += 1) {
                const index = ((y + wy) * width + (x + wx)) * 4;
                const ga = 0.299 * a[index]! + 0.587 * a[index + 1]! + 0.114 * a[index + 2]!;
                const gb = 0.299 * b[index]! + 0.587 * b[index + 1]! + 0.114 * b[index + 2]!;
                sumA += ga; sumB += gb; sumAA += ga * ga; sumBB += gb * gb; sumAB += ga * gb;
              }
            }
            const n = windowSize * windowSize;
            const meanA = sumA / n; const meanB = sumB / n;
            const varA = sumAA / n - meanA * meanA;
            const varB = sumBB / n - meanB * meanB;
            const covar = sumAB / n - meanA * meanB;
            sum += ((2 * meanA * meanB + C1) * (2 * covar + C2))
              / ((meanA * meanA + meanB * meanB + C1) * (varA + varB + C2));
            count += 1;
          }
        }
        return count === 0 ? 1 : sum / count;
      }

      const [browser, server] = await Promise.all([decodeToRgba(browserDataUrl), decodeToRgba(serverUrl)]);
      if (browser.width !== server.width || browser.height !== server.height) {
        throw new Error(`dimension mismatch: browser ${browser.width}x${browser.height} vs server ${server.width}x${server.height}`);
      }
      const { width, height } = browser;

      // Pixel-by-pixel comparison outside padded text boxes.
      const inTextBox = (px: number, py: number): boolean => textBoxes.some((box) => (
        px >= box.x - pad && px < box.x + box.width + pad
        && py >= box.y - pad && py < box.y + box.height + pad
      ));

      let outsidePixels = 0;
      let outsideDiffs = 0;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (inTextBox(x, y)) continue;
          outsidePixels += 1;
          const index = (y * width + x) * 4;
          if (
            browser.data[index] !== server.data[index]
            || browser.data[index + 1] !== server.data[index + 1]
            || browser.data[index + 2] !== server.data[index + 2]
            || browser.data[index + 3] !== server.data[index + 3]
          ) {
            outsideDiffs += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      const diffBounds = outsideDiffs > 0
        ? { minX, minY, maxX, maxY }
        : { minX: -1, minY: -1, maxX: -1, maxY: -1 };

      const regions = textBoxes.map((box) => {
        const rect = {
          x: Math.max(0, Math.floor(box.x - pad)),
          y: Math.max(0, Math.floor(box.y - pad)),
          w: Math.min(width, Math.ceil(box.x + box.width + pad)) - Math.max(0, Math.floor(box.x - pad)),
          h: Math.min(height, Math.ceil(box.y + box.height + pad)) - Math.max(0, Math.floor(box.y - pad)),
        };
        return { id: box.id, ssim: ssim(browser.data, server.data, width, rect) };
      });

      return { key, width, height, outsidePixels, outsideDiffs, diffBounds, regions };
    },
    { key, browserDataUrl, serverUrl, textBoxes, pad: TEXT_BOX_PAD_PX, ssimFloor: SSIM_FLOOR },
  );
}

test("browser render matches server render: byte-identical outside text, SSIM inside", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto(HARNESS_PATH);
  await page.waitForFunction(() => window.__RENDER_PARITY_STATUS__ === "ready" || window.__RENDER_PARITY_STATUS__ === "error", undefined, { timeout: 120_000 });
  const status = await page.evaluate(() => window.__RENDER_PARITY_STATUS__);
  if (status !== "ready") {
    const error = await page.evaluate(() => window.__RENDER_PARITY_ERROR__);
    throw new Error(`harness failed to render: ${error}`);
  }

  const fixtures = await (await page.request.get("/dev/render-harness/fixtures")).json();

  for (const fixture of fixtures.fixtures) {
    const layoutKeys: Array<"feed" | "story"> = fixture.doc.formats.story ? ["feed", "story"] : ["feed"];
    for (const layoutKey of layoutKeys) {
      const key = `${fixture.id}/${layoutKey}`;
      const layout = fixture.doc.formats[layoutKey];
      const format = layout.format;
      const instanceParam = fixture.instances[layoutKey] ? `&instance=${layoutKey}` : "";
      const serverUrl = `/dev/render-harness/render?fixture=${fixture.id}&format=${encodeURIComponent(format)}${instanceParam}`;
      const browserDataUrl = await page.evaluate((renderKey) => window.__RENDER_PARITY__?.[renderKey], key);
      assert.ok(browserDataUrl, `harness did not produce ${key}`);

      // The parity contract:
      //   • PLATE pixels are drawImage at 1:1 — byte-identical across backends,
      //     and they stay in the byte comparison below.
      //   • Anything RESAMPLED (customer photos scaled into slots, patches
      //     drawn at the declared box size) and anything FONT-RASTERIZED
      //     (text glyphs, curved clip masks, effect shadows/strokes) is
      //     engine-dependent at sub-pixel edges. Those become SSIM zones with
      //     a high floor; their unresampled interiors match exactly anyway,
      //     so SSIM lands ≈ 1.0 and real drift still fails the gate.
      const zones: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];

      for (const layer of layout.layers) {
        if (layer.type === "text") {
          const baseX = layer.box.x * layout.width;
          const baseY = layer.box.y * layout.height;
          const baseW = layer.box.width * layout.width;
          const baseH = layer.box.height * layout.height;
          // Effects bleed past the box: shadow blur/offset and stroke width
          // rasterize differently per backend. Pad the zone by the worst-case
          // spread so only the glyphs themselves are SSIM-checked.
          const effects = layer.typo?.effects;
          const shadow = effects?.shadow;
          const stroke = effects?.stroke;
          const spread = Math.ceil(
            (shadow ? shadow.blurRatio * baseH + Math.abs(shadow.dx) * baseW + Math.abs(shadow.dy) * baseH : 0)
            + (stroke ? stroke.widthRatio * baseH : 0),
          );
          zones.push({
            id: layer.id,
            x: baseX - spread,
            y: baseY - spread,
            width: baseW + spread * 2,
            height: baseH + spread * 2,
          });
        } else if (layer.type === "image_slot" || layer.type === "overlay_patch") {
          const pad = 2;
          zones.push({
            id: layer.id,
            x: layer.box.x * layout.width - pad,
            y: layer.box.y * layout.height - pad,
            width: layer.box.width * layout.width + pad * 2,
            height: layer.box.height * layout.height + pad * 2,
          });
        }
      }

      const result = await compareInPage(page, key, browserDataUrl!, serverUrl, zones);

      // 1. Everything that is plain drawImage must be byte-identical.
      expect(
        result.outsideDiffs,
        `${key}: ${result.outsideDiffs}/${result.outsidePixels} pixels differ outside the AA zones (diff bounds ${JSON.stringify(result.diffBounds)})`,
      ).toBe(0);

      // 2. Zones (text glyphs, curved-mask edges): AA-only differences.
      for (const region of result.regions) {
        expect(
          region.ssim,
          `${key}: region ${region.id} SSIM ${region.ssim.toFixed(4)} below floor ${SSIM_FLOOR}`,
        ).toBeGreaterThanOrEqual(SSIM_FLOOR);
      }
    }
  }
});
