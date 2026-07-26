"use client";

/*
 * Route entrance transition for the customer surface (docs/REBUILD-PLAN.md
 * §4): one 12px rise + fade per navigation, spring-timed, collapsed to
 * opacity-only under prefers-reduced-motion. `template.tsx` remounts on every
 * navigation, which is exactly the once-per-navigation behaviour we want.
 */

import { motion } from "motion/react";

import { entrance, useReducedMotion } from "@/lib/motion";

export default function CustomerTemplate({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const { item } = entrance(reduced);

  return (
    <motion.div initial="hidden" animate="visible" variants={item}>
      {children}
    </motion.div>
  );
}
