"use client";

/*
 * Ported from motion-primitives `animated-group` (MIT) — the registry
 * rate-limited the CLI install. Trimmed to the one preset the dashboard
 * uses: a staggered 12px rise + fade that runs once per navigation and
 * collapses to opacity-only under reduced motion.
 */

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";

import { entrance } from "@/lib/motion";

export function AnimatedGroup({
  children,
  className,
  itemClassName,
  variants,
}: {
  children: React.ReactNode;
  className?: string;
  /** Applied to the wrapper around each child (e.g. `h-full` inside grids). */
  itemClassName?: string;
  /** Override the shared entrance variants. */
  variants?: { container?: Variants; item?: Variants };
}) {
  const reduced = useReducedMotion();
  const defaults = entrance(reduced);
  const container = variants?.container ?? defaults.container;
  const item = variants?.item ?? defaults.item;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={container}
    >
      {React.Children.map(children, (child, index) => (
        <motion.div key={index} className={itemClassName} variants={item}>
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
