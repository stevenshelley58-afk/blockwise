import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Ad Radar results use a measured masonry grid", () => {
  const component = readFileSync("src/components/research/ad-radar-results-grid.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(component, /<MasonryItem key=\{card\.id\}>/);
  assert.match(component, /new ResizeObserver\(updateRowSpan\)/);
  assert.match(component, /gridRowEnd: `span \$\{rowSpan\}`/);
  assert.match(styles, /\.research-results-grid\s*\{[^}]*grid-auto-rows:\s*8px;/s);
  assert.match(styles, /\.research-results-item\s*\{[^}]*min-width:\s*0;/s);
});
