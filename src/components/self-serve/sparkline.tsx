"use client";

/*
 * KPI sparkline in the single data hue (mockup pattern: 72×26 stroke path +
 * endpoint dot). Pure presentation — points are normalised internally.
 */

export function Sparkline({
  points,
  width = 72,
  height = 26,
}: {
  points: number[];
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;

  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const pad = 2;

  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((point - min) / span) * (height - pad * 2);
    return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
  });

  const path = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join("");
  const [lastX, lastY] = coords[coords.length - 1] ?? [0, 0];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={path} fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="stroke-data" />
      <circle cx={lastX} cy={lastY} r={2.2} className="fill-data" />
    </svg>
  );
}
