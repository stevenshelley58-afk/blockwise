import { resolveAdRadarLocationSearch } from "../research/ad-radar-location.ts";
import { loadAllPublicAdRadarCards } from "../research/public-ad-radar.ts";
import { buildSuburbReportInsights, type GapConcept } from "../research/suburb-report-insights.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// ---------------------------------------------------------------------------
// The market gap behind an audit: what the local ad mix is missing.
//
// Same source as the public suburb report, so the three ads we generate for a
// visitor answer the exact gap shown on the page they arrived from.
// ---------------------------------------------------------------------------

export type PostcodeGap = {
  postcode: string;
  suburb: string;
  concepts: GapConcept[];
  observedAds: number;
};

export async function loadPostcodeGap(postcode: string): Promise<PostcodeGap | null> {
  if (!/^\d{4}$/.test(postcode)) return null;
  const location = resolveAdRadarLocationSearch(postcode, { includeSurroundingSuburbs: true });
  if (!location) return null;

  const label =
    location.terms.find((term) => !/^\d{4}$/.test(term) && !/^(WA|Western Australia)$/i.test(term)) ||
    location.label ||
    postcode;

  try {
    const supabase = createSupabaseServiceClient();
    const response = await loadAllPublicAdRadarCards(supabase, {
      location: postcode,
      includeSurroundingSuburbs: true,
      limit: 36,
      sort: "longest",
      maxPages: 2,
    });
    const suburb = suburbFromLabel(label, postcode);
    const insights = buildSuburbReportInsights(response.ads, suburb);
    return { postcode, suburb, concepts: insights.gapConcepts, observedAds: response.ads.length };
  } catch {
    return { postcode, suburb: suburbFromLabel(label, postcode), concepts: [], observedAds: 0 };
  }
}

function suburbFromLabel(label: string, postcode: string): string {
  const value = label
    .replace(new RegExp(`\\b${postcode}\\b`, "g"), "")
    .replace(/\b(WA|Western Australia|Australia)\b/gi, "")
    .replace(/[,\s]+$/g, "")
    .trim();
  return value || "Your suburb";
}
