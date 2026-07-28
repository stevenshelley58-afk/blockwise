/**
 * Derive an Ad Radar search term from a Brand Pack contact address.
 *
 * The Brand Pack has no suburb field — only `contact.address`, a free-text
 * string extracted from the customer's website. Australian addresses reliably
 * end "<suburb> <STATE> <postcode>", so we take the postcode when present
 * (postcodes are the highest-confidence Ad Radar search key) and fall back to
 * the suburb token before the state abbreviation.
 *
 * Returns null when nothing confident can be extracted. Callers must fall back
 * to the existing IP-based location guess in that case.
 */

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export type BrandPackLocation = {
  /** The term handed to the Ad Radar search API. */
  searchTerm: string;
  /** Human label for the "ads near X" heading. */
  label: string;
};

export function resolveBrandPackLocation(address: string | null | undefined): BrandPackLocation | null {
  if (typeof address !== "string") return null;
  const cleaned = address.replace(/\s+/gu, " ").trim();
  if (cleaned.length === 0) return null;

  const statePattern = AU_STATES.join("|");

  // "…, Scarborough WA 6019" / "Scarborough, WA, 6019"
  const full = new RegExp(`([A-Za-z][A-Za-z'\\- ]{1,40}?)[,\\s]+(${statePattern})[,\\s]*([0-9]{4})\\b`, "iu").exec(
    cleaned,
  );
  if (full) {
    const suburb = titleCase(full[1]);
    const state = full[2].toUpperCase();
    const postcode = full[3];
    return { searchTerm: postcode, label: `${suburb}, ${state} ${postcode}` };
  }

  // Suburb + state, no postcode.
  const noPostcode = new RegExp(`([A-Za-z][A-Za-z'\\- ]{1,40}?)[,\\s]+(${statePattern})\\b`, "iu").exec(cleaned);
  if (noPostcode) {
    const suburb = titleCase(noPostcode[1]);
    const state = noPostcode[2].toUpperCase();
    return { searchTerm: suburb, label: `${suburb}, ${state}` };
  }

  // Bare four-digit postcode. Street numbers come first, postcodes last, so the
  // last match is the safest pick.
  const postcodes = cleaned.match(/\b[0-9]{4}\b/gu);
  if (postcodes && postcodes.length > 0) {
    const postcode = postcodes[postcodes.length - 1];
    return { searchTerm: postcode, label: postcode };
  }

  return null;
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
