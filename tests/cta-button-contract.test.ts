import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/*
 * The Blockwise control contract (DESIGN.md §Components). These are static
 * guards on the one button: they catch a silent return of the hand-rolled
 * decorative arrow disc and a silent loss of the marker the legacy marketing
 * sheets key their element resets on.
 *
 * The disc is gone by decision: plain text is the default. An icon goes inside
 * the button only when it carries a function the label does not already state,
 * and it is written into `children` like any other content.
 */

test("the button no longer injects a decorative arrow disc", () => {
  const button = read("src/components/ui/button.tsx");

  // The disc component, its slot, its custom properties and its reserved lane
  // are all gone. Every token is named so a partial revert fails loudly.
  assert.doesNotMatch(button, /ButtonDisc/);
  assert.doesNotMatch(button, /data-slot="button-disc"/);
  assert.doesNotMatch(button, /--cta-disc/);
  assert.doesNotMatch(button, /hasTextContent/);
  assert.doesNotMatch(button, /DISC_LANE/);
  assert.doesNotMatch(button, /ButtonContents/);
  assert.doesNotMatch(button, /ButtonChild/);
  assert.doesNotMatch(button, /ButtonLabel/);
  assert.doesNotMatch(button, /ArrowUpRight/);
  // The `disc` variant and the `disc`/`arrow` props are gone too. Match the
  // declaration shapes, not the bare words: the file's prose still explains the
  // arrow disc it no longer renders.
  assert.doesNotMatch(button, /disc: \{/);
  assert.doesNotMatch(button, /disc\?=/);
  assert.doesNotMatch(button, /disc !== /);
  assert.doesNotMatch(button, /arrow\?: React\.ReactNode/);
});

test("the button keeps its marker class and its data contract", () => {
  const button = read("src/components/ui/button.tsx");

  // The marker travels in `className`, the one prop every wrapper component
  // forwards, and the legacy sheets exclude the CTA by that class.
  assert.match(button, /const CTA_MARKER = "bw-cta"/);
  assert.match(
    button,
    /className=\{cn\(buttonVariants\(\{ variant, size, className \}\), CTA_MARKER\)\}/,
  );
  // The data contract survives: consumers key on the slot, the pill marker and
  // the variant/size pair.
  assert.match(button, /data-slot="button"/);
  assert.match(button, /data-cta="pill"/);
  assert.match(button, /data-variant=\{variant\}/);
  assert.match(button, /data-size=\{size\}/);
  // The public surface stays stable.
  assert.match(button, /export \{ Button, buttonVariants \}/);
  assert.match(button, /export type \{ ButtonProps \}/);
});

test("the asChild path merges onto the child and keeps the marker", () => {
  const button = read("src/components/ui/button.tsx");

  // Radix Slot merges the button's props — including `data-slot`, `data-cta`
  // and the marker class — onto its single child, so a link CTA is a real <a>
  // carrying the button's contract. The old ButtonChild clone step is gone.
  assert.match(button, /const Comp = asChild \? Slot\.Root : "button"/);
  assert.match(
    button,
    /className=\{cn\(buttonVariants\(\{ variant, size, className \}\), CTA_MARKER\)\}/,
  );
  assert.match(button, /data-cta="pill"/);
  assert.doesNotMatch(button, /cloneElement/);
});

test("the link variant stays an inline text action, not a pill", () => {
  const button = read("src/components/ui/button.tsx");

  // `link` is text only: no pill surface and no interactive boundary. The old
  // `variant !== "link"` disc gate is gone with the disc itself.
  assert.match(button, /link: "text-primary underline-offset-4 hover:underline"/);
  const linkVariant = button.match(/link: "([^"]*)"/)?.[1] ?? "";
  assert.notEqual(linkVariant, "");
  assert.doesNotMatch(linkVariant, /\bbg-/);
  assert.doesNotMatch(linkVariant, /\bborder\b/);
  assert.doesNotMatch(button, /variant !== "link"/);
});

test("the focus treatment is a solid ring, not a translucent tint", () => {
  const button = read("src/components/ui/button.tsx");

  // Focus is one solid 3px indicator in the focus role: `ring-ring`, with no
  // `/50` opacity modifier, so it stays visible against the control it
  // surrounds and against the surface behind it.
  assert.match(
    button,
    /focus-visible:border-ring focus-visible:ring-\[3px\] focus-visible:ring-ring/,
  );
  assert.doesNotMatch(button, /ring-ring\/\d/);
});

test("the legacy marketing sheets still exempt the CTA from their element resets", () => {
  // audit.css and suburb-report.css are unlayered, so their `.page a` and
  // `.page button` element rules outrank every Tailwind utility. They must
  // exclude the CTA, and the marker has to travel in className because that is
  // the one prop every wrapper component forwards.
  const button = read("src/components/ui/button.tsx");
  assert.match(button, /const CTA_MARKER = "bw-cta"/);

  const audit = read("src/app/audit.css");
  assert.match(audit, /\.audit-page :where\(a, button\):not\(\.bw-cta\)/);

  const suburb = read("src/app/suburb/[postcode]/suburb-report.css");
  assert.match(suburb, /\.sr-page :where\(a\):not\(\.bw-cta\)/);
  assert.match(suburb, /\.sr-page :where\(button, input\):not\(\.bw-cta\)/);
  assert.match(suburb, /\.sr-cta-actions > button:not\(\.bw-cta\)/);
});
