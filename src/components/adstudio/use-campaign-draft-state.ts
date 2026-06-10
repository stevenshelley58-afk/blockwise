"use client";

import { useState } from "react";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioOfferTemplate } from "@/lib/adstudio";

/**
 * Owns the editable campaign-shape fields shown in the campaign panel and the
 * topbar save flow. These are string-level user inputs that map onto the
 * server-side pack on save; they don't have a setter API on the pack itself.
 *
 * Why a hook: keeps the workbench's state list short, and lets the initial
 * values be derived from the incoming pack + brand kit in one place.
 */
export function useCampaignDraftState({
  initialPack,
  brandKit,
  offers,
}: {
  initialPack: AdStudioCampaignPack;
  brandKit: AdStudioBrandKit;
  offers: AdStudioOfferTemplate[];
}) {
  const [campaignGoal, setCampaignGoal] = useState(() => initialCampaignGoal(initialPack));
  const [offerLabel, setOfferLabel] = useState(() => initialOfferLabel(initialPack, offers));
  const [market, setMarket] = useState(() => initialMarket(initialPack));
  const [propertyType, setPropertyType] = useState("Houses");
  const [destinationUrl, setDestinationUrl] = useState(() => initialDestinationUrl(initialPack, brandKit));

  return {
    campaignGoal,
    setCampaignGoal,
    offerLabel,
    setOfferLabel,
    market,
    setMarket,
    propertyType,
    setPropertyType,
    destinationUrl,
    setDestinationUrl,
  };
}

const GOAL_LABELS: Record<string, string> = {
  seller_leads: "Generate vendor leads",
  appraisal_bookings: "Get appraisal leads",
  buyer_leads: "Buyer demand check",
  market_update_leads: "Drive market report downloads",
  downsizer_leads: "Generate vendor leads",
  investor_leads: "Generate vendor leads",
  open_home_followup: "Promote open home",
  listing_nurture: "Promote recent sale",
};

function initialCampaignGoal(pack: AdStudioCampaignPack): string {
  return GOAL_LABELS[pack.campaign.goal] ?? "Get appraisal leads";
}

function initialOfferLabel(pack: AdStudioCampaignPack, offers: AdStudioOfferTemplate[]): string {
  const variant = pack.variants[0];
  if (variant?.offer) return variant.offer;
  return offers.find((offer) => offer.offerId === pack.campaign.offerId)?.name ?? "Free appraisal";
}

function initialMarket(pack: AdStudioCampaignPack): string {
  const suburb = pack.campaign.market.suburb || "";
  const state = pack.campaign.market.state || "";
  return [suburb, state].filter(Boolean).join(", ") || "Perth, WA";
}

function initialDestinationUrl(pack: AdStudioCampaignPack, brandKit: AdStudioBrandKit): string {
  const copyPack = pack.copyPacks[0];
  return (
    copyPack?.googleSearch.finalUrl ||
    copyPack?.googlePmax.finalUrl ||
    copyPack?.googleDemandGen.finalUrl ||
    brandKit.source.url ||
    ""
  );
}
