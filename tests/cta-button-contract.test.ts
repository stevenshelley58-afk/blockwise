import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/*
 * The Blockwise CTA contract (DESIGN.md §Components). These are static guards on
 * the one button: they catch a silent return to hand-rolled pills and a silent
 * loss of the disc or its reduced-motion gate.
 */

test("the button renders the CTA disc itself rather than leaving it to call sites", () => {
  const button = read("src/components/ui/button.tsx");

  // The disc is part of the button, added when the control has visible text.
  assert.match(button, /data-slot="button-disc"/);
  assert.match(button, /hasTextContent/);
  assert.match(button, /showDisc/);
  // The disc reserves its lane through a variant, not through per-call-site padding.
  assert.match(button, /has-data-\[slot=button-disc\]:pr-/);
  // The inverse disc: a cta-foreground circle with an ink arrow, and a soft ink
  // wash on the quiet variants, whose surface is too light for a white circle.
  assert.match(button, /--cta-disc:var\(--ui-cta-foreground\)/);
  assert.match(button, /--cta-disc-foreground:var\(--ui-cta\)/);
  assert.match(button, /\[--cta-disc:var\(--ui-cta-soft\)\]/);
  // Call sites can opt out, and an icon-only control never gets one.
  assert.match(button, /arrow\?: React\.ReactNode/);
  assert.match(button, /disc: \{\s*default: "",\s*none: "",\s*\}/);
});

test("the CTA hover is transform-only and gated on reduced motion", () => {
  const button = read("src/components/ui/button.tsx");

  assert.match(button, /group-hover\/button:group-hover\/button:rotate-45/);
  assert.match(button, /motion-reduce:group-hover\/button:rotate-0/);
  assert.match(button, /motion-reduce:transition-none/);
  // Hover must not change the pill's own box: no padding swap, and the disc
  // travels by transform only, never by an animated offset.
  assert.doesNotMatch(button, /hover:pl-/);
  assert.doesNotMatch(button, /hover:pr-/);
  assert.doesNotMatch(button, /group-hover\/button:right-\[calc/);
});

test("the CTA tokens have one source and follow the accent", () => {
  const bridge = read("src/app/tailwind.css");
  const theme = read("src/app/theme-monochrome.css");

  assert.match(bridge, /--ui-cta: var\(--accent\)/);
  assert.match(bridge, /--ui-cta-foreground: #ffffff/);
  assert.match(bridge, /--ui-cta-soft: #f1f2f4/);
  assert.match(bridge, /--color-cta: var\(--ui-cta\)/);
  // The monochrome override states the CTA colour beside the accent it follows.
  assert.match(theme, /--accent: #16181d/);
  assert.match(theme, /--ui-cta: #16181d/);
  assert.match(theme, /--ui-cta-soft: #f1f2f4/);
});

test("the legacy marketing sheets exempt the CTA from their element resets", () => {
  // audit.css and suburb-report.css are unlayered, so their `.page a` and
  // `.page button` rules outrank every Tailwind utility. They must exclude the
  // CTA, and the marker has to travel in className because that is the one prop
  // every wrapper component forwards.
  const button = read("src/components/ui/button.tsx");
  assert.match(button, /const CTA_MARKER = "bw-cta"/);
  assert.match(button, /buttonVariants\(\{ variant, size, disc, className \}\), CTA_MARKER/);

  const audit = read("src/app/audit.css");
  assert.match(audit, /\.audit-page :where\(a, button\):not\(\.bw-cta\)/);
  const suburb = read("src/app/suburb/[postcode]/suburb-report.css");
  assert.match(suburb, /\.sr-page :where\(a\):not\(\.bw-cta\)/);
  assert.match(suburb, /\.sr-page :where\(button, input\):not\(\.bw-cta\)/);
  assert.match(suburb, /\.sr-cta-actions > button:not\(\.bw-cta\)/);
});

test("every asChild link CTA keeps the disc and the merged props", () => {
  const button = read("src/components/ui/button.tsx");

  // Slot merges the button's props onto its single child; ButtonChild has to
  // hand those props on to the real element or the link renders unstyled, and
  // the child's own props must come first so it cannot drop the button's.
  assert.match(button, /\.\.\.child\.props,\s*\n\s*\.\.\.props,/);
  assert.match(button, /className: cn\(className, child\.props\.className\)/);
  assert.match(button, /"data-cta": "pill"/);
  assert.match(button, /<ButtonContents showDisc=\{showDisc\} arrow=\{arrow\}>/);
});

test("quiet actions remain visible when their disc is omitted", () => {
  const button = read("src/components/ui/button.tsx");
  assert.doesNotMatch(button, /none: "hidden"/);
  assert.doesNotMatch(button, /variant: "link", disc: "default", class: "hidden"/);
  assert.match(button, /disc !== "none" && arrow !== null && variant !== "link"/);
});
