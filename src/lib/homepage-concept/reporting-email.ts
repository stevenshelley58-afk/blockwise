/** Static email preview. Nothing is addressed or sent. */
export const REPORT_EMAIL = {
  subject: "Example: your ad report",
  intro: "Here is the example activity for your Free property appraisal campaign.",
  metricLabels: ["Leads", "Cost per lead", "Meta ad spend"],
  footer: "Open Blockwise to review the example leads. You decide how and when to follow up.",
} as const;

export const REPORT_EMAIL_FREQUENCIES = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "off", label: "Off" },
] as const;

export type ReportEmailFrequency = (typeof REPORT_EMAIL_FREQUENCIES)[number]["id"];
