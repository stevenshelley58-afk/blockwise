import type { AdStudioCampaignPack, AdStudioOfferTemplate, AdStudioTemplate } from "../../lib/adstudio/index.ts";

function normaliseLabel(value: string): string {
  return value.trim().toLowerCase();
}

function templateSnapshotText(snapshot: Record<string, unknown> | null | undefined, key: string): string {
  const value = snapshot?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function labelForSelectedTemplate(template: Pick<AdStudioTemplate, "name">): string {
  return template.name;
}

export function initialOfferLabelForPack(pack: AdStudioCampaignPack, offers: AdStudioOfferTemplate[]): string {
  const variant = pack.variants[0];
  if (variant?.offer) return variant.offer;

  const templateName = templateSnapshotText(pack.campaign.templateSnapshot, "name");
  if (templateName) return templateName;

  return offers.find((offer) => offer.offerId === pack.campaign.offerId)?.name ?? "Free appraisal";
}

export function offerIdForLabel(input: {
  label: string;
  offers: AdStudioOfferTemplate[];
  fallback: string;
  pack?: AdStudioCampaignPack;
}): string {
  const normalised = normaliseLabel(input.label);

  if (isTemplateOwnedOfferLabel(input.pack, normalised)) {
    return input.fallback;
  }

  const aliases: Record<string, string> = {
    "free appraisal": "home_value_update",
    "home value estimate": "home_value_update",
    "market update": "suburb_market_report",
    "buyer demand check": "buyer_inspection_checklist",
    "buyer inspection checklist": "buyer_inspection_checklist",
  };
  if (aliases[normalised]) return aliases[normalised];

  return input.offers.find((offer) =>
    normaliseLabel(offer.name) === normalised || normaliseLabel(offer.defaultCta) === normalised
  )?.offerId ?? input.fallback;
}

function isTemplateOwnedOfferLabel(pack: AdStudioCampaignPack | undefined, normalisedLabel: string): boolean {
  if (!pack?.campaign.templateKey && !pack?.campaign.templateSnapshot) return false;

  const templateName = normaliseLabel(templateSnapshotText(pack.campaign.templateSnapshot, "name"));
  if (templateName && templateName === normalisedLabel) return true;

  return pack.variants.some((variant) => normaliseLabel(variant.offer) === normalisedLabel);
}
