// Historical UI recovered from aa3b081c53cdb9c331666ae184bdab4b333ef3b1 (12 Sep 2026).
// Safety adaptations: no API calls, persistence, creation, activation, or downloads.
// Original four-stage JSX and local setup controls retained; current shared styling.
"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";

import { ArchiveForm } from "./archive-form";
import type { InstantForm } from "@/lib/adstudio/instant-form-types";
import type { PublishRequirements } from "@/lib/adstudio/publish-adapter";
import type { MetaParentState } from "@/lib/providers/meta-execution";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const emptyFulfilment: PublishFulfilmentDraft = {
  exactOffer: "", eligibility: "", conditions: "", timeframe: "", evidence: "", approval: "",
  disclaimer: "", privacyUrl: "", consent: "", fulfilmentUrl: "", owner: "", expiry: "", tracking: "",
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
  const [selectedVariants, setSelectedVariants] = useState<Array<"feed" | "story">>(["feed", "story"]);
  const [offerEnabled, setOfferEnabled] = useState(() => publishRequirements.fulfilmentRequired);
  const [fulfilment, setFulfilment] = useState<PublishFulfilmentDraft>(emptyFulfilment);
  const [activeStage, setActiveStage] = useState(1);

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
  const stageCanContinue = activeStage === 1
    ? true
    : activeStage === 2
      ? formReady && destinationReady && fulfilmentReady
      : activeStage === 3 ? targetReady && Boolean(fieldsBuild.controls) : ready;
  const nextStageLabel = activeStage === 1 ? "Destination and form" : activeStage === 2 ? "Audience and spend" : "Review and create";
  const currentStage = !formReady || !destinationReady || !fulfilmentReady
    ? 2
    : !targetReady || !setupConfirmed
      ? 3
      : 4;

  const [fulfilmentDetailsOpen, setFulfilmentDetailsOpen] = useState(!fulfilmentReady);

  useEffect(() => {
    if (!fulfilmentReady) setFulfilmentDetailsOpen(true);
  }, [fulfilmentReady]);

  useEffect(() => {
    if (notSaved) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`publish-stage-${activeStage}`)?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStage, notSaved]);

  if (notSaved) {
    return (
      <div className="flex h-full items-center justify-center bg-(--canvas)">
        <div className="max-w-md rounded-(--r-card) border border-amber-200 bg-amber-50 p-6 text-center">
          <h2 className="mb-2 text-base font-semibold text-amber-900">Nothing to publish yet</h2>
          <p className="text-sm text-amber-800">
            Save this ad in the editor before you choose where it should be created.
          </p>
          <Button asChild className="mt-4">
            <a href={`/ad-studio/templates/${encodeURIComponent(templateId)}`}>
              Go to editor
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--canvas)">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <nav aria-label="Publish progress" className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Step {activeStage} of 4 · Next required step: {currentStage}</p>
          <ol className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              [1, "Creative & copy", "publish-stage-1"],
              [2, "Destination & form", "publish-stage-2"],
              [3, "Audience & spend", "publish-stage-3"],
              [4, "Review & create", "publish-stage-4"],
            ].map(([step, label, target]) => (
              <li key={step} aria-current={activeStage === Number(step) ? "step" : undefined}>
                <Button variant="ghost" type="button" onClick={() => { setActiveStage(Number(step)); window.setTimeout(() => document.getElementById(String(target))?.focus({ preventScroll: false }), 0); }} className={`flex h-auto min-h-11 w-full items-center justify-start whitespace-normal py-2 text-xs sm:text-sm [&>span]:min-w-0 rounded-(--r-ctl) border border-border px-3 text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeStage === Number(step) ? "border-primary bg-primary/5" : ""}`}>
                  {step}. {label}
                </Button>
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

        <section hidden={activeStage !== 1} aria-labelledby="publish-stage-1">
        {/* Saved creative */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="publish-stage-1" tabIndex={-1} className="scroll-mt-4 text-base font-semibold focus:outline-none">1. Creative & copy</h2><Button variant="outline" size="sm" disabled>Edit creative and copy</Button></div>
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="mb-2 text-sm font-semibold">Saved creative</h3>
          {initialState ? (
             <div className="space-y-3 text-xs text-muted-foreground">
               <div className="flex flex-wrap items-start justify-between gap-2"><details className="min-w-0 rounded-(--r-ctl) border border-border bg-muted/20 px-3 py-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Saved version {initialState.revision.revisionNumber}</summary><p className="max-w-[68ch] pb-2 text-xs text-muted-foreground">{initialState.revision.createdAt ? `Saved ${formatSavedAt(initialState.revision.createdAt)} · ` : ""}Feed hash {shortHash(initialState.revision.feedPngHash)} · Story hash {shortHash(initialState.revision.storyPngHash)}</p></details><DownloadFormats feedUrl={initialState.revision.feedPngPath} storyUrl={initialState.revision.storyPngPath} /></div>
               <div className="grid grid-cols-2 gap-3 sm:gap-4">
                 <div><p className="mb-2">Feed</p><img src={initialState.revision.feedPngPath} alt="Saved Feed ad" className="max-h-[30dvh] w-full rounded-(--r-card) border border-border object-contain" /></div>
                 <div><p className="mb-2">Story</p><img src={initialState.revision.storyPngPath} alt="Saved Story ad" className="max-h-[30dvh] w-full rounded-(--r-card) border border-border object-contain" /></div>
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

        </section>

        <section hidden={activeStage !== 2} aria-labelledby="publish-stage-2">
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
            <ArchiveForm />
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
          {fulfilmentActive ? <details open={fulfilmentDetailsOpen} onToggle={(event) => setFulfilmentDetailsOpen(event.currentTarget.open)} className="rounded-(--r-ctl) border border-border bg-muted/20"><summary className="flex min-h-11 cursor-pointer items-center px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Offer and compliance details</summary><div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
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
          </div></details> : null}
          {fulfilmentActive && !fulfilmentReady ? <p className="text-xs text-amber-700">Complete every promise field and add valid HTTPS privacy and fulfilment delivery URLs.</p> : null}
        </div>

        </section>

        <section hidden={activeStage !== 3} aria-labelledby="publish-stage-3">
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
        </section>

        <section hidden={activeStage !== 4} aria-labelledby="publish-stage-4">
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

        </section>
      </div>

      <footer className="flex shrink-0 flex-col items-stretch gap-3 border-t border-(--line) bg-(--surface) px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-sm text-muted-foreground">Example only. Changes are not saved.</p>
        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:justify-end">
          {activeStage > 1 ? <Button type="button" variant="outline" onClick={() => setActiveStage(activeStage - 1)} className="min-h-11 w-full rounded-full px-6 text-sm font-semibold sm:w-auto">Back</Button> : null}
          {activeStage < 4 ? <Button type="button" onClick={() => setActiveStage(activeStage + 1)} className="min-h-11 w-full rounded-full px-6 text-sm font-semibold sm:w-auto">Continue to {nextStageLabel}</Button> : <Button
            disabled
            className="min-h-11 w-full rounded-full px-6 text-sm font-semibold sm:w-auto"
          >
            Publish disabled in archive
          </Button>}
        </div>      </footer>
    </div>
  );
}

function DownloadFormats(_props: { feedUrl: string; storyUrl: string }) {
  return <Button variant="outline" disabled>Downloads disabled in archive</Button>;
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

function shortHash(value: string): string { return value.slice(0, 12); }
function validHttpsUrl(value: string): boolean { try { return new URL(value).protocol === "https:"; } catch { return false; } }
function formatSavedAt(value: string): string { return new Date(value).toISOString().slice(0, 10); }
