import type { LeadsCopy } from "../niche";

export const leads: LeadsCopy = {
  title: "Leads",
  captured: (count) =>
    count === 1
      ? "1 captured in the last 30 days."
      : `${count} captured in the last 30 days.`,
  syncedAt: (time) => `Synced ${time}`,
  syncCta: "Sync from Meta",
  stats: {
    leads: "Leads",
    highIntent: "High intent",
    duplicates: "Duplicates flagged",
    duplicatesNote: "Matched by email or phone",
  },
  searchPlaceholder: "Search leads",
  filters: { all: "All", highIntent: "High intent", duplicates: "Duplicates" },
  exportCsv: "Export CSV",
  columns: {
    lead: "Lead",
    name: "Name",
    email: "Email",
    phone: "Phone",
    suburb: "Suburb",
    sourceAd: "Source ad",
    quality: "Quality",
    delivery: "Delivery",
    status: "Status",
    capturedAt: "Captured at",
  },
  status: { newLead: "New", possibleDuplicate: "Possible duplicate" },
  showing: (shown, total) => `Showing ${shown} of ${total}`,
  neverSynced: "Never synced",
  noMatches: "No leads match your search or filters.",
  empty: {
    title: "No leads yet",
    body: "Leads land here as soon as your first ad is live.",
  },
};
