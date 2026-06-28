export const AD_RADAR_SORT_OPTIONS = [
  { value: "recent", label: "Most recent", description: "Last observed first" },
  { value: "longest", label: "Longest running", description: "Longest delivery window first" },
  { value: "newest_started", label: "Newest start", description: "Latest campaign start first" },
  { value: "oldest_started", label: "Oldest start", description: "Earliest campaign start first" },
  { value: "recently_stopped", label: "Recently stopped", description: "Most recent stop date first" },
  { value: "active_first", label: "Active first", description: "Live ads before inactive ads" },
  { value: "advertiser_az", label: "Advertiser A-Z", description: "Advertiser page name" },
] as const;

export type AdRadarSort = (typeof AD_RADAR_SORT_OPTIONS)[number]["value"];

export const DEFAULT_AD_RADAR_SORT: AdRadarSort = "recent";

const AD_RADAR_SORT_VALUES = new Set<string>(AD_RADAR_SORT_OPTIONS.map((option) => option.value));

export function normaliseAdRadarSort(value: string | null | undefined): AdRadarSort {
  return value && AD_RADAR_SORT_VALUES.has(value) ? (value as AdRadarSort) : DEFAULT_AD_RADAR_SORT;
}
