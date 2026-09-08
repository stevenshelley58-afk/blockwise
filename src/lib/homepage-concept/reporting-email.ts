/**
 * Sanitized sample of the reporting email shown in the homepage concept.
 * Provenance: commit 62dfd2ba2, src/lib/homepage-concept/reporting.ts.
 * Nothing is fetched, saved, addressed, or sent.
 */
export const REPORT_EMAIL = {
  subject: "Your week in ads",
  intro: "Here’s how your ads are going.",
  period: "Last 7 days",
  metrics: [
    { label: "New leads", value: "18" },
    { label: "Ad spend", value: "$324" },
    { label: "Cost per lead", value: "$18" },
  ],
  footer: {
    text: "The numbers you need. No follow-up email required.",
    links: ["View report"],
  },
} as const;
