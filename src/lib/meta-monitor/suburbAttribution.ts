/**
 * Meta does not report clean suburb-level performance. Suburb is resolved in
 * priority order: lead record → ad-set mapping → naming convention.
 * Convention: ad set "Suburb - Carlingford", campaign "Suburb Appraisal - Carlingford".
 */

const SUBURB_NAME_PATTERN = /(?:suburb(?:\s+appraisal)?\s*[-–—:]\s*)(.+)$/i;

export function parseSuburbFromAdsetName(adsetName: string | null | undefined): string | null {
  return parseSuburbFromName(adsetName);
}

export function parseSuburbFromCampaignName(campaignName: string | null | undefined): string | null {
  return parseSuburbFromName(campaignName);
}

function parseSuburbFromName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }

  const match = name.match(SUBURB_NAME_PATTERN);
  const suburb = match?.[1]?.trim();

  return suburb && suburb.length > 1 ? suburb : null;
}

export function resolveSuburb(input: {
  leadSuburb?: string | null;
  postcodeMappedSuburb?: string | null;
  blockwiseSuburbMapping?: string | null;
  adsetName?: string | null;
  campaignName?: string | null;
}): string | null {
  const resolved =
    normalize(input.leadSuburb) ??
    normalize(input.postcodeMappedSuburb) ??
    normalize(input.blockwiseSuburbMapping) ??
    parseSuburbFromAdsetName(input.adsetName) ??
    parseSuburbFromCampaignName(input.campaignName);

  if (!resolved && process.env.NODE_ENV !== "production") {
    console.warn(
      `Meta ad has no suburb mapping (ad set: ${input.adsetName ?? "unknown"}). ` +
        "Add an ad_set_suburb_map entry or enforce the 'Suburb - <name>' naming convention.",
    );
  }

  return resolved;
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 1 && trimmed.toLowerCase() !== "unknown" ? trimmed : null;
}
