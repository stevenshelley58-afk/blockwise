import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// Comments count against a regex guard: a comment that merely names a banned
// token, or a comment inside a token block that names a selector or a value,
// would otherwise fail (or truncate) the check. Strip both comment forms first,
// so every guard below reads only what the code actually does.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
    .replace(/[ \t]+\/\/[^\n]*$/gm, "");
}

function cssBlock(source: string, selector: string): string {
  const at = source.indexOf(selector);
  assert.notEqual(at, -1, `expected ${selector} to exist`);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  assert.notEqual(open, -1, `expected an opening brace after ${selector}`);
  assert.notEqual(close, -1, `expected a closing brace for ${selector}`);
  return source.slice(open + 1, close);
}

function customProperties(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
}

function readUiPrimitives(): { file: string; source: string }[] {
  const dir = "src/components/ui";
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .sort()
    .map((name) => ({ file: path.join(dir, name), source: stripComments(read(path.join(dir, name))) }));
}

/*
 * The design-system consolidation contract.
 *
 * These are static guards on the decisions now in force: one role-based radius
 * scale, one interactive-boundary role separate from the decorative divider,
 * named type roles, and Ad Studio as the dark theme of the same system. They
 * are deliberately targeted — each guard names the file(s) and the token it
 * protects — so a real regression fails loudly without banning every literal.
 */

test("no automatically injected decorative button arrows", () => {
  // Decision: plain text is the default. The button used to inject a trailing
  // arrow disc on any control with visible text; that is drift, not a style.
  const button = stripComments(read("src/components/ui/button.tsx"));
  assert.doesNotMatch(button, /ArrowUpRight/);
  assert.doesNotMatch(button, /button-disc/);
  assert.doesNotMatch(button, /--cta-disc/);
  assert.doesNotMatch(button, /arrow\?:/);

  // And no shared primitive hand-rolls its own disc: the slot marker and the
  // disc custom properties must not reappear anywhere under ui/.
  for (const { file, source } of readUiPrimitives()) {
    assert.doesNotMatch(source, /data-slot="button-disc"/, `${file} must not re-add the button disc slot`);
    assert.doesNotMatch(source, /--cta-disc/, `${file} must not re-add the disc tokens`);
  }
});

test("shared controls and cards resolve to the agreed radius roles", () => {
  // One role-based scale, defined once: controls 10px, cards 16px, panels 20px,
  // chips 9999px. A second live definition is how the 12px/16px card drift
  // started, so theme-monochrome.css must not restate the roles.
  const globals = stripComments(read("src/app/globals.css"));
  const theme = stripComments(read("src/app/theme-monochrome.css"));

  for (const role of ["--r-ctl", "--r-card", "--r-panel", "--r-chip"]) {
    const definitions = globals.match(new RegExp(`^\\s*${role}\\s*:`, "gm")) ?? [];
    assert.equal(definitions.length, 1, `${role} must be defined exactly once in globals.css`);
    assert.doesNotMatch(
      theme,
      new RegExp(`${role}\\s*:`),
      `${role} must not be restated in theme-monochrome.css`,
    );
  }

  // `--r-control` was referenced at 13 call sites but never defined, so those
  // elements rendered square. It is now an alias that resolves.
  assert.match(globals, /--r-control:\s*var\(--r-ctl\)/);

  // Cards take the card role, not the stock `rounded-lg` (12px).
  const card = stripComments(read("src/components/ui/card.tsx"));
  assert.match(card, /rounded-\(--r-card\)/);
  assert.doesNotMatch(card, /\brounded-lg\b/);
});

test("the dark theme block covers the light roles it must restate", () => {
  // Ad Studio is the dark theme of the same system, so its block must define
  // every colour role the light theme defines for the same semantic purpose.
  // The required subset is listed explicitly so a missing role fails loudly.
  const theme = read("src/app/theme-monochrome.css");
  const lightRoles = customProperties(cssBlock(stripComments(theme), ":root"));
  const dark = cssBlock(stripComments(theme), '[data-theme="studio-dark"]');
  const darkRoles = customProperties(dark);

  const requiredDarkRoles = [
    // surfaces and text
    "--bg", "--surface", "--surface-subtle", "--ink", "--muted",
    // decorative dividers
    "--line", "--line-soft", "--line-heavy",
    // the accent family
    "--accent", "--accent-strong", "--accent-press", "--accent-tint",
    // status roles
    "--green", "--green-soft", "--amber", "--rose", "--rose-soft",
    "--ui-success", "--ui-success-soft",
    "--ui-warning", "--ui-warning-soft",
    "--ui-error", "--ui-error-soft",
    // the quantitative data hue
    "--ui-data", "--ui-data-soft", "--ui-data-track",
    // the CTA
    "--ui-cta", "--ui-cta-foreground", "--ui-cta-soft",
    // elevation and focus
    "--shadow", "--shadow-float", "--ring",
    // sidebar chrome
    "--side-bg", "--side-ink", "--side-ink-active", "--side-line", "--side-cap",
    "--side-active-bg", "--side-hover-bg", "--brand-ink",
  ];
  for (const role of requiredDarkRoles) {
    assert.ok(darkRoles.has(role), `[data-theme="studio-dark"] must define ${role}`);
  }

  // Every light role is restated too, except the ones documented as shared.
  // --faint is a decorative mark colour in both themes and deliberately does
  // not track --muted.
  const sharedInBothThemes = new Set(["--faint"]);
  for (const role of lightRoles) {
    if (sharedInBothThemes.has(role)) continue;
    assert.ok(darkRoles.has(role), `[data-theme="studio-dark"] must restate the light role ${role}`);
  }

  // The `--ui-*` bridge aliases are restated as well: because var() resolves at
  // computed-value time on the declaring element, a nested scope would
  // otherwise inherit the already-resolved light values and silently paint
  // light. This is the whole reason the block repeats them.
  for (const alias of [
    "--ui-background", "--ui-foreground",
    "--ui-card", "--ui-card-foreground",
    "--ui-popover", "--ui-popover-foreground",
    "--ui-primary", "--ui-secondary", "--ui-secondary-foreground",
    "--ui-muted", "--ui-muted-foreground",
    "--ui-accent", "--ui-accent-foreground",
    "--ui-destructive", "--ui-border", "--ui-input", "--ui-ring",
  ]) {
    assert.ok(darkRoles.has(alias), `[data-theme="studio-dark"] must restate the bridge alias ${alias}`);
  }
});

test("interactive control boundaries and focus use their own roles", () => {
  const tailwind = stripComments(read("src/app/tailwind.css"));
  const theme = stripComments(read("src/app/theme-monochrome.css"));
  const globals = stripComments(read("src/app/globals.css"));

  // A control a person can act on needs an edge they can see, so the control
  // boundary is its own role, deliberately not the decorative divider.
  const controlBorder = tailwind.match(/--ui-control-border:\s*([^;]+);/)?.[1].trim();
  assert.ok(controlBorder, "--ui-control-border must be defined in tailwind.css");
  assert.match(tailwind, /--ui-input:\s*var\(--ui-control-border\)/);
  assert.match(tailwind, /--ui-border:\s*var\(--line\)/);

  const decorativeLine = theme.match(/--line:\s*([^;]+);/)?.[1].trim();
  const baseLine = globals.match(/--line:\s*([^;]+);/)?.[1].trim();
  assert.notEqual(controlBorder, decorativeLine, "--ui-control-border must not equal the decorative --line");
  assert.notEqual(controlBorder, baseLine, "--ui-control-border must not equal the decorative --line");

  // Every shared control focuses with the solid ring role, never a /50 tint.
  for (const file of [
    "input.tsx",
    "select.tsx",
    "checkbox.tsx",
    "switch.tsx",
    "button.tsx",
    "badge.tsx",
    "tabs.tsx",
  ]) {
    const source = stripComments(read(path.join("src/components/ui", file)));
    assert.match(source, /focus-visible:ring-ring/, `${file} must focus with ring-ring`);
    assert.doesNotMatch(source, /focus-visible:ring-ring\/\d/, `${file} must not tint the focus ring`);
  }

  // Text-entry controls take the interactive boundary through `border-input`.
  for (const file of ["input.tsx", "select.tsx"]) {
    assert.match(
      stripComments(read(path.join("src/components/ui", file))),
      /border-input/,
      `${file} must use border-input`,
    );
  }
});

test("the dark theme defines every status role and the data hue", () => {
  // Colour is never the only carrier of state, but a dark surface must not
  // silently fall back to a light status colour either, so each text/surface
  // pair and the data hue are defined inside the dark block itself.
  const dark = cssBlock(stripComments(read("src/app/theme-monochrome.css")), '[data-theme="studio-dark"]');
  const darkValues = new Map(
    [...dark.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((match) => [match[1], match[2].trim()]),
  );

  for (const role of [
    "--ui-success", "--ui-success-soft",
    "--ui-warning", "--ui-warning-soft",
    "--ui-error", "--ui-error-soft",
    "--ui-data",
  ]) {
    assert.ok(darkValues.get(role), `[data-theme="studio-dark"] must give ${role} a value`);
  }
});

test("changed UI primitives carry no hardcoded colour or arbitrary size", () => {
  // Targeted, not a tree-wide ban: these are the shared primitives this change
  // touches. Values that bypass the token scale are the drift this work removes.
  // (creative-viewer.tsx and notice-bar.tsx also changed in this work but are
  // app-level compositions outside this primitive set, so they are not listed.)
  const changedPrimitives = [
    "src/components/ui/alert-dialog.tsx",
    "src/components/ui/alert.tsx",
    "src/components/ui/badge.tsx",
    "src/components/ui/button.tsx",
    "src/components/ui/card.tsx",
    "src/components/ui/chart.tsx",
    "src/components/ui/checkbox.tsx",
    "src/components/ui/command.tsx",
    "src/components/ui/dialog.tsx",
    "src/components/ui/dropdown-menu.tsx",
    "src/components/ui/input.tsx",
    "src/components/ui/popover.tsx",
    "src/components/ui/select.tsx",
    "src/components/ui/sheet.tsx",
    "src/components/ui/sidebar.tsx",
    "src/components/ui/skeleton.tsx",
    "src/components/ui/switch.tsx",
    "src/components/ui/tabs.tsx",
    "src/components/ui/tooltip.tsx",
  ];

  // Legitimate, deliberate exceptions, named per file rather than widening the
  // rule: an arbitrary value is allowed only where the role scale genuinely
  // cannot express it.
  const allowedLiterals: Record<string, string[]> = {
    // A 16px indicator at the 10px control radius reads as a circle.
    "src/components/ui/checkbox.tsx": ["rounded-[4px]"],
    // The rotated tooltip arrow tip.
    "src/components/ui/tooltip.tsx": ["rounded-[2px]"],
    // The 3px inset inside the tabs list.
    "src/components/ui/tabs.tsx": ["rounded-[calc(var(--r-ctl)-3px)]"],
    // recharts' own default stroke colours, used in attribute selectors, plus
    // its 2px legend swatches — library defaults, not theme values.
    "src/components/ui/chart.tsx": ["#ccc", "#fff", "rounded-[2px]"],
  };

  const patterns = [
    /#[0-9a-fA-F]{3,8}\b/g,
    /rgba?\(/g,
    /text-\[[^\]]*px[^\]]*\]/g,
    /rounded-\[[^\]]*px[^\]]*\]/g,
  ];

  for (const file of changedPrimitives) {
    const source = stripComments(read(file));
    const allowed = allowedLiterals[file] ?? [];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        assert.ok(
          allowed.includes(match[0]),
          `${file} has an un-tokenised literal ${JSON.stringify(match[0])}`,
        );
      }
    }
  }
});
