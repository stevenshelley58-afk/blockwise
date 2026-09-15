import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge cannot see this project's `@theme` tokens, so by default it
 * does not know that `text-body`, `text-control`, `text-support`, `text-meta`,
 * `text-metric`, `text-page-title`, `text-page-title-sm`, `text-section-title`
 * and `text-component-title` are *font sizes*. Its validator only recognises the
 * built-in scale, so it files every one of them under the `text-color` group.
 *
 * That is a real bug, not a style nit: a type role and a text colour then land
 * in the same conflict group and the later one silently deletes the earlier one.
 * The shared Button hit exactly that — `text-cta-foreground` from the variant
 * was dropped in favour of `text-body` from the size, so the label inherited the
 * button's own fill and primary CTAs rendered with invisible text.
 *
 * Registering the roles against `font-size` here means a type role and a text
 * colour can coexist, while two type roles still resolve to the last one, which
 * is what `size="lg"` overriding the base `text-control` is meant to do.
 *
 * Keep this list in step with the `--text-*` tokens in `src/app/tailwind.css`.
 * `tests/design-system-contract.test.ts` checks that they still match.
 */
const TYPE_ROLES = [
  "page-title-sm",
  "page-title",
  "section-title",
  "component-title",
  "metric",
  "support",
  "control",
  "body",
  "meta",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: TYPE_ROLES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
