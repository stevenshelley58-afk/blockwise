import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Sparkline } from "../src/components/ui/sparkline.tsx";
import { smoothLinePath, type LineVertex } from "../src/lib/charts/smooth-line.ts";

/**
 * Every segment of a path built by `smoothLinePath`, as the six numbers of its
 * cubic: two control points and the point it lands on.
 */
function segments(path: string): number[][] {
  return path
    .split("C")
    .slice(1)
    .map((segment) => segment.trim().split(/[ ,]+/).map(Number));
}

test("a smooth line starts and ends on its own points", () => {
  const vertices: LineVertex[] = [
    [0, 40],
    [10, 20],
    [20, 22],
    [30, 5],
    [40, 30],
  ];
  const path = smoothLinePath(vertices);
  const drawn = segments(path);

  assert.equal(drawn.length, vertices.length - 1);
  assert.ok(path.startsWith("M0,40"), path);
  // The first handle sits a third of the way into its segment.
  assert.ok(Math.abs(drawn[0][0] - (vertices[0][0] + 10 / 3)) < 0.01, String(drawn[0][0]));
  for (const [index, segment] of drawn.entries()) {
    assert.equal(segment[4], vertices[index + 1][0]);
    assert.equal(segment[5], vertices[index + 1][1]);
  }
});

test("the curve never leaves the band its own two points set", () => {
  // This is the honesty half of smoothing: a curve that bulges past a day's
  // value would draw a peak or a dip the period never had. A cubic stays inside
  // the box its control points make, so holding every control point inside the
  // segment's own band is enough.
  const vertices: LineVertex[] = [
    [0, 40],
    [10, 20],
    [20, 22],
    [30, 5],
    [40, 30],
    [50, 30],
    [60, 12],
  ];

  for (const [index, segment] of segments(smoothLinePath(vertices)).entries()) {
    const [start, end] = [vertices[index][1], vertices[index + 1][1]];
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (const control of [segment[1], segment[3]]) {
      assert.ok(
        control >= low - 0.01 && control <= high + 0.01,
        `control point ${control} leaves the ${low}..${high} band of segment ${index}`,
      );
    }
  }
});

test("a flat series stays flat and a peak turns over without overshooting", () => {
  const flat = segments(smoothLinePath([[0, 8], [10, 8], [20, 8]]));
  for (const segment of flat) {
    assert.deepEqual([segment[1], segment[3], segment[5]], [8, 8, 8]);
  }

  const peak = segments(smoothLinePath([[0, 20], [10, 4], [20, 20]]));
  assert.ok(peak.every((segment) => segment[1] >= 4 && segment[3] >= 4));
});

test("two points are one smooth command, not a straight segment", () => {
  const path = smoothLinePath([[0, 10], [10, 20]]);

  assert.match(path, /^M0,10C/);
  assert.doesNotMatch(path, /L/);
  assert.equal(segments(path).length, 1);
});

test("one point is a move, and no points draw nothing", () => {
  assert.equal(smoothLinePath([[4, 9]]), "M4,9");
  assert.equal(smoothLinePath([]), "");
});

test("the figure card's sparkline draws the same curve", () => {
  const html = renderToStaticMarkup(createElement(Sparkline, { points: [3, 9, 4, 11, 7] }));
  const drawn = /d="([^"]+)"/.exec(html)?.[1];

  assert.ok(drawn, "the sparkline drew no path");
  assert.match(drawn, /^M/);
  assert.match(drawn, /C/);
  assert.doesNotMatch(drawn, /L/);
});

async function sourceFiles(directory: URL): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(new URL(`${entry.name}/`, directory));
      return /\.tsx?$/.test(entry.name) ? [join(directory.pathname, entry.name)] : [];
    }),
  );
  return found.flat();
}

test("every series states the one curve, and no chart draws a polyline", async () => {
  // The guard for the rule, not just the two charts that exist today: a new
  // recharts series without `type="monotone"`, or a hand-drawn `<polyline>`,
  // fails here rather than shipping a wire next to smoothed lines.
  const offenders: string[] = [];
  for (const file of await sourceFiles(new URL("../src/", import.meta.url))) {
    const source = await readFile(file, "utf8");
    if (/<polyline\b/.test(source)) offenders.push(`${file} draws a polyline`);
    for (const series of source.matchAll(/<(?:Line|Area)\b[^>]*>/g)) {
      if (!/type="monotone"/.test(series[0])) offenders.push(`${file} has a series with no monotone type`);
    }
  }

  assert.deepEqual(offenders, []);
});
