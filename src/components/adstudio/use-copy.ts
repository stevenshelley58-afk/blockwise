"use client";

import { useState } from "react";

import type { AdStudioCampaignPack, AdStudioPlatformCopyPack, MetaLeadAdPack } from "@/lib/adstudio";

export type CopyState = {
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
};

export type CopyMode = "ai" | "brief" | "own";

export type CopyAlternates = {
  headline: string[];
  primaryText: string[];
};

export type CopyContext = {
  goal: string;
  offer: string;
  market: string;
  propertyType: string;
  businessName?: string;
  /** Brand kit voice & guardrails — included verbatim in the AI prompt. */
  voice?: string;
  preferredPhrases?: string[];
  neverSay?: string[];
};

export const COPY_LIMITS: Record<keyof CopyState, number> = {
  primaryText: 125,
  headline: 40,
  description: 90,
  cta: 24,
};

const EMPTY_ALTERNATES: CopyAlternates = { headline: [], primaryText: [] };

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
    headline: meta?.headlines?.[0] ?? variant?.headline ?? "What's your home worth right now?",
    description: meta?.descriptions?.[0] ?? "Free appraisal. No commitment.",
    cta: labelForCta(meta?.cta ?? variant?.cta),
  };
}

// Offline fallback when the AI endpoint is unavailable — market-aware, no hardcoded suburbs.
function localAssist(action: string, copy: CopyState, market: string): Partial<CopyState> {
  const place = market.split(",")[0]?.trim() || "your area";
  if (action === "More local") {
    const prefix = `${place} homeowners: `;
    return { primaryText: `${prefix}${copy.primaryText.replace(new RegExp(`^${place} homeowners:\\s*`, "i"), "")}`.slice(0, COPY_LIMITS.primaryText) };
  }
  if (action === "More direct") {
    return { headline: `What's your home worth in ${place}?`.slice(0, COPY_LIMITS.headline) };
  }
  if (action === "Less hype") {
    return { description: "Free appraisal. No pressure, no commitment." };
  }
  if (action === "Sharper") {
    const firstSentence = copy.primaryText.split(".")[0] ?? copy.primaryText;
    return { primaryText: `${firstSentence.slice(0, 80).trimEnd()}. Find out today.`.slice(0, COPY_LIMITS.primaryText) };
  }
  if (action === "More premium") {
    const prefix = "For owners of distinctive homes: ";
    return { primaryText: `${prefix}${copy.primaryText.replace(/^For owners of distinctive homes:\s*/i, "")}`.slice(0, COPY_LIMITS.primaryText) };
  }
  if (action === "5 hook ideas") {
    const base = copy.headline.replace(/\?*$/, "").trim();
    return {
      primaryText: [
        `1. ${base} — find out today.`,
        `2. What would you do with the equity in your home?`,
        `3. Thinking of selling in ${place}? Know where you stand.`,
        `4. ${base} — no pressure, just clarity.`,
        `5. Ready for your next move? Start with a free appraisal.`,
      ].join("\n").slice(0, COPY_LIMITS.primaryText),
    };
  }
  return {};
}

type CopyEndpointResponse = {
  copy?: Partial<CopyState>;
  alternates?: Partial<CopyAlternates>;
  error?: string;
};

export function useCopy(
  initialPack: AdStudioCampaignPack,
  setSaveState: (state: "saved" | "saving" | "error") => void,
  showToast: (message: string) => void,
  setSelectedElement?: (key: keyof CopyState) => void,
) {
  const [copy, setCopy] = useState<CopyState>(() => seedCopy(initialPack));
  const [copyMode, setCopyMode] = useState<CopyMode>("ai");
  const [brief, setBrief] = useState("");
  const [generating, setGenerating] = useState(false);
  const [alternates, setAlternates] = useState<CopyAlternates>(EMPTY_ALTERNATES);

  function updateCopy(key: keyof CopyState, value: string) {
    setCopy((current) => ({ ...current, [key]: value }));
    setSelectedElement?.(key);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 650);
  }

  function applyCopySet(next: Partial<CopyState>, nextAlternates?: Partial<CopyAlternates>) {
    setCopy((current) => ({ ...current, ...next }));
    if (nextAlternates) {
      setAlternates({
        headline: nextAlternates.headline ?? [],
        primaryText: nextAlternates.primaryText ?? [],
      });
    }
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 650);
  }

  async function requestCopy(payload: Record<string, unknown>): Promise<CopyEndpointResponse> {
    const response = await fetch("/api/adstudio/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as CopyEndpointResponse;
    if (!response.ok) {
      throw new Error(json.error || "AI copy request failed.");
    }
    return json;
  }

  /** AI writes the full copy set — from campaign context ("ai") or the user's brief ("brief"). */
  async function generateCopy(kind: "ai" | "brief", context: CopyContext) {
    if (generating) return;
    if (kind === "brief" && !brief.trim()) {
      showToast("Add a brief before generating copy");
      return;
    }
    setGenerating(true);
    try {
      const result = await requestCopy({
        mode: kind === "brief" ? "brief" : "generate",
        brief: kind === "brief" ? brief.trim() : undefined,
        copy,
        context,
      });
      applyCopySet(result.copy ?? {}, result.alternates);
      showToast(kind === "brief" ? "Copy written from your brief" : "Copy written for you");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not generate copy");
    } finally {
      setGenerating(false);
    }
  }

  /** One-tap adjustments. Tries AI first; falls back to local transforms offline. */
  async function applyCopyAssist(action: string, context: CopyContext) {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await requestCopy({ mode: "assist", assistAction: action, copy, context });
      applyCopySet(result.copy ?? {});
      showToast(action);
    } catch {
      const fallback = localAssist(action, copy, context.market);
      if (Object.keys(fallback).length > 0) {
        applyCopySet(fallback);
        showToast(`${action} (offline)`);
      } else {
        showToast("Could not adjust copy");
      }
    } finally {
      setGenerating(false);
    }
  }

  function applyAlternate(field: "headline" | "primaryText", value: string) {
    updateCopy(field, value);
    showToast("Alternate applied");
  }

  return {
    copy,
    setCopy,
    updateCopy,
    copyMode,
    setCopyMode,
    brief,
    setBrief,
    generating,
    alternates,
    generateCopy,
    applyCopyAssist,
    applyAlternate,
  };
}
