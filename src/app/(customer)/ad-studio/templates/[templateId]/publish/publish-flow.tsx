"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { InstantFormEditor } from "@/components/adstudio/instant-form-editor";
import type { InstantForm } from "@/lib/adstudio/instant-form-types";
import type { PublishRequirements } from "@/lib/adstudio/publish-adapter";
import type { MetaParentState } from "@/lib/providers/meta-execution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  buildExplicitMetaPublishControls,
  MIN_META_RADIUS_KM,
  publishSetupFingerprint,
  type AudienceMode,
  type PlacementChoice,
  type PublishAudienceLocation,
  type PublishBudgetMode,
  type PublishFulfilmentDraft,
  type PublishSetupSummary,
  type PublishTargetMode,
  type ScheduleEndIntent,
  type ScheduleStartIntent,
} from "./publish-controls";

// ---------------------------------------------------------------------------
// Publish flow client (BW-M).
//
// Shows the frozen last-saved revision and drives POST
// /api/adstudio/ads/[id]/publish, which freezes the snapshot and creates Meta
// objects PAUSED. The receipt is either a dry-run / paused-disabled response
// (provider writes off) or a paused receipt with the created Meta object IDs.
// This surface NEVER says "live" — activation is a separate later task.
// ---------------------------------------------------------------------------

export interface PublishFlowProps {
  adId: string;
  workspaceId: string;
  templateId: string;
  templateName: string;
  publishRequirements: PublishRequirements;
  /** True when the ad has no saved revision yet. */
  notSaved: boolean;
  initialState: {
    ad: { metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string; destinationUrl: string };
    revision: { id: string; revisionNumber: number; documentHash: string; feedPngHash: string; feedPngPath: string; storyPngHash: string; storyPngPath: string; createdAt?: string };
    form: {
      name: string;
      formType: string;
      intro: { headline: string };
      contactFields: Array<{ type: string; required: boolean }>;
    } | null;
    formRevision: number | null;
  } | null;
  initialIssues: string[];
  providerWritesEnabled: boolean;
  audienceLocations: PublishAudienceLocation[];
  /** Optional last-checked Meta state for display only; publish re-verifies it server-side. */
  parentState?: MetaParentState;
  canRequestManualPublish: boolean;
  automatedPublishAvailable: boolean;
  metaConnectionConnected: boolean;
}

type PublishReceipt = {
  ok?: boolean;
  mode?: "dry_run" | "publish";
  providerWritesEnabled?: boolean;
  snapshotId?: string;
  source?: {
    snapshotId: string;
    creativeRevision: number | null;
    documentHash: string | null;
    feedPngHash: string | null;
    storyPngHash: string | null;
    formDraftId: string | null;
    formRevision: number | null;
  } | null;
  publishedCreative?: {
    feedPngPath: string | null;
    storyPngPath: string | null;
    primaryText: string;
    headline: string;
    description: string;
    cta: string;
  } | null;
  planId?: string;
  /** "active" only after the separate Activate action; "paused" = durable Meta receipt. */
  status?: "publishing" | "paused" | "unknown" | "active" | string;
  controlsFingerprint?: string;
  lastCheckedAt?: string;
  setupSummary?: PublishSetupSummary;
  activationError?: string;
  plannedObjects?: { campaigns: number; adSets: number; leadForms: number; creatives: number; ads: number };
  reconciledObjects?: {
    campaignId?: string;
    leadFormIds?: Record<string, string>;
    adSetIds?: Record<string, string>;
    creativeIds?: Record<string, string>;
    adIds?: Record<string, string>;
  };
  message?: string;
  error?: string;
  issues?: string[];
  blockers?: string[];
  unconfirmedPauseIds?: string[];
};

type ActivationTargets = {
  campaignId?: string;
  adSetIds?: string[];
  adIds?: string[];
};

type ManualPublishState = {
  status: "idle" | "loading" | "requested" | "in_review" | "published" | "cancelled" | "failed";
  mutationId?: string;
  message?: string;
  error?: string;
};

const emptyFulfilment: PublishFulfilmentDraft = {
  exactOffer: "", eligibility: "", conditions: "", timeframe: "", evidence: "", approval: "",
  disclaimer: "", privacyUrl: "", consent: "", fulfilmentUrl: "", owner: "", expiry: "", tracking: "",
};

type ActivationReceipt = {
  ok?: boolean;
  mode?: "dry_run" | "activate";
  status?: string;
  planId?: string;
  mutationId?: string;
  targets?: ActivationTargets;
  message?: string;
  error?: string;
  issues?: string[];
  blockers?: string[];
  unconfirmedPauseIds?: string[];
};

export function PublishFlow({
  adId,
  workspaceId,
  templateId,
  templateName,
  publishRequirements,
  notSaved,
  initialState,
  initialIssues,
  providerWritesEnabled,
  audienceLocations,
  parentState,
  canRequestManualPublish,
  automatedPublishAvailable,
  metaConnectionConnected,
}: PublishFlowProps) {
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  // A form must be pinned before publishing — either one already attached to
  // the last saved revision (initialState.form) or one the customer generates,
  // edits and pins right here. The editor reports when a pin lands.
  const [formPinned, setFormPinned] = useState(() => Boolean(initialState?.form));
  const [formRevision, setFormRevision] = useState<number | null>(() => initialState?.formRevision ?? null);
  const [destinationUrl, setDestinationUrl] = useState(() => initialState?.ad.destinationUrl ?? "");
  const [targetMode, setTargetMode] = useState<PublishTargetMode>("new_campaign_new_adset");
  const [campaignId, setCampaignId] = useState("");
  const [adSetIds, setAdSetIds] = useState("");
  const [budgetMode, setBudgetMode] = useState<PublishBudgetMode>("");
  const [specialAdCategoryCountry, setSpecialAdCategoryCountry] = useState("");
  const [dailyBudgetDollars, setDailyBudgetDollars] = useState("");
  const [audienceMode, setAudienceMode] = useState<AudienceMode>("");
  const [selectedLocationKeys, setSelectedLocationKeys] = useState<string[]>([]);
  const [includeSurroundingSuburbs, setIncludeSurroundingSuburbs] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [placementChoices, setPlacementChoices] = useState<PlacementChoice[]>([]);
  const [startIntent, setStartIntent] = useState<ScheduleStartIntent>("");
  const [startAt, setStartAt] = useState("");
  const [endIntent, setEndIntent] = useState<ScheduleEndIntent>("");
  const [endAt, setEndAt] = useState("");
  const [confirmedSetupFingerprint, setConfirmedSetupFingerprint] = useState<string | null>(null);
  const [publishedSetupSummary, setPublishedSetupSummary] = useState<PublishSetupSummary | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Array<"feed" | "story">>(["feed", "story"]);
  const [offerEnabled, setOfferEnabled] = useState(() => publishRequirements.fulfilmentRequired);
  const [fulfilment, setFulfilment] = useState<PublishFulfilmentDraft>(emptyFulfilment);
  // BW-Q — activation is a SEPARATE explicit action after the PAUSED publish
  // receipt; it is never automatic.
  const [activating, setActivating] = useState(false);
  const [activateReceipt, setActivateReceipt] = useState<ActivationReceipt | null>(null);
  const [manualNotes, setManualNotes] = useState("");
  const [manualPublish, setManualPublish] = useState<ManualPublishState>({ status: "idle" });
  const [manualMutationId] = useState(() => crypto.randomUUID());
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [receiptRefreshError, setReceiptRefreshError] = useState<string | null>(null);
  const [clientMutationKey, setClientMutationKey] = useState(() => crypto.randomUUID());
  const receiptRequestVersion = useRef(0);
  const previousStage = useRef<number | null>(null);
  const receiptRegionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    const requestVersion = ++receiptRequestVersion.current;
    void fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Saved publish status could not be refreshed.");
        return (await res.json()) as PublishReceipt;
      })
      .then((saved) => {
        if (current && requestVersion === receiptRequestVersion.current && saved?.mode) {
          setReceipt(saved);
          setPublishedSetupSummary(saved.setupSummary ?? null);
        }
      })
      .catch((err) => {
        if (current && requestVersion === receiptRequestVersion.current) {
          setReceiptRefreshError(err instanceof Error ? err.message : "Saved publish status could not be refreshed.");
        }
      })
      .finally(() => { if (current) setReceiptLoading(false); });
    return () => { current = false; };
  }, [adId, workspaceId]);

  useEffect(() => {
    if (receipt) receiptRegionRef.current?.focus({ preventScroll: true });
  }, [receipt]);

  const handlePinStateChange = useCallback((state: { pinned: boolean; revision: number | null; form: InstantForm | null }) => {
    setFormPinned(state.pinned);
    setFormRevision(state.revision);
    setConfirmedSetupFingerprint(null);
  }, []);

  const parsedAdSetIds = adSetIds.split(",").map(id => id.trim()).filter(Boolean);
  const unconfirmedControlsDraft = {
    destinationMode: publishRequirements.destinationMode,
    destinationUrl,
    targetMode,
    campaignId,
    adSetIds: parsedAdSetIds,
    variantIds: selectedVariants,
    budgetMode,
    dailyBudgetDollars,
    newCampaignObjective: publishRequirements.objective,
    newCampaignSpecialAdCategory: publishRequirements.specialAdCategory,
    newCampaignSpecialAdCategoryCountry: specialAdCategoryCountry,
    parentState,
    audienceMode,
    availableLocations: audienceLocations,
    selectedLocationKeys,
    includeSurroundingSuburbs,
    latitude,
    longitude,
    radiusKm,
    placementChoices,
    startIntent,
    startAt,
    endIntent,
    endAt,
    offerEnabled,
    fulfilmentRequired: publishRequirements.fulfilmentRequired,
    fulfilment,
    reviewedCreativeRevision: initialState?.revision.revisionNumber ?? null,
    reviewedFormRevision: formPinned ? formRevision : null,
  };
  const setupFingerprint = publishSetupFingerprint(unconfirmedControlsDraft);
  const setupConfirmed = confirmedSetupFingerprint === setupFingerprint;
  const controlsDraft = { ...unconfirmedControlsDraft, setupConfirmed };
  const fieldsBuild = buildExplicitMetaPublishControls({ ...controlsDraft, setupConfirmed: true });
  const publishBuild = buildExplicitMetaPublishControls(controlsDraft);

  const handleManualPublish = useCallback(async () => {
    if (!publishBuild.controls || !publishBuild.summary) return;
    setSubmitting(true);
    setManualPublish({ status: "loading" });
    setPublishedSetupSummary(publishBuild.summary);
    try {
      const res = await fetch(
        `/api/adstudio/ads/${encodeURIComponent(adId)}/manual-publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            mutationId: manualMutationId,
            notes: manualNotes.trim() || undefined,
            controls: publishBuild.controls,
            publishSummary: publishBuild.summary,
            revisionId: initialState?.revision.id,
            documentHash: initialState?.revision.documentHash,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { request?: { status?: "requested" | "in_progress" | "completed" | "cancelled"; requestId?: string }; message?: string; error?: string };
      const request = body.request;
      const status = request?.status === "completed" ? "published" : request?.status === "cancelled" ? "cancelled" : request?.status === "in_progress" ? "in_review" : "requested";
      setManualPublish(res.ok ? { status, mutationId: request?.requestId ?? manualMutationId, message: body.message ?? "Your request is in the Blockwise publishing queue." } : { status: "failed", error: body.error ?? "The manual publishing request could not be submitted." });
    } catch (err) {
      setManualPublish({ status: "failed", error: err instanceof Error ? err.message : "The manual publishing request could not be submitted." });
    } finally {
      setSubmitting(false);
    }
  }, [adId, initialState?.revision.documentHash, initialState?.revision.id, manualMutationId, manualNotes, publishBuild.controls, publishBuild.summary, workspaceId]);

  const handleAutomatedPublish = useCallback(async () => {
    if (!publishBuild.controls || !publishBuild.summary) return;
    receiptRequestVersion.current += 1;
    setSubmitting(true);
    setReceipt(null);
    setPublishedSetupSummary(publishBuild.summary);
    try {
      const res = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controls: publishBuild.controls }),
      });
      const body = (await res.json().catch(() => ({}))) as PublishReceipt;
      if (body.setupSummary) setPublishedSetupSummary(body.setupSummary);
      setReceipt(res.ok ? body : { ...body, error: body.error ?? "publish_failed" });
    } catch (err) {
      setReceipt({ error: err instanceof Error ? err.message : "Publish request failed." });
    } finally {
      setSubmitting(false);
    }
  }, [adId, publishBuild.controls, publishBuild.summary, workspaceId]);

  useEffect(() => {
    if (automatedPublishAvailable) return;
    let cancelled = false;
    fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/manual-publish?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then(async response => ({ ok: response.ok, body: await response.json().catch(() => ({})) as { request?: { status?: "requested" | "in_progress" | "completed" | "cancelled"; requestId?: string }; message?: string } }))
      .then(({ ok, body }) => {
        if (!cancelled && ok && body.request?.status) {
          const status = body.request.status === "completed" ? "published" : body.request.status === "cancelled" ? "cancelled" : body.request.status === "in_progress" ? "in_review" : "requested";
          setManualPublish({ status, mutationId: body.request.requestId, message: body.message });
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [adId, automatedPublishAvailable, workspaceId]);

  // BW-Q — a SECOND explicit click. Only ever offered after a publish receipt
  // that created PAUSED objects on Meta (mode "publish"), and it targets that
  // exact plan. Never automatic.
  const handleActivate = useCallback(
    async (planId: string) => {
      setActivating(true);
      setActivateReceipt(null);
      try {
        const res = await fetch(
          `/api/adstudio/ads/${encodeURIComponent(adId)}/activate?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId, controlsFingerprint: receipt?.controlsFingerprint, clientMutationKey }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as ActivationReceipt;
        setActivateReceipt(res.ok ? body : { ...body, error: body.error ?? "activation_failed" });
        if (res.ok && body.status === "activated") {
          setReceipt((current) => current ? {
            ...current,
            status: "active",
            message: body.message,
            lastCheckedAt: new Date().toISOString(),
          } : current);
        } else if (body.status === "activating") {
          setReceipt((current) => current ? { ...current, status: "activating", message: body.message } : current);
        } else if (body.status === "unknown") {
          setReceipt((current) => current ? {
            ...current,
            status: "unknown",
            activationError: body.message,
            message: body.message,
          } : current);
        } else if (!res.ok && body.status === "paused" && body.error === "activation_failed") {
          // The server confirmed compensation. A deliberate retry is a new
          // logical mutation; transport retries before this response keep the old key.
          setClientMutationKey(crypto.randomUUID());
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Activate request failed.";
        setActivateReceipt({
          error: "activation_transport_unknown",
          status: "unknown",
          message: `${message} The request may have reached Meta; refresh this receipt before doing anything else.`,
        });
        setReceipt((current) => current ? {
          ...current,
          status: "unknown",
          activationError: message,
          message: "The activation response was lost, so the final Meta state is not confirmed.",
        } : current);
      } finally {
        setActivating(false);
      }
    },
    [adId, workspaceId, receipt?.controlsFingerprint, clientMutationKey],
  );

  const issues = initialIssues ?? [];
  const requiresForm = publishRequirements.destinationMode === "instant_form";
  const formReady = !requiresForm || Boolean(initialState?.form) || formPinned;
  const destinationReady = validHttpsUrl(destinationUrl);
  const selectedAdSetCount = targetMode === "existing_adset" ? new Set(parsedAdSetIds).size : 1;
  const targetReady = targetMode === "new_campaign_new_adset" || (Boolean(campaignId.trim()) && (targetMode !== "existing_adset" || selectedAdSetCount > 0));
  const fulfilmentActive = publishRequirements.fulfilmentRequired || offerEnabled;
  const fulfilmentReady = !fulfilmentActive || (
    Object.values(fulfilment).every(value => Boolean(value.trim()))
    && validHttpsUrl(fulfilment.privacyUrl)
    && validHttpsUrl(fulfilment.fulfilmentUrl)
  );
  const plannedAds = selectedVariants.length * selectedAdSetCount;
  const ready = issues.length === 0 && formReady && destinationReady && fulfilmentReady && targetReady && plannedAds > 0 && Boolean(publishBuild.controls);
  const currentStage = !formReady || !destinationReady || !fulfilmentReady || !targetReady
    ? 2
    : !setupConfirmed
      ? 3
      : 4;

  useEffect(() => {
    if (notSaved) return;
    if (previousStage.current === null) {
      previousStage.current = currentStage;
      return;
    }
    if (previousStage.current === currentStage) return;
    previousStage.current = currentStage;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`publish-stage-${currentStage}`)?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentStage, notSaved]);

  if (notSaved) {
    return (
      <div className="flex h-full items-center justify-center bg-(--canvas)">
        <div className="max-w-md rounded-(--r-card) border border-amber-200 bg-amber-50 p-6 text-center">
          <h2 className="mb-2 text-base font-semibold text-amber-900">Nothing to publish yet</h2>
          <p className="text-sm text-amber-800">
            Save this ad in the editor before you choose where it should be created.
          </p>
          <a
            href={`/ad-studio/templates/${encodeURIComponent(templateId)}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Go to editor
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-(--canvas)">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <nav aria-label="Publish progress" className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Step {currentStage} of 4</p>
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              [1, "Creative & copy", "publish-stage-1"],
              [2, "Destination & form", "publish-stage-2"],
              [3, "Audience & spend", "publish-stage-3"],
              [4, "Review & create", "publish-stage-4"],
            ].map(([step, label, target]) => (
              <li key={step} aria-current={currentStage === step ? "step" : undefined}>
                <a href={`#${target}`} className="flex min-h-11 items-center rounded-(--r-ctl) border border-border px-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=step]:border-primary aria-[current=step]:bg-primary/5">
                  {step}. {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* Issues */}
        {issues.length > 0 && (
          <div className="mb-6 rounded-(--r-card) border border-yellow-200 bg-yellow-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-yellow-800">Fix before publishing</h3>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={i} className="text-sm text-yellow-700">• {issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Saved creative */}
        <h2 id="publish-stage-1" tabIndex={-1} className="mb-3 scroll-mt-4 text-base font-semibold focus:outline-none">1. Creative & copy</h2>
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="mb-2 text-sm font-semibold">Saved creative</h3>
          {initialState ? (
             <div className="space-y-3 text-xs text-muted-foreground">
               <p>
                 Exact saved revision <span className="font-semibold text-foreground">{initialState.revision.revisionNumber}</span>
                 {initialState.revision.createdAt ? ` · saved ${formatSavedAt(initialState.revision.createdAt)}` : ""}
                 {` · Feed ${shortHash(initialState.revision.feedPngHash)} · Story ${shortHash(initialState.revision.storyPngHash)}`}
               </p>
               <div className="grid gap-4 sm:grid-cols-2">
                 <div><p className="mb-2">Feed</p><img src={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.feedPngPath)}`} alt="Saved Feed ad" className="w-full rounded-(--r-card) border border-border" /><a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.feedPngPath)}`} download="blockwise-feed.png">Download Feed PNG</a></div>
                 <div><p className="mb-2">Story</p><img src={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.storyPngPath)}`} alt="Saved Story ad" className="w-full rounded-(--r-card) border border-border" /><a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.storyPngPath)}`} download="blockwise-story.png">Download Story PNG</a></div>
               </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No saved revision loaded.</p>
          )}
        </div>

        {/* Copy */}
        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Meta copy</h3>
          {initialState ? (
            <div className="space-y-2 text-sm">
              <CopyRow label="Primary text" value={initialState.ad.metaPrimaryText} />
              <CopyRow label="Headline" value={initialState.ad.metaHeadline} />
              <CopyRow label="Description" value={initialState.ad.metaDescription} />
              <CopyRow label="CTA" value={initialState.ad.metaCta} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No copy loaded.</p>
          )}
        </div>

        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <div>
            <h3 className="text-sm font-semibold">Creative variants</h3>
            <p className="mt-1 text-xs text-muted-foreground">Choose the saved formats to create. These are the two variants available for this template.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["feed", "story"] as const).map(variant => (
              <label key={variant} className="flex min-h-11 items-center gap-3 rounded-(--r-ctl) border border-border bg-muted/20 px-3 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={selectedVariants.includes(variant)}
                  onChange={event => setSelectedVariants(current => event.target.checked ? [...current, variant] : current.filter(value => value !== variant))}
                  className="size-4 accent-primary"
                />
                {variant === "feed" ? "Feed (4:5)" : "Story (9:16)"}
              </label>
            ))}
          </div>
          <p className="rounded-(--r-ctl) bg-muted px-3 py-2 text-sm font-semibold" role="status" aria-live="polite">
            {selectedVariants.length} selected {selectedVariants.length === 1 ? "variant" : "variants"} × {selectedAdSetCount} {selectedAdSetCount === 1 ? "ad set" : "ad sets"} = {plannedAds} {plannedAds === 1 ? "ad" : "ads"} on Meta
          </p>
          {selectedVariants.length === 0 ? <p className="text-xs text-amber-700">Choose at least one creative variant.</p> : null}
        </div>

        {!automatedPublishAvailable ? <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line-heavy) bg-(--surface-subtle) p-4">
          <div>
            <h3 className="text-sm font-semibold">Request manual publishing</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">An authorised Blockwise operator will review this saved ad and publish it manually in Meta. This does not connect your Meta account to Blockwise or bypass Meta&apos;s app review.</p>
          </div>
          <label className="block text-xs font-semibold" htmlFor="manual-publish-notes">Optional note</label>
          <textarea id="manual-publish-notes" value={manualNotes} onChange={(event) => setManualNotes(event.target.value)} maxLength={500} placeholder="Tell the operator anything important about this request" className="min-h-20 w-full resize-y rounded-(--r-card) border border-(--line-heavy) bg-(--surface) px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {manualPublish.status === "requested" || manualPublish.status === "in_review" || manualPublish.status === "published" || manualPublish.status === "cancelled" ? <p className={`text-sm font-semibold ${manualPublish.status === "cancelled" ? "text-muted-foreground" : "text-success"}`} role="status" aria-live="polite">{manualPublish.status === "published" ? "Completed by Blockwise. Check your Meta account for the result." : manualPublish.status === "cancelled" ? "This request was cancelled. You can send a new request when ready." : manualPublish.status === "in_review" ? "A Blockwise operator is reviewing your request." : "Request sent. A Blockwise operator will review it."}</p> : null}
          {!canRequestManualPublish ? <p className="text-sm text-muted-foreground">Ask a workspace owner or admin to send this publishing request.</p> : null}
          {manualPublish.status === "failed" ? <p className="text-sm font-semibold text-error" role="alert">{manualPublish.error}</p> : null}
          {manualPublish.mutationId ? <p className="font-mono text-[10px] text-(--faint)">Request reference: {manualPublish.mutationId.slice(0, 8)}</p> : null}
          {metaConnectionConnected && !providerWritesEnabled ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleManualPublish}
              disabled={!canRequestManualPublish || !ready || submitting || manualPublish.status === "requested" || manualPublish.status === "in_review" || manualPublish.status === "published"}
              className="min-h-11 w-full rounded-full sm:w-auto"
            >
              {manualPublish.status === "loading" ? "Sending request…" : manualPublish.status === "requested" || manualPublish.status === "in_review" ? "Request sent" : "Request manual publishing"}
            </Button>
          ) : null}
        </div> : null}

        <h2 id="publish-stage-2" tabIndex={-1} className="mb-3 scroll-mt-4 text-base font-semibold focus:outline-none">2. Destination & form</h2>
        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Set up this ad</h3>
          <p className="text-xs text-muted-foreground">Blockwise prepares a new ad for you. You choose your daily spend, area, where it appears and timing below.</p>
          <details className="rounded-(--r-ctl) border border-border bg-muted/20 p-3" open={targetMode !== "new_campaign_new_adset"}>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Use an existing setup (advanced)</summary>
            <div className="grid gap-3 pt-3">
              <p className="text-xs text-muted-foreground">Use this only when you already have the campaign details. Existing campaigns and ad sets are never edited.</p>
              <Label htmlFor="meta-target-mode">Campaign and ad set</Label>
              <select
                id="meta-target-mode"
                value={targetMode}
                onChange={(event) => setTargetMode(event.target.value as typeof targetMode)}
                className="min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
              >
                <option value="new_campaign_new_adset">New campaign and new ad set</option>
                <option value="existing_campaign_new_adset">Existing campaign and new ad set</option>
                <option value="existing_adset">Existing campaign and one or more existing ad sets</option>
              </select>
              {targetMode !== "new_campaign_new_adset" ? (
                <div>
                  <Label htmlFor="meta-campaign-id">Existing campaign ID</Label>
                  <Input id="meta-campaign-id" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} placeholder="Existing campaign ID" className="mt-1 min-h-11 w-full bg-muted/30" />
                </div>
              ) : null}
              {targetMode === "existing_adset" ? (
                <div>
                  <Label htmlFor="meta-ad-set-ids">Existing ad set IDs</Label>
                  <Input id="meta-ad-set-ids" value={adSetIds} onChange={(event) => setAdSetIds(event.target.value)} placeholder="Separate multiple IDs with commas" className="mt-1 min-h-11 w-full bg-muted/30" />
                </div>
              ) : null}
              {!targetReady ? <p className="text-xs text-amber-700">Add the existing campaign and ad set details to continue.</p> : null}
            </div>
          </details>
        </div>

        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <Label className="text-sm font-semibold" htmlFor="publish-destination-url">
            {requiresForm ? "Ad destination" : "Article or website destination"}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {requiresForm
              ? fulfilmentActive
                ? "This is the ad's website destination. The form's thank-you action uses the separate fulfilment delivery URL below."
                : "After someone submits the Instant Form, Meta's thank-you button opens this HTTPS page."
              : "Use the real HTTPS page promised by this ad. Blockwise never substitutes the privacy-policy URL."}
          </p>
          <Input
            id="publish-destination-url"
            type="url"
            value={destinationUrl}
            onChange={(event) => setDestinationUrl(event.target.value)}
            placeholder={requiresForm ? "https://your-site.com/thank-you" : "https://your-site.com/article"}
            aria-invalid={Boolean(destinationUrl) && !destinationReady}
            className="mt-3 min-h-11 w-full bg-muted/30"
          />
          {destinationUrl && !destinationReady ? <p className="mt-2 text-xs text-red-600">Enter a valid HTTPS URL.</p> : null}
        </div>

        {requiresForm ? (
          <div className="mb-6">
            <InstantFormEditor
              adId={adId}
              workspaceId={workspaceId}
              onPinStateChange={handlePinStateChange}
            />
          </div>
        ) : null}

        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={fulfilmentActive}
              disabled={publishRequirements.fulfilmentRequired}
              onChange={event => setOfferEnabled(event.target.checked)}
              className="size-4 accent-primary"
            />
            This ad includes an offer, guide or result promise
          </label>
          <p className="text-xs text-muted-foreground">
            {publishRequirements.fulfilmentRequired
              ? `This template requires fulfilment${publishRequirements.fulfilmentDependency ? `: ${publishRequirements.fulfilmentDependency}` : "."}`
              : "Turn this on when the ad promises something the customer must receive or a claim that needs evidence."}
          </p>
          {fulfilmentActive ? <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {([
              ["exactOffer", "Exact offer"], ["eligibility", "Eligibility"], ["conditions", "Conditions"], ["timeframe", "Timeframe"],
              ["evidence", "Evidence"], ["approval", "Evidence approval"], ["disclaimer", "Disclaimer"], ["privacyUrl", "Privacy URL"],
              ["fulfilmentUrl", "Fulfilment delivery URL"],
              ["consent", "Consent wording"], ["owner", "Fulfilment owner"], ["expiry", "Expiry"], ["tracking", "Tracking"],
            ] as const).map(([field, label]) => (
              <div key={field}>
                <Label htmlFor={"fulfilment-" + field}>{label}</Label>
                <Input
                  id={"fulfilment-" + field}
                  type={field === "privacyUrl" || field === "fulfilmentUrl" ? "url" : "text"}
                  value={fulfilment[field]}
                  onChange={(event) => setFulfilment((current) => ({ ...current, [field]: event.target.value }))}
                  aria-invalid={(field === "privacyUrl" || field === "fulfilmentUrl") && Boolean(fulfilment[field]) && !validHttpsUrl(fulfilment[field])}
                  className="mt-1 min-h-11 bg-muted/30"
                />
              </div>
            ))}
            <p className="sm:col-span-2 rounded-(--r-ctl) bg-muted px-3 py-2 text-xs text-muted-foreground">
              The exact fulfilment URL is bound to the Instant Form thank-you action. It can match the ad destination only when you explicitly enter the same URL. A typed file name is not accepted.
            </p>
          </div> : null}
          {fulfilmentActive && !fulfilmentReady ? <p className="text-xs text-amber-700">Complete every promise field and add valid HTTPS privacy and fulfilment delivery URLs.</p> : null}
        </div>

        <h2 id="publish-stage-3" tabIndex={-1} className="mb-3 scroll-mt-4 text-base font-semibold focus:outline-none">3. Audience, budget & schedule</h2>
        <PublishSetupFields
          targetMode={targetMode}
          audienceLocations={audienceLocations}
          budgetMode={budgetMode}
          setBudgetMode={setBudgetMode}
          objective={publishRequirements.objective}
          specialAdCategory={publishRequirements.specialAdCategory}
          specialAdCategoryCountry={specialAdCategoryCountry}
          setSpecialAdCategoryCountry={setSpecialAdCategoryCountry}
          dailyBudgetDollars={dailyBudgetDollars}
          setDailyBudgetDollars={setDailyBudgetDollars}
          audienceMode={audienceMode}
          setAudienceMode={setAudienceMode}
          selectedLocationKeys={selectedLocationKeys}
          setSelectedLocationKeys={setSelectedLocationKeys}
          includeSurroundingSuburbs={includeSurroundingSuburbs}
          setIncludeSurroundingSuburbs={setIncludeSurroundingSuburbs}
          latitude={latitude}
          setLatitude={setLatitude}
          longitude={longitude}
          setLongitude={setLongitude}
          radiusKm={radiusKm}
          setRadiusKm={setRadiusKm}
          placementChoices={placementChoices}
          setPlacementChoices={setPlacementChoices}
          startIntent={startIntent}
          setStartIntent={setStartIntent}
          startAt={startAt}
          setStartAt={setStartAt}
          endIntent={endIntent}
          setEndIntent={setEndIntent}
          endAt={endAt}
          setEndAt={setEndAt}
          lastCheckedBudgetMode={parentState?.campaign?.budgetMode}
          setupConfirmed={setupConfirmed}
          setSetupConfirmed={confirmed => setConfirmedSetupFingerprint(confirmed ? setupFingerprint : null)}
          summary={fieldsBuild.summary}
          fieldsReady={Boolean(fieldsBuild.controls)}
          fieldIssues={fieldsBuild.issues}
        />

        {/* Provider mode */}
        <h2 id="publish-stage-4" tabIndex={-1} className="mb-3 scroll-mt-4 text-base font-semibold focus:outline-none">4. Review & create paused</h2>
        <div className="mb-4 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Exact setup to create</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved creative revision {initialState?.revision.revisionNumber ?? "—"}
            {requiresForm ? ` · Instant Form revision ${formRevision ?? "not pinned"}` : " · Website destination"}
            {` · ${plannedAds} ${plannedAds === 1 ? "ad" : "ads"}`}
          </p>
          {fieldsBuild.summary ? <div className="mt-3"><PublishSetupSummaryCard summary={fieldsBuild.summary} /></div> : (
            <p className="mt-3 text-sm text-amber-700">Complete the earlier stages to produce the exact server-bound setup.</p>
          )}
        </div>
        <details className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">What happens next</summary>
          <p className="mt-1 text-xs text-muted-foreground">
            {automatedPublishAvailable && providerWritesEnabled
              ? "Create paused on Meta saves these ads without running them. Nothing runs or spends until you explicitly choose Activate."
              : providerWritesEnabled
                ? "Automated publishing is unavailable for this account. Your saved creative and setup can be sent to an authorised Blockwise operator for manual review."
                : "Preview only is on — nothing will be created automatically. You can review the complete plan or request manual publishing."}
          </p>
        </details>

        {/* Receipt */}
        {receiptLoading ? <p className="mb-4 text-xs text-muted-foreground" role="status">Checking saved publish status…</p> : null}
        {receiptRefreshError ? <p className="mb-4 text-xs text-amber-700" role="status">{receiptRefreshError} You can retry from this page.</p> : null}
        {receipt ? <div ref={receiptRegionRef} tabIndex={-1} className="focus:outline-none"><ReceiptCard receipt={receipt} /></div> : null}

        {/* Safe retry — offered when Meta objects were created but activation
            did not complete (confirmed paused, or unconfirmed state — the
            retry's idempotent guard is safe in both). It targets the exact
            plan (and Meta object IDs) already created; never duplicates. */}
        {receipt?.mode === "publish" && receipt.status === "paused" && receipt.planId && !receipt.error && (
          <RetryActivationSection
            key={receipt.planId}
            planId={receipt.planId}
            activating={activating}
            receipt={activateReceipt}
            onActivate={handleActivate}
            setupSummary={publishedSetupSummary}
          />
        )}
      </div>

      <footer className="flex shrink-0 flex-col items-stretch gap-3 border-t border-(--line) bg-(--surface) px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        {receipt?.error ? (
          <p className="max-w-[68ch] text-sm text-red-600">{publishReceiptMessage(receipt)}</p>
        ) : !formReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Save the Instant Form above to continue.
          </p>
        ) : !destinationReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {requiresForm ? "Add the HTTPS thank-you destination to continue." : "Add the real HTTPS article or website URL to continue."}
          </p>
        ) : !targetReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add the existing Meta setup details to continue.</p>
        ) : !fulfilmentReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Complete the offer evidence and delivery details to continue.</p>
        ) : !publishBuild.controls && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {targetMode === "existing_adset"
              ? "Confirm that the existing ad set settings stay unchanged."
              : "Choose and confirm the daily spend, area, where the ad appears and timing."}
          </p>
        ) : (
          <span />
        )}
        <div className="w-full sm:ml-auto sm:w-auto">
          <Button
            onClick={metaConnectionConnected ? handleAutomatedPublish : handleManualPublish}
            disabled={metaConnectionConnected ? !ready || submitting || Boolean(receipt && !receipt.error) : !canRequestManualPublish || !ready || submitting || manualPublish.status === "requested" || manualPublish.status === "in_review" || manualPublish.status === "published"}
            className="min-h-11 w-full rounded-full px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
          >
            {metaConnectionConnected
              ? providerWritesEnabled
                ? submitting ? "Creating paused on Meta…" : "Create paused on Meta"
                : submitting ? "Previewing paused plan…" : "Preview paused plan"
              : submitting
                ? "Sending request…"
                : manualPublish.status === "requested" || manualPublish.status === "in_review"
                  ? "Request sent"
                  : "Request manual publishing"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function PublishSetupFields({
  targetMode,
  audienceLocations,
  budgetMode,
  setBudgetMode,
  objective,
  specialAdCategory,
  specialAdCategoryCountry,
  setSpecialAdCategoryCountry,
  dailyBudgetDollars,
  setDailyBudgetDollars,
  audienceMode,
  setAudienceMode,
  selectedLocationKeys,
  setSelectedLocationKeys,
  includeSurroundingSuburbs,
  setIncludeSurroundingSuburbs,
  latitude,
  setLatitude,
  longitude,
  setLongitude,
  radiusKm,
  setRadiusKm,
  placementChoices,
  setPlacementChoices,
  startIntent,
  setStartIntent,
  startAt,
  setStartAt,
  endIntent,
  setEndIntent,
  endAt,
  setEndAt,
  lastCheckedBudgetMode,
  setupConfirmed,
  setSetupConfirmed,
  summary,
  fieldsReady,
  fieldIssues,
}: {
  targetMode: PublishTargetMode;
  audienceLocations: PublishAudienceLocation[];
  budgetMode: PublishBudgetMode;
  setBudgetMode: (value: PublishBudgetMode) => void;
  objective: string;
  specialAdCategory: string | null;
  specialAdCategoryCountry: string;
  setSpecialAdCategoryCountry: (value: string) => void;
  dailyBudgetDollars: string;
  setDailyBudgetDollars: (value: string) => void;
  audienceMode: AudienceMode;
  setAudienceMode: (value: AudienceMode) => void;
  selectedLocationKeys: string[];
  setSelectedLocationKeys: Dispatch<SetStateAction<string[]>>;
  includeSurroundingSuburbs: boolean;
  setIncludeSurroundingSuburbs: (value: boolean) => void;
  latitude: string;
  setLatitude: (value: string) => void;
  longitude: string;
  setLongitude: (value: string) => void;
  radiusKm: string;
  setRadiusKm: (value: string) => void;
  placementChoices: PlacementChoice[];
  setPlacementChoices: Dispatch<SetStateAction<PlacementChoice[]>>;
  startIntent: ScheduleStartIntent;
  setStartIntent: (value: ScheduleStartIntent) => void;
  startAt: string;
  setStartAt: (value: string) => void;
  endIntent: ScheduleEndIntent;
  setEndIntent: (value: ScheduleEndIntent) => void;
  endAt: string;
  setEndAt: (value: string) => void;
  lastCheckedBudgetMode?: "campaign" | "adset";
  setupConfirmed: boolean;
  setSetupConfirmed: (value: boolean) => void;
  summary: PublishSetupSummary | null;
  fieldsReady: boolean;
  fieldIssues: string[];
}) {
  if (targetMode === "existing_adset") {
    return (
      <div className="mb-6 space-y-4 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
        <div>
          <h3 className="text-sm font-semibold">Existing ad set settings</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Blockwise will add ads only. Each selected ad set keeps its live budget, audience, placements and schedule from Meta.
          </p>
        </div>
        <dl className="grid gap-2 rounded-(--r-ctl) bg-muted/50 p-3 text-sm sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-xs text-muted-foreground">Budget mode</dt>
            <dd className="font-medium">{summary?.budgetMode ?? "Waiting for live Meta verification"}</dd>
          </div>
          {(["Budget", "Audience", "Placements", "Schedule"] as const).map(label => (
            <div key={label} className="flex items-baseline justify-between gap-3 sm:block">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium">Unchanged in Meta</dd>
            </div>
          ))}
        </dl>
        {fieldIssues.length > 0 ? <SetupIssues issues={fieldIssues} /> : null}
        <label className="flex min-h-11 items-start gap-3 rounded-(--r-ctl) border border-border px-3 py-2.5 text-sm font-medium">
          <input
            type="checkbox"
            checked={setupConfirmed}
            onChange={event => setSetupConfirmed(event.target.checked)}
            disabled={!fieldsReady}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          I confirm Blockwise must keep the existing ad sets&apos; live settings unchanged.
        </label>
      </div>
    );
  }

  const placementOptions: Array<[PlacementChoice, string]> = [
    ["facebook_feed", "Facebook Feed"],
    ["facebook_story", "Facebook Stories"],
    ["instagram_feed", "Instagram Feed"],
    ["instagram_story", "Instagram Stories"],
  ];
  const inheritedBudgetMode = lastCheckedBudgetMode ?? "";
  const effectiveBudgetMode = targetMode === "new_campaign_new_adset" ? budgetMode : inheritedBudgetMode;

  return (
    <div className="mb-6 space-y-5 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
      <div>
        <h3 className="text-sm font-semibold">Choose how your ad runs</h3>
        <p className="mt-1 text-xs text-muted-foreground">Nothing is assumed. Choose the daily spend, area, where the ad appears and timing before Blockwise creates anything.</p>
      </div>

      {targetMode === "new_campaign_new_adset" ? (
        <div className="space-y-4 border-t border-border pt-4">
          <div>
            <Label htmlFor="publish-special-category-country">Property ad country</Label>
            <Input
              id="publish-special-category-country"
              value={specialAdCategoryCountry}
              onChange={event => setSpecialAdCategoryCountry(event.target.value.toUpperCase().slice(0, 2))}
              placeholder="AU"
              maxLength={2}
              autoCapitalize="characters"
              className="mt-1 min-h-11 bg-muted/30 uppercase sm:max-w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">Enter the two-letter country code, such as AU. Blockwise will not assume it.</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">How should the daily spend be used?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
            {([
              ["campaign", "Share one daily amount", "Meta shares this daily amount across the ad groups in this campaign."],
              ["adset", "Give this group its own daily amount", "The ad versions in this group use their own daily amount."],
            ] as const).map(([value, label, description]) => (
              <label key={value} className="flex min-h-11 items-start gap-3 rounded-(--r-ctl) border border-border px-3 py-2.5 text-sm">
                <input
                  type="radio"
                  name="publish-budget-mode"
                  value={value}
                  checked={budgetMode === value}
                  onChange={() => setBudgetMode(value)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span><span className="font-medium">{label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span>
              </label>
            ))}
            </div>
          </fieldset>
          <details className="rounded-(--r-ctl) border border-border bg-muted/20 p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-xs font-semibold">Meta setup details (advanced)</summary>
            <dl className="grid gap-3 pt-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Campaign objective</dt><dd className="font-medium">{objective}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Special ad category</dt><dd className="font-medium">{specialAdCategory ?? "None declared"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Special ad category country</dt><dd className="font-medium">{specialAdCategoryCountry || "Not entered"}</dd></div>
            </dl>
          </details>
          </div>
      ) : (
        <div className="rounded-(--r-ctl) bg-muted/60 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Existing campaign budget mode</p>
          <p className="text-sm font-medium">
            {lastCheckedBudgetMode === "campaign"
              ? "Last checked: Campaign budget (CBO) · re-verified before creation"
              : lastCheckedBudgetMode === "adset"
                ? "Last checked: Ad set budget (ABO) · re-verified before creation"
                : "Waiting for Meta verification — Blockwise will not guess CBO or ABO."}
          </p>
        </div>
      )}

      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="publish-daily-budget">
            {targetMode === "existing_campaign_new_adset"
              ? "New ad set daily budget if ABO (AUD)"
              : "Daily spend (AUD)"}
          </Label>
          <Input
            id="publish-daily-budget"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={dailyBudgetDollars}
            onChange={event => setDailyBudgetDollars(event.target.value)}
            placeholder="25.00"
            className="mt-1 min-h-11 bg-muted/30 tabular-nums"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {targetMode === "existing_campaign_new_adset"
              ? "Blockwise re-checks Meta first. This applies only if the campaign is still ABO; live CBO keeps its campaign budget."
              : effectiveBudgetMode === "campaign"
              ? "Your chosen daily ad budget is shared across the ad groups in this campaign."
              : "Your chosen daily ad budget applies to this group of ad versions."}
          </p>
        </div>

        <div>
          <Label htmlFor="publish-audience-mode">Area</Label>
          <select
            id="publish-audience-mode"
            value={audienceMode}
            onChange={event => setAudienceMode(event.target.value as AudienceMode)}
            className="mt-1 min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 text-base md:text-sm"
          >
            <option value="">Choose an area</option>
            {audienceLocations.length > 0 ? <option value="saved_locations">Choose from saved areas</option> : null}
            <option value="custom_radius">Set a distance around a map point (advanced)</option>
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Blockwise will only use the area you choose. It will not target all of Australia by default.</p>
        </div>
      </div>

      {audienceMode === "saved_locations" ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Choose saved areas</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {audienceLocations.map(location => (
              <label key={location.key} className="flex min-h-11 items-center gap-3 rounded-(--r-ctl) border border-border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedLocationKeys.includes(location.key)}
                  onChange={event => setSelectedLocationKeys(current => event.target.checked ? [...current, location.key] : current.filter(key => key !== location.key))}
                  className="size-4 accent-primary"
                />
                {location.name}{location.region ? `, ${location.region}` : ""}
              </label>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={includeSurroundingSuburbs} onChange={event => setIncludeSurroundingSuburbs(event.target.checked)} className="size-4 accent-primary" />
            Include nearby areas (Meta&apos;s minimum radius is {MIN_META_RADIUS_KM} km)
          </label>
        </div>
      ) : null}

      {audienceMode === "custom_radius" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="publish-latitude">Latitude</Label><Input id="publish-latitude" type="number" step="any" value={latitude} onChange={event => setLatitude(event.target.value)} placeholder="-31.9523" className="mt-1 min-h-11 bg-muted/30" /></div>
          <div><Label htmlFor="publish-longitude">Longitude</Label><Input id="publish-longitude" type="number" step="any" value={longitude} onChange={event => setLongitude(event.target.value)} placeholder="115.8613" className="mt-1 min-h-11 bg-muted/30" /></div>
          <div><Label htmlFor="publish-radius">Radius (km)</Label><Input id="publish-radius" type="number" min={MIN_META_RADIUS_KM} step="1" value={radiusKm} onChange={event => setRadiusKm(event.target.value)} placeholder={String(MIN_META_RADIUS_KM)} className="mt-1 min-h-11 bg-muted/30" /></div>
        </div>
      ) : null}

      <fieldset className="space-y-2 border-t border-border pt-4">
        <legend className="text-xs font-medium">Where your ad appears</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {placementOptions.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3 rounded-(--r-ctl) border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={placementChoices.includes(value)}
                onChange={event => setPlacementChoices(current => event.target.checked ? [...current, value] : current.filter(choice => choice !== value))}
                className="size-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="publish-start-intent">Starts</Label>
          <select id="publish-start-intent" value={startIntent} onChange={event => setStartIntent(event.target.value as ScheduleStartIntent)} className="mt-1 min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 text-base md:text-sm">
            <option value="">Choose start timing</option>
            <option value="as_soon_as_activated">As soon as I activate it</option>
            <option value="scheduled">At a scheduled time</option>
          </select>
          {startIntent === "scheduled" ? <Input aria-label="Scheduled start date and time" type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} className="mt-2 min-h-11 bg-muted/30" /> : null}
        </div>
        <div>
          <Label htmlFor="publish-end-intent">Ends</Label>
          <select id="publish-end-intent" value={endIntent} onChange={event => setEndIntent(event.target.value as ScheduleEndIntent)} className="mt-1 min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 text-base md:text-sm">
            <option value="">Choose end timing</option>
            <option value="run_until_paused">Run until I pause it</option>
            <option value="scheduled">At a scheduled time</option>
          </select>
          {endIntent === "scheduled" ? <Input aria-label="Scheduled end date and time" type="datetime-local" value={endAt} onChange={event => setEndAt(event.target.value)} className="mt-2 min-h-11 bg-muted/30" /> : null}
        </div>
      </div>

      {summary ? <PublishSetupSummaryCard summary={summary} /> : (
        <p className="rounded-(--r-ctl) bg-muted px-3 py-2 text-xs text-muted-foreground">Complete the destination and every setup choice to see the exact activation summary.</p>
      )}
      {!summary && fieldIssues.length > 0 ? <SetupIssues issues={fieldIssues} /> : null}
      <label className="flex min-h-11 items-start gap-3 rounded-(--r-ctl) border border-border px-3 py-2.5 text-sm font-medium">
        <input
          type="checkbox"
          checked={setupConfirmed}
          onChange={event => setSetupConfirmed(event.target.checked)}
          disabled={!fieldsReady}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        I confirm the daily spend, area, places shown, timing, ad versions and any offer delivery details are correct.
      </label>
    </div>
  );
}

function PublishSetupSummaryCard({ summary }: { summary: PublishSetupSummary }) {
  const rows = [
    ["Setup", summary.target],
    ["How the spend is used", summary.budgetMode],
    ["Daily spend", summary.budget],
    ["Area", summary.audience],
    ["Where shown", summary.placements],
    ["Timing", summary.schedule],
    ["Where people go", summary.destination],
    ["Ad versions", summary.variants],
    ["Offer delivery", summary.fulfilment],
  ];
  return (
    <div className="rounded-(--r-ctl) bg-muted/60 p-3">
      <p className="text-xs font-semibold">Review the exact setup</p>
      <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
      </dl>
    </div>
  );
}

function SetupIssues({ issues }: { issues: string[] }) {
  const visible = [...new Set(issues)].slice(0, 6);
  return (
    <div className="rounded-(--r-ctl) border border-amber-200 bg-amber-50 px-3 py-2.5" role="status">
      <p className="text-xs font-semibold text-amber-900">Complete this setup</p>
      <ul className="mt-1 space-y-1">
        {visible.map(issue => <li key={issue} className="text-xs text-amber-800">• {issue}</li>)}
      </ul>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="mt-0.5">{value || "(empty)"}</p>
    </div>
  );
}

function ReceiptCard({ receipt }: { receipt: PublishReceipt }) {
  const details = [...new Set([...(receipt.blockers ?? []), ...(receipt.issues ?? [])])];
  if (receipt.error || details.length > 0) {
    return (
      <div className="mt-6 rounded-(--r-card) border border-red-200 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-800">Publish failed</h3>
        <p className="text-sm text-red-700">{publishReceiptMessage(receipt)}</p>
        {details.length > 0 && (
          <ul className="mt-2 space-y-1">
            {details.map(issue => (
              <li key={issue} className="text-xs text-red-700">• {issue}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (receipt.mode === "dry_run") {
    return (
      <div className="mt-6 rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-amber-900">Preview complete</h3>
        <p className="text-sm text-amber-800">{receipt.message}</p>
        <details className="mt-3 text-xs text-amber-800">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Meta reference details (advanced)</summary>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
            <ReceiptStat label="Snapshot" value={shortHash(receipt.snapshotId ?? "")} />
            <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
            <ReceiptStat label="Campaigns" value={String(receipt.plannedObjects?.campaigns ?? 0)} />
            <ReceiptStat label="Creatives" value={String(receipt.plannedObjects?.creatives ?? 0)} />
            <ReceiptStat label="Ads" value={String(receipt.plannedObjects?.ads ?? 0)} />
          </dl>
        </details>
        <PublishedSourceReceipt receipt={receipt} />
        <p className="mt-3 text-xs font-medium text-amber-800">
          No Meta objects were created.
        </p>
      </div>
    );
  }

  if (receipt.mode === "publish") {
    const objects = receipt.reconciledObjects;
    if (receipt.status === "publishing") {
      return <div className="mt-6 rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status"><h3 className="mb-1 text-sm font-semibold text-amber-900">Creation in progress</h3><p className="text-sm text-amber-800">Another request owns creation for this publish. Refresh to check whether Meta objects are now paused.</p></div>;
    }
    if (receipt.status === "activating") {
      return <div className="mt-6 rounded-(--r-card) border border-blue-200 bg-blue-50 p-4" role="status" aria-live="polite"><h3 className="mb-1 text-sm font-semibold text-blue-900">Activation in progress</h3><p className="text-sm text-blue-800">Meta is applying the separately approved activation. Refresh shortly for the verified result.</p></div>;
    }
    // Indeterminate: activation failed AND the safety pause could not be
    // confirmed — objects may be ACTIVE and spending. Never claim paused.
    if (receipt.status === "unknown") {
      return (
        <div className="mt-6 rounded-(--r-card) border border-red-300 bg-red-50 p-4" role="alert">
          <h3 className="mb-1 text-sm font-semibold text-red-900">Created on Meta — state unconfirmed</h3>
          <p className="text-sm text-red-800">{receipt.message} Check Meta Ads Manager before retrying; the state is unconfirmed.</p>
          {receipt.activationError ? <p className="mt-2 text-xs font-medium text-red-900">Activation error: {receipt.activationError}</p> : null}
          <MetaReferenceDetails className="text-red-800" receipt={receipt} objects={objects} />
          <PublishedSourceReceipt receipt={receipt} />
        </div>
      );
    }
    // Confirmed partial failure: Meta objects EXIST and the safety pause was
    // verified — activation did not complete, nothing is running.
    if (receipt.status === "paused") {
      return (
        <div className="mt-6 rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="alert">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">Created paused on Meta</h3>
          <p className="text-sm text-amber-800">{receipt.message}</p>
          {receipt.activationError ? <p className="mt-2 text-xs font-medium text-amber-900">Activation error: {receipt.activationError}</p> : null}
          <MetaReferenceDetails className="text-amber-800" receipt={receipt} objects={objects} />
          <PublishedSourceReceipt receipt={receipt} />
          <p className="mt-3 text-xs font-medium text-amber-800">
            This ad setup is paused on Meta — nothing is running or spending. Review the exact setup below, then use the separate Activate action when you are ready.
          </p>
        </div>
      );
    }
    if (receipt.status === "active") return (
      <div className="mt-6 rounded-(--r-card) border border-green-200 bg-green-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-green-800">Published — active on Meta</h3>
        <p className="text-sm text-green-700">{receipt.message}</p>
        <a className="mt-3 inline-flex min-h-11 items-center rounded-full border border-green-300 px-4 text-sm font-semibold text-green-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/results?planId=${encodeURIComponent(receipt.planId ?? "")}`}>View results</a>
        <MetaReferenceDetails className="text-green-800" receipt={receipt} objects={objects} />
        <PublishedSourceReceipt receipt={receipt} />
      </div>
    );
  }

  return null;
}

function MetaReferenceDetails({ receipt, objects, className }: { receipt: PublishReceipt; objects: PublishReceipt["reconciledObjects"]; className: string }) {
  return (
    <details className={"mt-3 text-xs " + className}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Meta reference details (advanced)</summary>
      <dl className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
        <ReceiptStat label="Campaign ID" value={objects?.campaignId ?? "—"} />
        <ReceiptStat label="Ad set IDs" value={formatIds(objects?.adSetIds)} />
        <ReceiptStat label="Lead form IDs" value={formatIds(objects?.leadFormIds)} />
        <ReceiptStat label="Creative IDs" value={formatIds(objects?.creativeIds)} />
        <ReceiptStat label="Ad IDs" value={formatIds(objects?.adIds)} />
      </dl>
    </details>
  );
}

function PublishedSourceReceipt({ receipt }: { receipt: PublishReceipt }) {
  const source = receipt.source;
  const creative = receipt.publishedCreative;
  if (!source && !creative && !receipt.snapshotId && !receipt.planId) return null;
  return (
    <details className="mt-4 border-t border-current/15 pt-3 text-xs">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Saved source details (advanced)</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <ReceiptStat label="Creative revision" value={source?.creativeRevision != null ? `v${source.creativeRevision}` : "—"} />
        <ReceiptStat label="Form revision" value={source?.formRevision != null ? `v${source.formRevision}` : "Not used"} />
        <ReceiptStat label="Snapshot" value={shortHash(receipt.snapshotId ?? source?.snapshotId ?? "")} />
        <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
        <ReceiptStat label="Document hash" value={shortHash(source?.documentHash ?? "")} />
        <ReceiptStat label="Feed PNG hash" value={shortHash(source?.feedPngHash ?? "")} />
        <ReceiptStat label="Story PNG hash" value={shortHash(source?.storyPngHash ?? "")} />
        <ReceiptStat label="Controls fingerprint" value={shortHash(receipt.controlsFingerprint ?? "")} />
        <ReceiptStat label="Last checked" value={formatReceiptTime(receipt.lastCheckedAt)} />
      </dl>
      {creative ? (
        <div className="mt-3">
          <p className="text-xs"><span className="font-medium">Published copy:</span> {creative.headline} · {creative.primaryText}</p>
          {(creative.feedPngPath || creative.storyPngPath) ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {creative.feedPngPath ? <img src={`/api/adstudio/media?path=${encodeURIComponent(creative.feedPngPath)}`} alt="Exact published Feed creative" className="w-full rounded-(--r-card) border border-current/15" /> : null}
              {creative.storyPngPath ? <img src={`/api/adstudio/media?path=${encodeURIComponent(creative.storyPngPath)}`} alt="Exact published Story creative" className="w-full rounded-(--r-card) border border-current/15" /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function ReceiptStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function shortHash(value: string): string {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function formatReceiptTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU");
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function publishReceiptMessage(receipt: PublishReceipt): string {
  if (receipt.message?.trim()) return receipt.message.trim();
  if ((receipt.blockers?.length ?? 0) > 0 || (receipt.issues?.length ?? 0) > 0) {
    return "Blockwise did not create anything. Fix the items below and try again.";
  }
  const messages: Record<string, string> = {
    meta_not_connected: "Connect the workspace to Meta before publishing.",
    setup_incomplete: "Finish the workspace's Meta setup before publishing.",
    not_ready: "This ad is not ready to publish yet.",
    meta_token_missing: "Reconnect Meta so Blockwise can verify the account.",
    publish_failed: "Meta did not finish creating the campaign. Nothing was activated.",
    publish_dependencies_missing: "The publish setup is incomplete. Review the fields above and try again.",
  };
  return receipt.error ? messages[receipt.error] ?? "Blockwise could not complete this publish. Review the setup and try again." : "Blockwise could not complete this publish.";
}

function formatIds(ids: Record<string, string> | undefined): string {
  if (!ids || Object.keys(ids).length === 0) return "—";
  return Object.values(ids).map(v => v.slice(0, 12)).join(", ");
}

// ---------------------------------------------------------------------------
// Safe retry — finish activation for a publish that CREATED the Meta objects
// but did not complete activation. Targets the exact existing plan (and Meta
// object IDs) — never creates duplicates. Only offered when the receipt says
// the objects exist and remain paused.
// ---------------------------------------------------------------------------

function RetryActivationSection({
  planId,
  activating,
  receipt,
  onActivate,
  setupSummary,
}: {
  planId: string;
  activating: boolean;
  receipt: ActivationReceipt | null;
  onActivate: (planId: string) => void;
  setupSummary: PublishSetupSummary | null;
}) {
  return (
    <div className="mt-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
      <h3 className="text-sm font-semibold">Activate this paused publish</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Your campaign was created on Meta but is still <span className="font-medium text-foreground">paused</span> — nothing is running.
        This is a separate confirmation step. It turns the same campaign, ad sets, and ads ACTIVE. No new objects are created.
      </p>
      {setupSummary ? <div className="mt-3"><PublishSetupSummaryCard summary={setupSummary} /></div> : null}
      <div className="mt-3 flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={activating || Boolean(receipt?.ok) || receipt?.status === "unknown" || receipt?.status === "activating"} className="min-h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {activating ? "Activating on Meta…" : "Activate on Meta"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Activate these paused ads?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p>This confirms that the reviewed ads can start running on Meta. No new ads are created.</p>
                  <details className="rounded-(--r-ctl) border border-border px-3 text-xs">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">Meta reference details (advanced)</summary>
                    <p className="pb-3">Plan {shortHash(planId)} will be made ACTIVE on Meta.</p>
                  </details>
                  <dl className="grid gap-2 rounded-(--r-ctl) bg-muted/60 p-3 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">Budget</dt><dd className="font-medium">{setupSummary?.budget ?? "Reviewed budget"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Audience / targeting</dt><dd className="font-medium">{setupSummary?.audience ?? "Reviewed audience"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Placements</dt><dd className="font-medium">{setupSummary?.placements ?? "Reviewed placements"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Schedule</dt><dd className="font-medium">{setupSummary?.schedule ?? "Reviewed schedule"}</dd></div>
                  </dl>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel className="min-h-11">Keep paused</AlertDialogCancel>
              <AlertDialogAction className="min-h-11" onClick={() => onActivate(planId)}>Activate ads</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <span className="text-xs text-muted-foreground">
          Plan {shortHash(planId)} · targets only the objects this publish created.
        </span>
      </div>

      {receipt && <ActivationReceiptCard receipt={receipt} />}
    </div>
  );
}

function ActivationReceiptCard({ receipt }: { receipt: ActivationReceipt }) {
  if (receipt.status === "unknown") {
    return (
      <div className="mt-4 rounded-(--r-card) border border-red-300 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-900">Activation state unconfirmed</h3>
        <p className="text-sm text-red-800">
          {receipt.message?.trim() || "Blockwise could not confirm the final Meta status."}
        </p>
        {receipt.unconfirmedPauseIds?.length ? (
          <p className="mt-2 text-xs text-red-800">
            Unconfirmed object IDs: {formatIdsList(receipt.unconfirmedPauseIds)}
          </p>
        ) : null}
        <p className="mt-2 text-xs font-medium text-red-900">
          Some objects may be active and spending. Check Meta Ads Manager now; do not retry activation until their status is known.
        </p>
      </div>
    );
  }

  if (receipt.status === "activating") {
    return (
      <div className="mt-4 rounded-(--r-card) border border-blue-200 bg-blue-50 p-4" role="status" aria-live="polite">
        <h3 className="mb-1 text-sm font-semibold text-blue-900">Activation in progress</h3>
        <p className="text-sm text-blue-800">{receipt.message}</p>
      </div>
    );
  }

  if (receipt.error) {
    const details = [...new Set([...(receipt.blockers ?? []), ...(receipt.issues ?? [])])];
    return (
      <div className="mt-4 rounded-(--r-card) border border-red-200 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-800">Activation failed</h3>
        <p className="text-sm text-red-700">{receipt.message?.trim() || "Meta did not accept this activation request."}</p>
        {details.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {details.map(issue => <li key={issue} className="text-xs text-red-700">• {issue}</li>)}
          </ul>
        ) : null}
        {receipt.status === "paused" ? (
          <p className="mt-2 text-xs text-red-700">The campaign is confirmed PAUSED on Meta — nothing started running.</p>
        ) : (
          <p className="mt-2 text-xs font-medium text-red-800">Blockwise could not verify the final Meta state. Check Ads Manager before retrying.</p>
        )}
      </div>
    );
  }

  if (receipt.mode === "dry_run") {
    return (
      <div className="mt-4 rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-amber-900">Activation dry run — NOT applied</h3>
        <p className="text-sm text-amber-800">{receipt.message}</p>
        <p className="mt-2 text-xs font-medium text-amber-800">
          The campaign stays PAUSED on Meta. No Meta status was changed.
        </p>
      </div>
    );
  }

  if (receipt.mode === "activate") {
    return (
      <div className="mt-4 rounded-(--r-card) border border-green-200 bg-green-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-green-800">Activated on Meta</h3>
        <p className="text-sm text-green-700">{receipt.message}</p>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-green-800 sm:grid-cols-2">
          <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
          <ReceiptStat label="Mutation" value={shortHash(receipt.mutationId ?? "")} />
          <ReceiptStat label="Campaign ID" value={receipt.targets?.campaignId ?? "—"} />
          <ReceiptStat label="Ad set IDs" value={formatIdsList(receipt.targets?.adSetIds)} />
          <ReceiptStat label="Ad IDs" value={formatIdsList(receipt.targets?.adIds)} />
        </dl>
      </div>
    );
  }

  return null;
}

function formatIdsList(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return "—";
  return ids.map(v => v.slice(0, 12)).join(", ");
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-AU");
}
