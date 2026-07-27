"use client";

/*
 * Ported from motion-primitives `animated-number` (MIT) — the registry
 * rate-limited the CLI install. Extended with a formatter (currency/decimal
 * KPIs) and an on-view start; reduced motion renders the final value
 * instantly.
 */

import * as React from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import type { SpringOptions } from "motion/react";

import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

const defaultFormat = (value: number) => Math.round(value).toLocaleString("en-AU");

export function AnimatedNumber({
  value,
  className,
  springOptions,
  format = defaultFormat,
  startOnView = true,
}: {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  /** Turn the interpolated value into display text (rounding, prefix, decimals). */
  format?: (value: number) => string;
  /** Wait until the number scrolls into view before counting up. */
  startOnView?: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const started = reduced || !startOnView || inView;

  const spring = useSpring(reduced ? value : 0, springOptions ?? springs.slow);
  const display = useTransform(spring, (current) => format(current));

  React.useEffect(() => {
    if (reduced) {
      spring.jump(value);
      return;
    }
    if (started) {
      spring.set(value);
    }
  }, [reduced, spring, started, value]);

  return (
    <motion.span ref={ref} className={cn("tabular-nums", className)}>
      {display}
    </motion.span>
  );
}
