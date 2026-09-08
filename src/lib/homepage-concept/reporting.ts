/** Illustrative homepage data only. No customer data is fetched or saved. */
export type ReportRange = "week" | "month";

export const REPORTS = {
  week: {
    label: "Last 7 days",
    shortLabel: "7 days",
    leads: 18,
    spend: 324,
    points: [1, 3, 2, 4, 2, 3, 3],
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },
  month: {
    label: "Last 30 days",
    shortLabel: "30 days",
    leads: 62,
    spend: 1116,
    points: [6, 8, 7, 9, 10, 11, 11],
    labels: ["Days 1 to 4", "Days 5 to 8", "Days 9 to 12", "Days 13 to 16", "Days 17 to 20", "Days 21 to 25", "Days 26 to 30"],
  },
} as const;

export const REPORT_EXAMPLE = {
  campaign: "Free property appraisal",
  agency: "West Coast Home Co",
  status: "Example data",
  lead: {
    name: "Jordan Whitfield",
    email: "j.whitfield@example.com",
    phone: "04·· ··· ··31",
    suburb: "Mt Lawley",
    source: "Facebook lead form",
    received: "Today, 9:12 am",
  },
} as const;

export function formatAdSpend(value: number) {
  return `$${value.toLocaleString("en-AU")}`;
}

/** Fixed coordinates keep both seven-point ranges directly comparable. */
export function lineChartGeometry(points: readonly number[], maximum: number) {
  const vertices = points.map((value, index) => ({
    x: 8 + index / Math.max(1, points.length - 1) * 584,
    y: 188 - value / maximum * 176,
  }));
  const end = vertices[vertices.length - 1] ?? { x: 8, y: 188 };
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
