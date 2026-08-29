import type { AdRadarCopy } from "../niche";

export const adRadar: AdRadarCopy = {
  title: "Ad Radar",
  lead: "See what's working around you before you spend.",
  searchPlaceholder: "Postcode, suburb, agency, or agent",
  searchScope: "Predictive search for postcode, suburb, agency or agent",
  includeSurrounding: "Include surrounding suburbs",
  filters: {
    agency: "Agency",
    agent: "Agent",
    allAgencies: "All agencies",
    allAgents: "All agents",
    // `value` mirrors the stored ad classification / `adType` query param and
    // must not change; only the label is niche copy.
    adTypes: [
      { value: "listing", label: "Listing" },
      { value: "just_sold", label: "Just sold" },
      { value: "appraisal", label: "Appraisal" },
      { value: "open_home", label: "Open home" },
      { value: "property_management", label: "Property mgmt" },
      { value: "market_update", label: "Market update" },
      { value: "agency_brand", label: "Agency brand" },
    ],
    hookPlaceholder: "e.g. free appraisal",
  },
};
