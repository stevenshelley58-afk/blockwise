import { cleanCustomerMetaDisplayText, normaliseMediaUrl } from "./customer-meta-card.ts";

/** Distinct advertiser page surfaced by the predictive advertiser search. */
export type AdvertiserSuggestion = {
  pageId: string | null;
  pageName: string;
  pageImageUrl: string | null;
};

type AdvertiserRow = {
  page_id: string | null;
  page_name: string | null;
  page_image_url: string | null;
};

/** Rows scanned before de-duplication. The cards view is one row per ad, so a
 * single advertiser can repeat many times — over-scan, then collapse by page. */
const ROW_SCAN_LIMIT = 200;
const SUGGESTION_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;

/**
 * Predictive list of advertiser pages (agents/agencies) whose page name matches
 * the typed term, sourced from the customer-safe Ad Radar read model so it
 * only ever surfaces advertisers that actually have visible, real-estate ads.
 */
export async function loadAdvertiserSuggestions(
  supabase: { from: (table: string) => any },
  query: string,
  limit: number = SUGGESTION_LIMIT,
): Promise<AdvertiserSuggestion[]> {
  const term = query.trim();
  if (term.length < MIN_QUERY_LENGTH) return [];

  const escaped = term.replace(/[%_\\]/g, "\\$&");
  const { data, error } = await supabase
    .from("customer_ad_radar_cards")
    .select("page_id,page_name,page_image_url")
    .ilike("page_name", `%${escaped}%`)
    .order("page_name", { ascending: true })
    .limit(ROW_SCAN_LIMIT);

  if (error || !data) return [];
  return dedupeAdvertisers(data as AdvertiserRow[], term, limit);
}

function dedupeAdvertisers(rows: AdvertiserRow[], term: string, limit: number): AdvertiserSuggestion[] {
  const seen = new Set<string>();
  const suggestions: AdvertiserSuggestion[] = [];

  for (const row of rows) {
    const pageName = cleanCustomerMetaDisplayText(row.page_name);
    if (!pageName) continue;
    const key = (row.page_id ?? pageName).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      pageId: row.page_id?.trim() || null,
      pageName,
      pageImageUrl: normaliseMediaUrl(row.page_image_url),
    });
  }

  // Surface prefix matches first ("ray" → "Ray White ..." before "Murray ...").
  const needle = term.toLowerCase();
  suggestions.sort((a, b) => {
    const aPrefix = a.pageName.toLowerCase().startsWith(needle) ? 0 : 1;
    const bPrefix = b.pageName.toLowerCase().startsWith(needle) ? 0 : 1;
    return aPrefix - bPrefix || a.pageName.localeCompare(b.pageName);
  });

  return suggestions.slice(0, limit);
}
