"use client";

/*
 * KPI sparkline in the single data hue (mockup pattern: smooth stroke path +
 * endpoint dot). Pure presentation — points are normalised internally.
 *
 * The line carries shape, never magnitude: it is drawn across the series' own
 * range so a small week is still readable in a 26px box, and the percentage
 * printed beside it states the real size of the move. A series that barely
 * moved draws nothing at all, because filling the box with rounding jitter
 * would invent a trend that is not there. `className` sizes the drawn box;
 * leave it off to use the intrinsic one.
 *
 * The curve is the product's one line: a monotone cubic through the same points
 * the figure row charts, smooth in a card and on a phone alike, and never
 * overshooting a day's own value.
 */

import { smoothLinePath } from "@/lib/charts/smooth-line";
import { cn } from "@/lib/utils";

export function Sparkline({
  points,
  width = 72,
  height = 26,
  className,
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  if (max <= 0 || max - min < max * 0.02) return null;
  const span = max - min;
  const pad = 2;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((point - min) / span) * (height - pad * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });

  const path = smoothLinePath(coords);
  const [lastX, lastY] = coords[coords.length - 1] ?? [0, 0];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path d={path} fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="stroke-data" />
      <circle cx={lastX} cy={lastY} r={2.2} className="fill-data" />
    </svg>
  );
}
