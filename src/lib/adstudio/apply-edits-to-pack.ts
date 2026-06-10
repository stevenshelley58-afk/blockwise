import type {
  AdStudioCampaignPack,
  AdStudioFormat,
  AdStudioGoal,
  AdStudioOfferTemplate,
} from "./types.ts";
import { syncCreativeWithCopyAndImage } from "./creative-design-json.ts";
import { toMetaCta } from "./readiness.ts";
import type { CopyState } from "../../components/adstudio/use-copy.ts";

export type DraftEdits = {
  /** Optional override for the pack to edit — defaults to the current pack. */
  pack?: AdStudioCampaignPack;
  /** Which variant the edits apply to. Required. */
  variantId: string | undefined;
  /** New copy for the variant. */
  copy: CopyState;
  /** New offer label for the variant. */
  offerLabel: string;
  /** New primary image src for the variant's creatives. */
  primaryImage: string;
  /** Human-readable campaign goal (e.g. "Get appraisal leads"). */
  campaignGoal: string;
  /** Free-text market like "Scarborough, WA". */
  market: string;
  /** Known offers for resolving labels → offerIds. */
  offers: AdStudioOfferTemplate[];
  /** Landing page URL — applied to all Google copy-pack final URLs. */
  destinationUrl: string;
};

export type ParsedMarket = {
  suburb: string;
  state: string;
  city: string;
};

/**
 * Single source of truth for "apply user edits to a campaign pack". Used by:
 * - `commitVariantEdits` in the workbench (variant switch)
 * - `buildCurrentPack` in `useCampaignActions` (auto-save, generate, export)
 *
 * Why one function: the previous two implementations could drift apart, and
 * they had to stay byte-identical for the API round-trip to work. Now there's
 * only one place to change pack shape.
 */
export function applyEditsToPack(input: DraftEdits): AdStudioCampaignPack {
  const source = input.pack;
  if (!source) return source as unknown as AdStudioCampaignPack;
  if (!input.variantId) return source;

  const market = parseMarket(input.market, source);
  const destinationUrl = normaliseDestinationUrl(input.destinationUrl);
  const variantId = input.variantId;
  const { copy, offerLabel, primaryImage } = input;

  return {
    ...source,
    campaign: {
      ...source.campaign,
      goal: goalFromLabel(input.campaignGoal, source.campaign.goal),
      market: {
        ...source.campaign.market,
        suburb: market.suburb,
        city: market.city,
        state: market.state,
      },
      offerId: offerIdFromLabel(offerLabel, input.offers, source.campaign.offerId),
    },
    variants: source.variants.map((variant) =>
      variant.variantId === variantId
        ? { ...variant, headline: copy.headline, offer: offerLabel, cta: copy.cta }
        : variant,
    ),
    copyPacks: source.copyPacks.map((cp) => {
      if (cp.variantId !== variantId) return cp;
      return {
        ...cp,
        meta: {
          ...cp.meta,
          primaryText: [copy.primaryText, ...cp.meta.primaryText.slice(1)],
          headlines: [copy.headline, ...cp.meta.headlines.slice(1)],
          descriptions: [copy.description, ...cp.meta.descriptions.slice(1)],
          cta: toMetaCta(copy.cta),
        },
        landingPage: {
          ...cp.landingPage,
          headline: copy.headline,
          subheadline: copy.description,
          cta: copy.cta,
        },
        googleSearch: destinationUrl ? { ...cp.googleSearch, finalUrl: destinationUrl } : cp.googleSearch,
        googlePmax: destinationUrl ? { ...cp.googlePmax, finalUrl: destinationUrl } : cp.googlePmax,
        googleDemandGen: destinationUrl ? { ...cp.googleDemandGen, finalUrl: destinationUrl } : cp.googleDemandGen,
      };
    }),
    creatives: source.creatives.map((creative) =>
      creative.variantId === variantId
        ? syncCreativeWithCopyAndImage(creative, copy, primaryImage)
        : creative,
    ),
  };
}

export function parseMarket(market: string, fallback: AdStudioCampaignPack): ParsedMarket {
  const [suburbPart, statePart] = market.split(",").map((p) => p.trim());
  return {
    suburb: suburbPart || fallback.campaign.market.suburb || "South Perth",
    state: statePart || fallback.campaign.market.state || "WA",
    city: fallback.campaign.market.city || "Perth",
  };
}

export function normaliseDestinationUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function goalFromLabel(label: string, fallback: AdStudioGoal): AdStudioGoal {
  const normalised = label.trim().toLowerCase();
  if (normalised.includes("appraisal") || normalised.includes("value")) return "appraisal_bookings";
  if (normalised.includes("buyer")) return "buyer_leads";
  if (normalised.includes("market")) return "market_update_leads";
  if (normalised.includes("open")) return "open_home_followup";
  if (normalised.includes("sale") || normalised.includes("sold")) return "listing_nurture";
  if (normalised.includes("retarget")) return "listing_nurture";
  if (normalised.includes("vendor") || normalised.includes("seller")) return "seller_leads";
  return fallback;
}

export function offerIdFromLabel(
  label: string,
  offers: AdStudioOfferTemplate[],
  fallback: string,
): string {
  const normalised = label.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "free appraisal": "home_value_update",
    "home value estimate": "home_value_update",
    "market update": "suburb_market_report",
    "buyer demand check": "buyer_inspection_checklist",
    "buyer inspection checklist": "buyer_inspection_checklist",
  };
  if (aliases[normalised]) return aliases[normalised];
  return (
    offers.find(
      (offer) => offer.name.toLowerCase() === normalised || offer.defaultCta.toLowerCase() === normalised,
    )?.offerId ?? fallback
  );
}

export type { AdStudioFormat };
