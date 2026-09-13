import type { AdAuditResult } from "./ad-audit";

export type AuditAvailability = "unavailable" | "limited" | "empty" | "observed";

/** A completed query is still an observation, not complete market coverage. */
export function getAuditAvailability(audit: Pick<AdAuditResult, "stats"> | null): AuditAvailability {
  if (!audit) return "unavailable";
  if (audit.stats.capped) return "limited";
  if (audit.stats.totals.detected === 0) return "empty";
  return "observed";
}

export function getAuditHeroCopy({
  availability,
  area,
  detected,
  active,
  advertisers,
}: {
  availability: AuditAvailability;
  area: string;
  detected: number;
  active: number;
  advertisers: number;
}) {
  const count = new Intl.NumberFormat("en-AU");
  if (availability === "unavailable") return { headline: `Local ad observations are unavailable for ${area}.`, lede: "We could not verify a local scan right now. Request a campaign plan based on your lead goal, not a claim about the market." };
  if (availability === "empty") return { headline: `No verified local ad observations were returned for ${area}.`, lede: "This does not show whether local agencies are advertising. Request a campaign plan based on your lead goal." };
  if (availability === "limited") return { headline: `This scan observed ${count.format(detected)} local real estate ads around ${area}.`, lede: `The available public observations include ${count.format(active)} marked active across ${count.format(advertisers)} advertisers. Coverage is limited and does not represent the whole local market.` };
  return { headline: `This scan observed ${count.format(detected)} local real estate ads around ${area}.`, lede: `${count.format(active)} were marked active across ${count.format(advertisers)} advertisers. These are public observations, not a complete view of the local market.` };
}
