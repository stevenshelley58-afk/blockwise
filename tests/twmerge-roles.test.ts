import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// Comments and JSDoc would otherwise pollute the regex, e.g. a comment that
// merely names a role token would fail the "every role is registered" check.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, "")
    .replace(/[ \t]+\/\/[^\n]*$/gm, "");
}

/*
 * tailwind-merge cannot see this project's `@theme` tokens, so every named type
 * role (text-page-title, text-body, ...) silently falls into the `text-color`
 * conflict group. When a Button merges `text-cta-foreground` with `text-body`,
 * the colour loses and the label inherits the button's fill. This file
 * guarantees the fix stays in place: `utils.ts` must use `extendTailwindMerge`
 * and must register the complete, current set of type roles.
 */
test("cn() registers every named type role with tailwind-merge", () => {
  const utils = stripComments(read("src/lib/utils.ts"));

  assert.match(
    utils,
    /extendTailwindMerge/,
    "src/lib/utils.ts must use extendTailwindMerge so named type roles are font-size, not text-colour",
  );
  assert.match(
    utils,
    /import\s*\{[^}]*extendTailwindMerge[^}]*\}\s*from\s*["']tailwind-merge["']/,
    "utils.ts must import extendTailwindMerge from tailwind-merge",
  );
  assert.doesNotMatch(
    utils,
    /import\s*\{[^}]*\btwMerge\b[^}]*\}\s*from\s*["']tailwind-merge["']/,
    "utils.ts must not import a raw twMerge — the merge config lives in the extended instance",
  );
  assert.match(
    utils,
    /"font-size"\s*:\s*\[\s*\{\s*text:/,
    "the type roles must be registered against the font-size group",
  );

  // The single source of truth for roles is `tailwind.css`; the registration
  // list in `utils.ts` must be an exact set match.
  const tailwind = stripComments(read("src/app/tailwind.css"));
  const declaredRoles = new Set(
    [...tailwind.matchAll(/^\s*--text-([a-z0-9-]+):/gm)]
      .map((match) => match[1])
      .filter((role) => !role.endsWith("--line-height") && !role.endsWith("--font-weight")),
  );
  assert.ok(declaredRoles.size > 0, "tailwind.css must declare at least one --text-* role");

  const registration = utils.match(/const\s+TYPE_ROLES\s*=\s*\[([\s\S]*?)\]\s*(?:as const)?\s*;/);
  assert.ok(registration, "utils.ts must declare a TYPE_ROLES array");
  const registeredRoles = new Set(
    [...registration[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((match) => match[1]),
  );

  for (const role of declaredRoles) {
    assert.ok(registeredRoles.has(role), `role ${JSON.stringify(role)} is declared in tailwind.css but not registered with tailwind-merge`);
  }
  for (const role of registeredRoles) {
    assert.ok(declaredRoles.has(role), `role ${JSON.stringify(role)} is registered with tailwind-merge but not declared in tailwind.css`);
  }
});