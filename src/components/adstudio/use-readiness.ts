"use client";

import { useMemo } from "react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";
import { buildReadinessItems, type ReadinessItem } from "@/lib/adstudio/readiness";
import type { CopyState } from "./use-copy";

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
    return buildReadinessItems({
      campaignGoal,
      offerLabel,
      market,
      propertyType,
      destinationUrl,
      primaryImage,
      copy,
      pack,
    });
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
