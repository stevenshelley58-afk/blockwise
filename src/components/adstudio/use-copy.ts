"use client";

import { useState } from "react";

import type { AdStudioCampaignPack, AdStudioPlatformCopyPack, MetaLeadAdPack } from "@/lib/adstudio";

export type CopyState = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export const COPY_LIMITS: Record<keyof CopyState, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

export function labelForCta(cta: MetaLeadAdPack["cta"] | string | undefined): string {
  if (cta === "SIGN_UP") return "Sign up";
  if (cta === "DOWNLOAD") return "Download";
  if (cta === "CONTACT_US") return "Contact us";
  return "Learn more";
}

export function toMetaCta(label: string): MetaLeadAdPack["cta"] {
  const normalised = label.trim().toLowerCase();
  if (normalised.includes("download")) return "DOWNLOAD";
  if (normalised.includes("contact") || normalised.includes("book")) return "CONTACT_US";
  if (normalised.includes("sign")) return "SIGN_UP";
  return "LEARN_MORE";
}

function getCopyPack(pack: AdStudioCampaignPack, variantId: string): AdStudioPlatformCopyPack | undefined {
  return pack.copyPacks.find((copyPack) => copyPack.variantId === variantId) ?? pack.copyPacks[0];
}

export function seedCopy(pack: AdStudioCampaignPack, variantIndex = 0): CopyState {
  const variant = pack.variants[variantIndex] ?? pack.variants[0];
  const copyPack = variant ? getCopyPack(pack, variant.variantId) : pack.copyPacks[0];
  const meta = copyPack?.meta;

  return {
    primaryText:
      meta?.primaryText?.[0] ??
      "Thinking about selling? See what your home could be worth with local guidance and no pressure.",
    headline: meta?.headlines?.[0] ?? variant?.headline ?? "What's Your Home Worth in South Perth?",
    description: meta?.descriptions?.[0] ?? "Free appraisal. No commitment.",
    cta: labelForCta(meta?.cta ?? variant?.cta),
  };
}

export function useCopy(
  initialPack: AdStudioCampaignPack,
  setSaveState: (state: "saved" | "saving" | "error") => void,
  showToast: (message: string) => void,
  setSelectedElement?: (key: keyof CopyState) => void,
) {
  const [copy, setCopy] = useState<CopyState>(() => seedCopy(initialPack));

  function updateCopy(key: keyof CopyState, value: string) {
    setCopy((current) => ({ ...current, [key]: value }));
    setSelectedElement?.(key);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 650);
  }

  function applyCopyAssist(action: string) {
    if (action === "Make more local") {
      updateCopy("primaryText", `South Perth homeowners: ${copy.primaryText.replace(/^South Perth homeowners:\s*/i, "")}`);
    } else if (action === "Make more direct") {
      updateCopy("headline", "What's Your Home Worth in South Perth?");
    } else if (action === "Reduce hype") {
      updateCopy("description", "Free appraisal. No pressure, no commitment.");
    } else {
      updateCopy("headline", copy.headline.replace(/\?*$/, "?"));
    }
    showToast(action);
  }

  return { copy, setCopy, updateCopy, applyCopyAssist };
}
