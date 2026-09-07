import type { EvidenceSegment } from "./postcode-campaign.ts";
export function previewSegment(value: string | string[] | undefined): EvidenceSegment {
  return value === "no_ads_found_after_successful_recent_scan" || value === "unknown" ? value : "recent_ads_observed";
}
