"use client";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioGoal, AdStudioOfferTemplate, FirstAdInput } from "@/lib/adstudio";
import { mergeDraftResponsePack } from "@/lib/adstudio/client-pack";
import { syncCreativeWithCopyAndImage } from "@/lib/adstudio/creative-design-json.ts";

import type { AngleCard } from "./angles";
import { renderCreativeExports } from "./canvas/browser-creative-renderer";
import type { CopyState } from "./use-copy";
import { seedCopy, toMetaCta } from "./use-copy";
import type { StudioSection } from "./use-ad-studio";

const EXPORT_RENDER_TIMEOUT_MS = 45_000;

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
  primaryImage: string;
  offerLabel: string;
  campaignGoal: string;
  destinationUrl: string;
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

  function buildCurrentPack(options: {
    pack?: AdStudioCampaignPack;
    variantId?: string;
    copy?: CopyState;
    offerLabel?: string;
    primaryImage?: string;
  } = {}): AdStudioCampaignPack {
    const sourcePack = options.pack ?? s.pack;
    const variantId = options.variantId ?? currentVariant?.variantId;
    const copy = options.copy ?? s.copy;
    const offerLabel = options.offerLabel ?? s.offerLabel;
    const primaryImage = options.primaryImage ?? s.primaryImage;
    if (!variantId) return sourcePack;
    const market = parseMarket();
    const destinationUrl = normaliseDestinationUrl(s.destinationUrl);

    return {
      ...sourcePack,
      campaign: {
        ...sourcePack.campaign,
        goal: goalFromLabel(s.campaignGoal, sourcePack.campaign.goal),
        market: {
          ...sourcePack.campaign.market,
          suburb: market.suburb,
          city: market.city,
          state: market.state,
        },
        offerId: offerIdFromLabel(offerLabel, s.offers, sourcePack.campaign.offerId),
      },
      variants: sourcePack.variants.map((v) =>
        v.variantId === variantId ? { ...v, headline: copy.headline, offer: offerLabel, cta: copy.cta } : v,
      ),
      copyPacks: sourcePack.copyPacks.map((cp) => {
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
      creatives: sourcePack.creatives.map((creative) =>
        creative.variantId === variantId ? syncCreativeWithCopyAndImage(creative, copy, primaryImage) : creative,
      ),
    };
  }

  async function generateVariantsForAngle(angle: AngleCard, goalOverride?: string) {
    const preservedImage = s.primaryImage;
    s.setSelectedAngleId(angle.id);
    s.setBusy(true);
    s.setBusyMessage(`Generating ${angle.name} ad options`);
    s.setOfferLabel(angle.name === "Free Appraisal" ? "Free appraisal" : angle.name);

    try {
      const m = parseMarket();
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>("/api/adstudio/campaigns", {
        goal: goalOverride ?? angle.goal,
        campaignGoal: s.campaignGoal,
        suburb: m.suburb,
        city: m.city,
        state: m.state,
        offerId: s.offers.some((o) => o.offerId === angle.offerId) ? angle.offerId : s.offers[0]?.offerId,
        platforms: ["meta"],
        variantCount: 3,
        sourceImageDataUrl: preservedImage,
      });

      s.setPack(payload.campaignPack);
      s.setSelectedVariantIndex(0);
      s.setCopy(seedCopy(payload.campaignPack));
      s.setPrimaryImage(preservedImage);
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

  async function saveDraft(options: {
    silent?: boolean;
    packOverride?: AdStudioCampaignPack;
    variantIdOverride?: string;
    copyOverride?: CopyState;
    primaryImageOverride?: string;
    offerLabelOverride?: string;
  } = {}) {
    s.setSaveState("saving");
    s.setSaveError("");

    try {
      const currentPack = buildCurrentPack({
        pack: options.packOverride,
        variantId: options.variantIdOverride,
        copy: options.copyOverride,
        primaryImage: options.primaryImageOverride,
        offerLabel: options.offerLabelOverride,
      });
      const draftPack = compactPackForDraft(currentPack, options.variantIdOverride ?? currentVariant?.variantId);
      const payload = await postJson<{ campaignPack: AdStudioCampaignPack }>(
        `/api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft`,
        { campaignPack: draftPack },
        "PATCH",
      );
      s.setPack(mergeDraftResponsePack(currentPack, payload.campaignPack));
      s.setSaveState("saved");
      if (!options.silent) s.showToast("Draft saved");
      return true;
    } catch (error) {
      const message = getMessage(error);
      s.setSaveError(message);
      s.setSaveState("error");
      s.showToast(message);
      return false;
    }
  }

  async function exportCreatives() {
    s.setBusy(true);
    s.setBusyMessage("Preparing creative export");

    try {
      const saved = await saveDraft({ silent: true });
      if (!saved) return;
      const currentPack = buildCurrentPack();
      const exportPack = packForVariant(currentPack, currentVariant?.variantId);
      const creativeRenders = await renderExportsWithFallback(exportPack);
      const response = await fetch(
        `/api/adstudio/export-packages/${currentPack.campaign.campaignId}/download`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignPack: exportPack, creativeRenders }),
        },
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Export failed." }));
        throw new Error(payload.error ?? "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slugFileName(currentPack.campaign.name || "adstudio-campaign")}-creatives.zip`;
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

async function renderExportsWithFallback(pack: AdStudioCampaignPack) {
  try {
    return await withTimeout(renderCreativeExports(pack, { storeInWorkspace: true }), EXPORT_RENDER_TIMEOUT_MS);
  } catch {
    return [];
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Creative render timed out.")), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeout));
  });
}

function goalFromLabel(label: string, fallback: AdStudioGoal): AdStudioGoal {
  const normalised = label.trim().toLowerCase();
  if (normalised.includes("market")) return "market_update_leads";
  if (normalised.includes("open")) return "open_home_followup";
  if (normalised.includes("sale") || normalised.includes("sold")) return "listing_nurture";
  if (normalised.includes("retarget")) return "listing_nurture";
  return fallback;
}

function offerIdFromLabel(label: string, offers: AdStudioOfferTemplate[], fallback: string): string {
  const normalised = label.trim().toLowerCase();
  return offers.find((offer) => offer.name.toLowerCase() === normalised || offer.defaultCta.toLowerCase() === normalised)?.offerId ?? fallback;
}

function normaliseDestinationUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function compactPackForDraft(pack: AdStudioCampaignPack, variantId: string | undefined): AdStudioCampaignPack {
  return {
    ...pack,
    creatives: pack.creatives
      .filter((creative) => !variantId || creative.variantId === variantId)
      .map(stripRenderState)
      .map(stripDuplicateDraftImage()),
  };
}

function packForVariant(pack: AdStudioCampaignPack, variantId: string | undefined): AdStudioCampaignPack {
  if (!variantId) return pack;
  return {
    ...pack,
    variants: pack.variants.filter((variant) => variant.variantId === variantId),
    copyPacks: pack.copyPacks.filter((copyPack) => copyPack.variantId === variantId),
    creatives: pack.creatives.filter((creative) => creative.variantId === variantId).map(stripRenderState),
  };
}

function stripRenderState(creative: AdStudioCampaignPack["creatives"][number]): AdStudioCampaignPack["creatives"][number] {
  return {
    ...creative,
    canvas: {
      ...creative.canvas,
      fabricJson: null,
    },
    previewSvg: "",
  };
}

function stripDuplicateDraftImage() {
  const keptByVariant = new Set<string>();
  return (creative: AdStudioCampaignPack["creatives"][number]): AdStudioCampaignPack["creatives"][number] => {
    const image = creative.canvas.objects.find((object) => object.role === "primary_image");
    const hasImage = Boolean(image?.content || image?.assetId);
    const keepImage = hasImage && !keptByVariant.has(creative.variantId);

    if (keepImage) keptByVariant.add(creative.variantId);
    if (keepImage) return creative;

    return {
      ...creative,
      canvas: {
        ...creative.canvas,
        objects: creative.canvas.objects.map((object) =>
          object.role === "primary_image" ? { ...object, content: undefined } : object,
        ),
      },
    };
  };
}

function slugFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "adstudio-campaign";
}
