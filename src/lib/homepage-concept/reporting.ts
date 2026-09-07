/** Synthetic reporting fixtures. No customer data or email delivery. */
export type ReportRange = "week" | "month";
export type EmailCadence = "daily" | "weekly" | "custom";
const DAILY_LEADS = [...Array.from({ length: 23 }, (_, index) => index === 0 || index === 11 ? 1 : 2), 1, 3, 2, 4, 2, 3, 3];
export const REPORTS = {
  week: { label: "Last 7 days", leads: 18, spend: 324,
    points: [1, 3, 2, 4, 2, 3, 3], labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    campaigns: [{ name: "Mount Lawley appraisals", leads: 12, spend: 216 }, { name: "Inglewood sellers", leads: 6, spend: 108 }],
  },
  month: { label: "Last 30 days", leads: 62, spend: 1116,
    points: [13, 13, 14, 22], labels: ["Days 1–7", "8–14", "15–21", "22–30"],
    campaigns: [{ name: "Mount Lawley appraisals", leads: 44, spend: 792 }, { name: "Inglewood sellers", leads: 18, spend: 324 }],
  },
} as const;
export const EMAIL_CADENCES = [{ id: "daily", label: "Daily" }, { id: "weekly", label: "Weekly" }, { id: "custom", label: "Custom" }] as const;
export function exampleEmail(cadence: EmailCadence, customDays: number) {
  const days = Number.isFinite(customDays) ? Math.min(30, Math.max(1, Math.round(customDays))) : 3;
  if (cadence === "weekly") return {
    subject: "Your week in ads", period: "Last 7 days", schedule: "Every Monday, 8:00 am",
    leads: REPORTS.week.leads, spend: REPORTS.week.spend,
  };
  const leads = DAILY_LEADS.slice(-(cadence === "daily" ? 1 : days)).reduce((sum, value) => sum + value, 0);
  return {
    subject: cadence === "daily" ? "Your daily ad update" : "Your ad performance update",
    period: cadence === "daily" || days === 1 ? "Yesterday" : `Last ${days} days`,
    schedule: cadence === "daily" || days === 1 ? "Every day, 8:00 am" : `Every ${days} days, 8:00 am`,
    leads, spend: leads * 18,
  };
}
export function formatAdSpend(value: number) { return `$${value.toLocaleString("en-AU")}`; }
