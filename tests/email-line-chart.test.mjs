import test from "node:test";
import assert from "node:assert/strict";
import { chartSignature, chartSvg } from "../src/lib/email-design/line-chart.ts";

test("renders a smooth monotone line with true zero axis", () => {
  const svg = chartSvg([{ label: "A", value: 1 }, { label: "B", value: 4 }, { label: "C", value: 2 }], { title: "Leads", unit: "New leads" });
  assert.match(svg, /width="1040" height="360"/);
  assert.match(svg, /<path d="M [^\"]+ C /);
  assert.match(svg, /stroke="#2a78d6"/);
  assert.match(svg, />0<\/text>/);
  assert.doesNotMatch(svg, /<rect|<bar/i);
});

test("supports one point and dark theme without invented points", () => {
  const svg = chartSvg([{ label: "Only", value: 0 }], { theme: "dark" });
  assert.match(svg, /background:#1b1e24/);
  assert.equal((svg.match(/<circle /g) ?? []).length, 1);
  assert.equal((svg.match(/<text /g) ?? []).length, 4);
});

test("signature is deterministic and changes with observed values", () => {
  const points = [{ label: "Mon", value: 2 }];
  assert.equal(chartSignature(points), chartSignature(points));
  assert.notEqual(chartSignature(points), chartSignature([{ label: "Mon", value: 3 }]));
});

