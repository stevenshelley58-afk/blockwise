"use client";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioOfferTemplate, FirstAdInput } from "@/lib/adstudio";

import type { AngleCard } from "./angles";
import { MEDIA_ASSETS } from "./use-media";
import type { CopyState } from "./use-copy";
import { seedCopy, toMetaCta } from "./use-copy";
import type { StudioSection } from "./use-ad-studio";

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ad Studio request failed.";
}

async function postJson<T>(url: string, body: Record<string, unknown>, method = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
  return payload as T;
}

export type CampaignActionsState = {
  pack: AdStudioCampaignPack;
  brandKit: AdStudioBrandKit;
  offers: AdStudioOfferTemplate[];
  market: string;
  copy: CopyState;
  offerLabel: string;
  campaignGoal: string;
  selectedVariantIndex: number;
  setPack: (pack: AdStudioCampaignPack) => void;
  setSelectedVariantIndex: (index: number) => void;
  setCopy: (copy: CopyState) => void;
  setPrimaryImage: (src: string) => void;
  setOfferLabel: (label: string) => void;
  setSelectedAngleId: (id: string) => void;
  setSaveState: (state: "saved" | "saving" | "error") => void;
  setSaveError: (err: string) => void;
  setBusy: (busy: boolean) => void;
  setBusyMessage: (msg: string) => void;
  setSection: (section: StudioSection) => void;
  showToast: (msg: string) => void;
};

export function useCampaignActions(s: CampaignActionsState) {
  const currentVariant = s.pack.variants[s.selectedVariantIndex] ?? s.pack.variants[0];

  function parseMarket() {
    const [suburbPart, statePart] = s.market.split(",").map((p) => p.trim());
    return {
      suburb: suburbPart || s.pack.campaign.market.suburb || "South Perth",
      state: statePart || s.pack.campaign.market.state || "WA",
      city: s.pack.campaign.market.city || "Perth",
    };
  }

  function buildCurrentPack(): AdStudioCampaignPack {
    const variantId = currentVariant?.variantId;
    if (!variantId) return s.pack;

    return {
      ...s.pack,
      variants: s.pack.variants.map((v) =>
        v.variantId === variantId ? { ...v, headline: s.copy.headline, offer: s.offerLabel, cta: s.copy.cta } : v,
      ),
      copyPacks: s.pack.copyPacks.map((cp) => {
        if (cp.variantId !== variantId) return cp;
        return {
          ...cp,
          meta: {
            ...cp.meta,
            primaryText: [s.copy.primaryText, ...cp.meta.primaryText.slice(1)],
            headlines: [s.copy.headline, ...cp.meta.headlines.slice(1)],
            descriptions: [s.copy.description, ...cp.meta.descriptions.slice(1)],
            cta: toMetaCta(s.copy.cta),
          },
          landingPage: {
            ...cp.landingPage,
            headline: s.copy.headline,
            subheadline: s.copy.description,
            cta: s.copy.cta,
          },
        };
      }),
    };
  }

  async function generateVariantsForAngle(angle: AngleCard, goalOverride?: string) {
    s.setSelectedAngleId(angle.id);
    s.setBusy(true);
    s.setBusyMessage(`Generating ${angle.name} ad options`);
    s.setOfferLabel(angle.name === "Free Appraisal" ? "Free appraisal" : angle.name);

    try {
      const m = parseMarket();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>("/api/adstudio/campaigns", {
        brandKit: s.brandKit,
        goal: goalOverride ?? angle.goal,
        campaignGoal: s.campaignGoal,
        suburb: m.suburb,
        city: m.city,
        state: m.state,
        offerId: s.offers.some((o) => o.offerId === angle.offerId) ? angle.offerId : s.offers[0]?.offerId,
        platforms: ["meta"],
        variantCount: 3,
      });

      s.setPack(payload.campaignPack);
      s.setSelectedVariantIndex(0);
      s.setCopy(seedCopy(payload.campaignPack));
      s.setPrimaryImage(MEDIA_ASSETS[0].src);
      s.setSaveState("saved");
      s.setSection("media");
      s.showToast("Generated 3 ads");
      window.dispatchEvent(new Event("blockwise:trial-status-refresh"));
    } catch (error) {
      s.showToast(getMessage(error));
    } finally {
      s.setBusy(false);
    }
  }

  async function generateFirstAd(input: FirstAdInput) {
    s.setBusy(true);
    s.setBusyMessage("Generating your ad");

    try {
      const m = parseMarket();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>("/api/adstudio/campaigns", {
        brandKit: s.brandKit,
        firstAd: input,
        suburb: m.suburb,
        city: m.city,
        state: m.state,
        platforms: ["meta"],
        creativeFormats: input.formats,
        variantCount: 3,
      });

      s.setPack(payload.campaignPack);
      s.setSelectedVariantIndex(0);
      s.setCopy(seedCopy(payload.campaignPack));
      s.setPrimaryImage(input.imageDataUrl);
      s.setSaveState("saved");
      s.setSection("media");
      s.showToast("Generated Story, Feed, and Square");
      window.dispatchEvent(new Event("blockwise:trial-status-refresh"));
    } catch (error) {
      s.showToast(getMessage(error));
      throw error;
    } finally {
      s.setBusy(false);
    }
  }

  async function saveDraft() {
    s.setSaveState("saving");
    s.setSaveError("");

    try {
      const currentPack = buildCurrentPack();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>(
        `/api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft`,
        { campaignPack: currentPack },
        "PATCH",
      );
      s.setPack(payload.campaignPack);
      s.setSaveState("saved");
      s.showToast("Draft saved");
    } catch (error) {
      const message = getMessage(error);
      s.setSaveError(message);
      s.setSaveState("error");
      s.showToast(message);
    }
  }

  async function exportCreatives() {
    s.setBusy(true);
    s.setBusyMessage("Preparing creative export");

    try {
      const currentPack = buildCurrentPack();
      const response = await fetch(
        `/api/adstudio/export-packages/${currentPack.campaign.campaignId}/download`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignPack: currentPack }) },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Export failed." }));
        throw new Error(payload.error ?? "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "free-appraisal-campaign-creatives.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      s.showToast("Creative export downloaded");
    } catch (error) {
      s.showToast(getMessage(error));
    } finally {
      s.setBusy(false);
    }
  }

  return { generateFirstAd, generateVariantsForAngle, saveDraft, exportCreatives };
}
