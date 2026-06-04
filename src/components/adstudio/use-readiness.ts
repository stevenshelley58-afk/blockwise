"use client";

import { useMemo } from "react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";
import { COPY_LIMITS } from "./use-copy";
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
      {
        label: "Ad copy",
        detail: copy.headline
          ? copy.headline.length > COPY_LIMITS.headline
            ? "Headline is over the character limit"
            : "Headline looks good"
          : "Add primary headline",
        state: copy.headline
          ? copy.headline.length <= COPY_LIMITS.headline
            ? "done"
            : "warn"
          : "todo",
      },
      {
        label: "Call to action",
        detail: copy.cta ? copy.cta : "Add CTA",
        state: (["SIGN_UP", "DOWNLOAD", "CONTACT_US", "LEARN_MORE"] as string[]).includes(copy.cta) ? "done" : copy.cta ? "warn" : "todo",
      },
      {
        label: "Compliance",
        detail: pack.compliance.status === "approved" ? "Checked" : "Needs review",
        state: pack.compliance.status === "blocked" ? "todo" : "done",
      },
    ];
  }, [campaignGoal, copy.cta, copy.headline, destinationUrl, market, offerLabel, pack.compliance.status, primaryImage, propertyType]);

  const readinessScore = useMemo(() => {
    const sum = readinessItems.reduce((acc, item) => {
      if (item.state === "done") return acc + 1;
      if (item.state === "warn") return acc + 0.5;
      return acc;
    }, 0);
    return Math.round((sum / readinessItems.length) * 100);
  }, [readinessItems]);

  return { readinessItems, readinessScore };
}
