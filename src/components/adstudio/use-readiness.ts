"use client";

import { useMemo } from "react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";
import type { CopyState } from "./use-copy";

export type ReadinessItem = {
  label: string;
  detail: string;
  state: "done" | "warn" | "todo";
};

export function useReadiness({
  campaignGoal,
  offerLabel,
  market,
  propertyType,
  destinationUrl,
  primaryImage,
  copy,
  pack,
}: {
  campaignGoal: string;
  offerLabel: string;
  market: string;
  propertyType: string;
  destinationUrl: string;
  primaryImage: string;
  copy: CopyState;
  pack: AdStudioCampaignPack;
}) {
  const readinessItems = useMemo<ReadinessItem[]>(() => {
    return [
      { label: "Goal & offer", detail: `${campaignGoal} / ${offerLabel}`, state: campaignGoal && offerLabel ? "done" : "todo" },
      { label: "Location", detail: market, state: market ? "done" : "todo" },
      { label: "Property type", detail: propertyType, state: propertyType ? "done" : "todo" },
      { label: "Landing page", detail: destinationUrl || "Add destination URL", state: destinationUrl ? "done" : "todo" },
      { label: "Primary media", detail: primaryImage ? "Image uploaded" : "Upload image", state: primaryImage ? "done" : "todo" },
      { label: "Ad copy", detail: copy.headline ? "Copy could be more specific" : "Add primary headline", state: copy.headline ? "warn" : "todo" },
      { label: "Call to action", detail: copy.cta ? copy.cta : "Add CTA", state: copy.cta ? "warn" : "todo" },
      {
        label: "Compliance",
        detail: pack.compliance.status === "approved" ? "Checked" : "Needs review",
        state: pack.compliance.status === "blocked" ? "todo" : "done",
      },
    ];
  }, [campaignGoal, copy.cta, copy.headline, destinationUrl, market, offerLabel, pack.compliance.status, primaryImage, propertyType]);

  const readinessScore = useMemo(() => {
    if (!destinationUrl) return 68;
    if (readinessItems.some((item) => item.state === "todo")) return 74;
    return 82;
  }, [destinationUrl, readinessItems]);

  return { readinessItems, readinessScore };
}
