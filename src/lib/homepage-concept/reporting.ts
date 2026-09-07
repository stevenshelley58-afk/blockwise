/** Synthetic reporting fixtures. No customer data or email delivery. */
export type ReportRange = "week" | "month";
export type EmailCadence = "daily" | "weekly" | "custom";

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
    labels: ["1 Aug", "5 Aug", "10 Aug", "15 Aug", "20 Aug", "25 Aug", "30 Aug"],
  },
} as const;

export const EMAIL_CADENCES = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "custom", label: "Custom" },
] as const;

export function emailSchedule(cadence: EmailCadence, customDays: number) {
  const days = Number.isFinite(customDays) ? Math.min(30, Math.max(1, Math.round(customDays))) : 3;
  if (cadence === "weekly") return "Every Monday, 8:00 am";
  if (cadence === "daily" || days === 1) return "Every day, 8:00 am";
  return `Every ${days} days, 8:00 am`;
}

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
  const line = vertices.map(({ x, y }, index) => `${index ? "L" : "M"}${x},${y}`).join(" ");
  return {
    vertices,
    line,
    area: line ? `${line} L${end.x},188 L8,188 Z` : "",
    end,
  };
}
