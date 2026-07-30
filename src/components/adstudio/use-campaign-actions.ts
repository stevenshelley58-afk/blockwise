"use client";

import { useRef, useState } from "react";

import type { AdStudioBrandKit, AdStudioCampaignPack, AdStudioFormat, AdStudioGoal, AdStudioOfferTemplate, FirstAdInput } from "@/lib/adstudio";
import { mergeDraftResponsePack } from "@/lib/adstudio/client-pack";
import { isFinishedCloneCreative } from "@/lib/adstudio/clone-creative";
import { findCopyLimitViolations } from "@/lib/adstudio/readiness";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { offerIdForLabel } from "./template-offer-state";
import type { CopyState } from "./use-copy";
import { seedCopy, toMetaCta } from "./use-copy";
import type { StudioSection } from "./use-ad-studio";

/** Staged generation progress shown as skeleton variant cards + honest phase labels. */
export type GenerationProgress = {
  phase: string;
  count: number;
  error: string | null;
};

// Async template generation stages mirror the server-side pipeline order.
// Realtime wakes the client when state changes; a slow fallback check keeps the
// flow resilient if a websocket is unavailable.
const TEMPLATE_JOB_FALLBACK_INTERVAL_MS = 30_000;
const TEMPLATE_JOB_TIMEOUT_MS = 10 * 60_000;
const TEMPLATE_JOB_PHASES: Array<{ label: string; atMs: number }> = [
  { label: "Writing copy...", atMs: 0 },
  { label: "Designing your ad...", atMs: 15_000 },
  { label: "Saving your ad...", atMs: 60_000 },
];

type CampaignJobStatus = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  campaign_id: string | null;
  campaignPack?: AdStudioCampaignPack | null;
};

/** Per-format export progress so one slow/failed format never blocks the rest. */
export type ExportFormatStatus = {
  format: AdStudioFormat;
  label: string;
  state: "rendering" | "done" | "failed";
};

type GenerateCampaignResponse = {
  campaignPack: AdStudioCampaignPack;
};

// Mirrors META_EXPORT_FORMATS in the browser export module; formats outside
// this set are skipped, so they get no progress row.
const EXPORT_FORMAT_LABELS: Partial<Record<AdStudioFormat, string>> = {
  "9:16": "Story",
  "4:5": "Feed",
};

function exportFormatLabel(format: AdStudioFormat): string {
  return EXPORT_FORMAT_LABELS[format] ?? format;
}

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
  setSaveState: (state: "saved" | "saving" | "error") => void;
  setSaveError: (err: string) => void;
  setBusy: (busy: boolean) => void;
  setBusyMessage: (msg: string) => void;
  setGeneration: (progress: GenerationProgress | null) => void;
  setSection: (section: StudioSection) => void;
  showToast: (msg: string) => void;
};

export function useCampaignActions(s: CampaignActionsState) {
  const currentVariant = s.pack.variants[s.selectedVariantIndex] ?? s.pack.variants[0];
  // In-flight guards: a double-click (or re-entrant call) must never fire a
  // second upstream generation/export while the first is still running.
  const generateInFlightRef = useRef(false);
  const exportInFlightRef = useRef(false);
  // Per-format export progress; null when no export is showing status.
  const [exportStatus, setExportStatus] = useState<ExportFormatStatus[] | null>(null);

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
        offerId: offerIdForLabel({
          label: offerLabel,
          offers: s.offers,
          fallback: sourcePack.campaign.offerId,
          pack: sourcePack,
        }),
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
      creatives: sourcePack.creatives,
    };
  }

  async function generateFirstAd(input: FirstAdInput): Promise<void> {
    if (generateInFlightRef.current) {
      throw new Error("A generation is already running - wait for it to finish.");
    }
    generateInFlightRef.current = true;
    const expectedCount = 1;
    s.setGeneration({ phase: "Cloning your sample...", count: expectedCount, error: null });

    try {
      const m = parseMarket();
      const response = await fetch("/api/adstudio/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstAd: input,
          suburb: m.suburb,
          city: m.city,
          state: m.state,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<GenerateCampaignResponse> & { jobId?: string; error?: string })
        | null;
      if (!response.ok) throw new Error(payload?.error ?? `Request failed with ${response.status}.`);

      let campaignPack: AdStudioCampaignPack;
      if (response.status === 202 && payload?.jobId) {
        // Async generation: the server runs copy → clone → persist in a
        // background job (the advisory QA pass attaches afterwards).
        campaignPack = await waitForTemplateCampaignJob(String(payload.jobId), (phase) =>
          s.setGeneration({ phase, count: expectedCount, error: null }),
        );
      } else {
        if (!payload?.campaignPack) throw new Error("Ad generation returned an unexpected result.");
        campaignPack = payload.campaignPack;
      }

      s.setGeneration(null);
      s.setPack(campaignPack);
      s.setSelectedVariantIndex(0);
      s.setCopy(seedCopy(campaignPack));
      s.setPrimaryImage(input.templateCloneImage ?? packPrimaryImage(campaignPack) ?? input.imageDataUrl);
      s.setSaveState("saved");
      s.setSection("edit");
      s.showToast("Your ad is ready to edit");
      window.dispatchEvent(new Event("blockwise:trial-status-refresh"));
    } catch (error) {
      // The New Ad dialog shows this error inline, so clear the skeletons.
      s.setGeneration(null);
      s.showToast(getMessage(error));
      throw error;
    } finally {
      generateInFlightRef.current = false;
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
      if (currentPack.creatives.length === 0 || !currentPack.creatives.every(isFinishedCloneCreative)) {
        s.setSaveState("saved");
        return true;
      }
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
    if (exportInFlightRef.current) return;
    const violations = findCopyLimitViolations(s.copy);
    if (violations.length > 0) {
      s.showToast(`Fix the ad copy before exporting: ${violations.join(" ")}`);
      return;
    }
    exportInFlightRef.current = true;
    s.setBusy(true);
    s.setBusyMessage("Preparing creative export");

    try {
      const saved = await saveDraft({ silent: true });
      if (!saved) return;
      const currentPack = buildCurrentPack();
      const exportPack = packForVariant(currentPack, currentVariant?.variantId);
      const formats = exportableFormats(exportPack);
      if (formats.length === 0) throw new Error("Export failed — please retry.");

      if (!exportPack.creatives.every(isFinishedCloneCreative)) {
        throw new Error("Create an ad from a sample before exporting.");
      }
      await downloadExportZip(currentPack.campaign.campaignId, currentPack.campaign.name, exportPack);
      setExportStatus(null);
      s.showToast("Creative export downloaded");
    } catch (error) {
      s.showToast(getMessage(error));
    } finally {
      s.setBusy(false);
      exportInFlightRef.current = false;
    }
  }

  /** Re-renders and downloads a single failed format without redoing the others. */
  async function retryExportFormat(format: AdStudioFormat) {
    if (exportInFlightRef.current) return;
    exportInFlightRef.current = true;
    setExportStatus((current) =>
      current?.map((entry) => (entry.format === format ? { ...entry, state: "rendering" as const } : entry)) ?? null,
    );

    try {
      const currentPack = buildCurrentPack();
      const exportPack = packForVariant(currentPack, currentVariant?.variantId);
      const formatPack = { ...exportPack, creatives: exportPack.creatives.filter((creative) => creative.format === format) };
      if (formatPack.creatives.length === 0 || !formatPack.creatives.every(isFinishedCloneCreative)) {
        throw new Error(`${exportFormatLabel(format)} render failed — please retry.`);
      }
      await downloadExportZip(
        currentPack.campaign.campaignId,
        currentPack.campaign.name,
        formatPack,
        exportFormatLabel(format),
      );
      setExportStatus((current) => {
        const next =
          current?.map((entry) => (entry.format === format ? { ...entry, state: "done" as const } : entry)) ?? null;
        return next && next.every((entry) => entry.state === "done") ? null : next;
      });
      s.showToast(`${exportFormatLabel(format)} export downloaded`);
    } catch (error) {
      setExportStatus((current) =>
        current?.map((entry) => (entry.format === format ? { ...entry, state: "failed" as const } : entry)) ?? null,
      );
      s.showToast(getMessage(error));
    } finally {
      exportInFlightRef.current = false;
    }
  }

  // Unload-safe flush: sendBeacon survives page teardown where fetch may not.
  function flushDraftBeacon(): boolean {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
    try {
      const currentPack = buildCurrentPack({});
      if (currentPack.creatives.length === 0 || !currentPack.creatives.every(isFinishedCloneCreative)) return false;
      const draftPack = compactPackForDraft(currentPack, currentVariant?.variantId);
      const body = new Blob([JSON.stringify({ campaignPack: draftPack })], { type: "application/json" });
      return navigator.sendBeacon(`/api/adstudio/campaigns/${currentPack.campaign.campaignId}/draft`, body);
    } catch {
      return false;
    }
  }

  return { generateFirstAd, saveDraft, flushDraftBeacon, exportCreatives, retryExportFormat, exportStatus };
}

/**
 * Wait for the async generation job over Realtime, rotating honest phase
 * labels locally. A 30-second status check is only a resilience fallback.
 */
async function waitForTemplateCampaignJob(
  jobId: string,
  onPhase: (phase: string) => void,
): Promise<AdStudioCampaignPack> {
  const supabase = createSupabaseBrowserClient();
  onPhase(TEMPLATE_JOB_PHASES[0].label);

  return new Promise<AdStudioCampaignPack>((resolve, reject) => {
    let settled = false;
    let checking = false;
    let checkQueued = false;
    const phaseTimers = TEMPLATE_JOB_PHASES.slice(1).map((phase) =>
      window.setTimeout(() => onPhase(phase.label), phase.atMs),
    );

    const cleanup = () => {
      phaseTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(fallbackTimer);
      window.clearTimeout(timeoutTimer);
      void supabase.removeChannel(channel);
    };
    const finish = (result: { pack?: AdStudioCampaignPack; error?: Error }) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result.error) reject(result.error);
      else if (result.pack) resolve(result.pack);
    };
    const checkStatus = async () => {
      if (settled) return;
      if (checking) {
        checkQueued = true;
        return;
      }
      checking = true;
      try {
        const response = await fetch(`/api/adstudio/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { job?: CampaignJobStatus; error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error ?? "Could not check the ad generation job.");
        const job = payload?.job;
        if (!job) throw new Error("The ad generation job was not found.");
        if (job.status === "failed") {
          finish({ error: new Error(job.error || "Ad generation failed. Please try again.") });
        } else if (job.status === "done") {
          if (!job.campaignPack) {
            finish({ error: new Error("The generated ad could not be loaded. Reload Ad Studio to see it.") });
          } else {
            finish({ pack: job.campaignPack });
          }
        }
      } catch (error) {
        // Realtime or the fallback can retry transient transport failures.
        if (error instanceof Error && /not found/i.test(error.message)) finish({ error });
      } finally {
        checking = false;
        if (checkQueued && !settled) {
          checkQueued = false;
          void checkStatus();
        }
      }
    };

    const channel = supabase
      .channel(`adstudio-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "adstudio_creative_jobs", filter: `id=eq.${jobId}` },
        () => void checkStatus(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void checkStatus();
      });
    const fallbackTimer = window.setInterval(() => void checkStatus(), TEMPLATE_JOB_FALLBACK_INTERVAL_MS);
    const timeoutTimer = window.setTimeout(
      () =>
        finish({
          error: new Error(
            "Ad generation is taking longer than expected. Reload Ad Studio in a minute to see the result.",
          ),
        }),
      TEMPLATE_JOB_TIMEOUT_MS,
    );

    // Close the race between the 202 response and the subscription becoming live.
    void checkStatus();
  });
}

/** First persisted primary image in the pack (the clone render for template ads). */
function packPrimaryImage(pack: AdStudioCampaignPack): string | undefined {
  for (const creative of pack.creatives) {
    const image = creative.canvas.objects.find((object) => object.role === "primary_image");
    if (image?.content) return image.content;
  }
  return undefined;
}

// Formats the browser renderer can actually export (see META_EXPORT_FORMATS).
function exportableFormats(pack: AdStudioCampaignPack): AdStudioFormat[] {
  const formats = pack.creatives
    .map((creative) => creative.format)
    .filter((format) => EXPORT_FORMAT_LABELS[format] !== undefined);
  return Array.from(new Set(formats));
}

async function downloadExportZip(
  campaignId: string,
  campaignName: string,
  exportPack: AdStudioCampaignPack,
  fileSuffix?: string,
) {
  const response = await fetch(`/api/adstudio/export-packages/${campaignId}/download`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignPack: exportPack, creativeRenders: [] }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Export failed." }));
    throw new Error(payload.error ?? "Export failed.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugFileName([campaignName || "adstudio-campaign", fileSuffix].filter(Boolean).join(" "))}-creatives.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function goalFromLabel(label: string, fallback: AdStudioGoal): AdStudioGoal {
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
    creatives: pack.creatives.filter((creative) => creative.variantId === variantId),
  };
}

function stripRenderState(creative: AdStudioCampaignPack["creatives"][number]): AdStudioCampaignPack["creatives"][number] {
  return {
    ...creative,
    canvas: {
      ...creative.canvas,
    },
    previewSvg: "",
  };
}

function stripDuplicateDraftImage() {
  const keptByVariantAndSource = new Set<string>();
  return (creative: AdStudioCampaignPack["creatives"][number]): AdStudioCampaignPack["creatives"][number] => {
    // A cloned ad is one authoritative raster, not a browser-rendered layer
    // tree. Its storage pointer must survive every autosave and reload.
    if (
      creative.canvas.objects.length === 1
      && creative.canvas.objects[0]?.objectId === "template_clone_image"
    ) {
      return creative;
    }

    const image = creative.canvas.objects.find((object) => object.role === "primary_image");
    const imageSource = image?.content || image?.assetId || "";
    const imageKey = imageSource ? `${creative.variantId}:${imageSource}` : "";
    const keepImage = Boolean(imageKey) && !keptByVariantAndSource.has(imageKey);

    if (keepImage) keptByVariantAndSource.add(imageKey);
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
