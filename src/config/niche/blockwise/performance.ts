import type { PerformanceCopy } from "../niche";

export const performance: PerformanceCopy = {
  title: "Results",
  subtitle: "Spend, leads and cost per lead across your live ads.",
  ranges: { d7: "7 days", d30: "30 days", d90: "90 days" },
  rangesShort: { d7: "7d", d30: "30d", d90: "90d" },
  charts: {
    spend: "Spend over time",
    leads: "Valid leads over time",
    cpl: "Cost per lead over time",
  },
  cplGapNote: "Days with no valid leads show no cost per lead.",
  leadResults: {
    title: "Lead results",
    subtitle: "Results by listing or offer, with lead quality, cost, and the next action.",
  },
  areaBreakdown: {
    title: "Valid leads by suburb",
    empty:
      'No suburb attribution yet. Suburbs come from lead records or the "Suburb - Name" ad set convention.',
  },
  budgetPacing: "Budget pacing",
  demoChip: "Example report",
  viewExample: "View example report",
  refresh: "Refresh",
  refreshing: "Refreshing",
  customRange: "Custom",
  states: {
    disconnectedTitle: "Connect Meta to see results",
    disconnectedBody:
      "Link your ad account and results sync here automatically.",
    connectCta: "Connect Meta",
    emptyTitle: "No results yet",
    emptyBody: "Results appear within a day of your first ad going live.",
    staleNotice: (age) => `Data last synced ${age} ago.`,
    notSynced: "Not synced yet",
  },
};
