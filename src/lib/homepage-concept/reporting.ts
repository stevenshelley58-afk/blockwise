/** Synthetic reporting fixtures. No customer data or email delivery. */
export type ReportRange = "week" | "month";
export const REPORTS = {
  week: {
    label: "Last 7 days",
    leads: 18,
    spend: 324,
    points: [1, 3, 2, 4, 2, 3, 3],
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  month: {
    label: "Last 30 days",
    leads: 62,
    spend: 1116,
    points: [6, 8, 7, 9, 10, 11, 11],
    labels: ["Days 1–4", "Days 5–8", "Days 9–12", "Days 13–16", "Days 17–20", "Days 21–25", "Days 26–30"],
  },
} as const;

export function formatAdSpend(value: number) {
  return `$${value.toLocaleString("en-AU")}`;
}

/** Fixed-coordinate geometry keeps the marketing visual light and makes its two ranges morph cleanly. */
export function lineChartGeometry(points: readonly number[], maximum: number) {
  const vertices = points.map((value, index) => ({
    x: 8 + index / Math.max(1, points.length - 1) * 584,
    y: 188 - value / maximum * 176,
  }));
  const end = vertices[vertices.length - 1] ?? { x: 8, y: 188 };
  // Cubic segments meet with matching horizontal tangents: smooth, bounded,
  // and through every fixture point, with no overshoot or fabricated extrema.
  const line = vertices.map(({ x, y }, index) => {
    if (!index) return `M${x},${y}`;
    const previous = vertices[index - 1];
    const middle = (previous.x + x) / 2;
    return `C${middle},${previous.y} ${middle},${y} ${x},${y}`;
  }).join(" ");
  return {
    vertices,
    line,
    area: line ? `${line} L${end.x},188 L8,188 Z` : "",
    end,
  };
}
