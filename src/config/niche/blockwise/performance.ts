import type { PerformanceCopy } from "../niche";

export const performance: PerformanceCopy = {
  title: "Performance",
  subtitle: "Spend, leads and cost per lead across your live ads.",
  ranges: { d7: "7 days", d30: "30 days", d90: "90 days" },
  charts: {
    spend: "Spend over time",
    leads: "Valid leads over time",
    cpl: "Valid CPL over time",
  },
  demoChip: "Demo data",
  refresh: "Refresh",
  refreshing: "Refreshing",
  moreRanges: "More ranges",
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
