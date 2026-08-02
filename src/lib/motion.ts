/*
 * Atlantic motion vocabulary. Pages and components import from here instead
 * of inventing route-local timings.
 *
 * Reduced motion: gate transforms with `useReducedMotion` (re-exported below).
 * Reduced = opacity-only, no transforms, numbers render their final value
 * instantly. Nothing loops; nothing exceeds the entrance duration.
 */
import type { Transition, Variants } from "motion/react";

export { useReducedMotion } from "motion/react";

/**
 * Spring presets (values re-typed from tuned references, never pasted):
 * `snappy` for micro-interactions, `gentle` for entrances, `slow` for
 * progress bars and meters.
 */
export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30 } satisfies Transition,
  gentle: { type: "spring", stiffness: 260, damping: 28 } satisfies Transition,
  slow: { type: "spring", stiffness: 170, damping: 26 } satisfies Transition,
} as const;

/** Durations in seconds. Nothing in the customer surface moves slower than `entrance`. */
export const durations = {
  micro: 0.14,
  state: 0.22,
  entrance: 0.36,
} as const;

/** Gap between sibling entrances, seconds (12px rise + fade, once per navigation). */
export const staggerInterval = 0.04;

/** Count-up duration for KPI numbers, seconds. */
export const countUpDuration = 0.9;

/** CSS-side spring curve for `transition`/`animation` shorthands (matches the mockup). */
export const cssSpring = "cubic-bezier(0.16, 1, 0.3, 1)";

/** Card and list-item entrance: 12px rise + fade. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springs.gentle },
};

/** Opacity-only entrance used when the visitor prefers reduced motion. */
export const riseReduced: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.state } },
};

/** Parent container that staggers child entrances. */
export const riseContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: staggerInterval } },
};

/** Resolve the entrance pair for the current reduced-motion preference. */
export function entrance(reduced: boolean | null): {
  container: Variants;
  item: Variants;
} {
  return {
    container: riseContainer,
    item: reduced ? riseReduced : rise,
  };
}
