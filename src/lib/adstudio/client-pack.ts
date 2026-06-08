import type { AdStudioCampaignPack } from "./types.ts";

export function mergeDraftResponsePack(
  current: AdStudioCampaignPack,
  response: AdStudioCampaignPack,
): AdStudioCampaignPack {
  return {
    ...response,
    variants: mergeById(current.variants, response.variants, (variant) => variant.variantId),
    creatives: mergeById(current.creatives, response.creatives, (creative) => creative.creativeId),
    copyPacks: mergeById(current.copyPacks, response.copyPacks, (copyPack) => copyPack.copyPackId),
  };
}

function mergeById<T>(current: T[], response: T[], getId: (item: T) => string): T[] {
  if (response.length >= current.length) return response;

  const responseById = new Map(response.map((item) => [getId(item), item]));
  const merged = current.map((item) => responseById.get(getId(item)) ?? item);
  const currentIds = new Set(current.map(getId));
  return [...merged, ...response.filter((item) => !currentIds.has(getId(item)))];
}
