"use client";

/*
 * Simple progress ring matching the Atlantic mockup: data-track circle,
 * data-hue fill, dashoffset animated on mount with the shared spring curve.
 * Reduced motion renders the final arc instantly.
 */

import { useEffect, useState } from "react";

import { cssSpring } from "@/lib/motion";

export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 6,
  label,
}: {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = on ? circumference * (1 - clamped / 100) : circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className="-rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-data-track"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        className="stroke-data motion-reduce:transition-none"
        strokeDasharray={circumference}
        style={{
          strokeDashoffset: offset,
          transition: `stroke-dashoffset 1.1s ${cssSpring}`,
        }}
      />
    </svg>
  );
}
