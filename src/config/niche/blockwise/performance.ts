import type { PerformanceCopy } from "../niche";

export const performance: PerformanceCopy = {
  title: "Results",
  subtitle: "Spend, leads and cost per lead across your live ads.",
  ranges: { d1: "1 day", d7: "7 days", d30: "30 days" },
  charts: {
    spend: "Spend over time",
    leads: "Valid leads over time",
    cpl: "Cost per lead over time",
  },
  cplGapNote: "Days with no valid leads show no cost per lead.",
  chartMetricLabel: "Chart metric",
  rangeLabel: "Date range",
  singleDayNote: "One day has no trend to chart. Choose 7 days or more to see the line.",
  moreDetails: "More reporting details",
  adDetails: "Open ad details",
  customFromLabel: "From date",
  customToLabel: "To date",
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
