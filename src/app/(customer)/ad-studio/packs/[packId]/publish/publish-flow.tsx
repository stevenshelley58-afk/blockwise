"use client";

import { useCallback, useState } from "react";

import { InstantFormEditor } from "@/components/adstudio/instant-form-editor";
import type { PublishRequirements } from "@/lib/adstudio/publish-adapter";

// ---------------------------------------------------------------------------
// Publish flow client.
//
// Shows the last saved revision and drives POST /api/adstudio/ads/[id]/publish,
// which completes the whole server-side lifecycle: freezes the snapshot,
// creates the Meta objects and ACTIVATES them. The receipt reports "active"
// only after Meta confirms the CONFIGURED status of campaign, ad sets and ads;
// if activation did not complete the receipt says exactly that and offers a
// safe retry targeting the already-created objects.
//
// Budget, audience, placements and schedule are real, editable controls —
// nothing is hardcoded. The summary reflects the customer's actual selections
// (or the server's documented default when a field is left untouched).
// ---------------------------------------------------------------------------

export interface PublishFlowProps {
  adId: string;
  workspaceId: string;
  packId: string;
  packName: string;
  publishRequirements: PublishRequirements;
  /** True when the ad has no saved revision yet. */
  notSaved: boolean;
  initialState: {
    ad: { metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string };
    revision: { revisionNumber: number; feedPngHash: string; storyPngHash: string };
    form: {
      name: string;
      formType: string;
      intro: { headline: string };
      contactFields: Array<{ type: string; required: boolean }>;
    } | null;
  } | null;
  initialIssues: string[];
  providerWritesEnabled: boolean;
}

type PublishReceipt = {
  ok?: boolean;
  mode?: "dry_run" | "publish";
  providerWritesEnabled?: boolean;
  snapshotId?: string;
  planId?: string;
  status?: string;
  plannedObjects?: { campaigns: number; adSets: number; leadForms: number; creatives: number; ads: number };
  reconciledObjects?: {
    campaignId?: string;
    leadFormIds?: Record<string, string>;
    adSetIds?: Record<string, string>;
    creativeIds?: Record<string, string>;
    adIds?: Record<string, string>;
  };
  activationError?: string;
  message?: string;
  error?: string;
  issues?: string[];
  blockers?: string[];
};

type ActivationReceipt = {
  ok?: boolean;
  mode?: "dry_run" | "activate";
  status?: string;
  planId?: string;
  mutationId?: string;
  targets?: { campaignId?: string; adSetIds?: string[]; adIds?: string[] };
  message?: string;
  error?: string;
};

/** Domain default geo (AdStudioCampaign.market.country is "AU" by model). */
const DEFAULT_GEO_COUNTRY = "AU";
const COUNTRY_OPTIONS = [
  { value: "AU", label: "Australia" },
  { value: "NZ", label: "New Zealand" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
];
const SERVER_DEFAULT_DAILY_BUDGET_MINOR = 2000;

function formatBudget(dollars: string): string {
  const value = Number(dollars);
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2);
}

export function PublishFlow({
  adId,
  workspaceId,
  packId,
  packName,
  publishRequirements,
  notSaved,
  initialState,
  initialIssues,
  providerWritesEnabled,
}: PublishFlowProps) {
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  // A form must be pinned before publishing — either one already attached to
  // the last saved revision (initialState.form) or one the customer generates,
  // edits and pins right here. The editor reports when a pin lands.
  const [formPinned, setFormPinned] = useState(() => Boolean(initialState?.form));
  const [destinationUrl, setDestinationUrl] = useState("");
  // Safe retry after a publish that created Meta objects but did not complete
  // activation — it targets that exact plan.
  const [retrying, setRetrying] = useState(false);
  const [retryReceipt, setRetryReceipt] = useState<ActivationReceipt | null>(null);

  // --- Real publish controls (all customer-editable; empty = server default) ---
  const [budgetDollars, setBudgetDollars] = useState("");
  const [geoMode, setGeoMode] = useState<"country" | "custom_radius">("country");
  const [geoCountry, setGeoCountry] = useState(DEFAULT_GEO_COUNTRY);
  const [radiusKm, setRadiusKm] = useState("");
  const [radiusLat, setRadiusLat] = useState("");
  const [radiusLon, setRadiusLon] = useState("");
  const [facebookEnabled, setFacebookEnabled] = useState(true);
  const [instagramEnabled, setInstagramEnabled] = useState(true);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");

  const handlePinStateChange = useCallback((pinned: boolean) => {
    setFormPinned(pinned);
  }, []);

  const radiusValid =
    geoMode !== "custom_radius" ||
    (Number(radiusKm) > 0 && Number.isFinite(Number(radiusLat)) && Number.isFinite(Number(radiusLon)));
  const scheduleValid = !scheduleStart || !scheduleEnd || scheduleEnd > scheduleStart;
  const placementsValid = facebookEnabled || instagramEnabled;
  const budgetMinor = (() => {
    const cents = Math.round(Number(budgetDollars) * 100);
    return Number.isFinite(cents) && cents > 0 ? cents : null;
  })();

  const handlePublish = useCallback(async () => {
    setSubmitting(true);
    setReceipt(null);
    setRetryReceipt(null);
    try {
      const controls: Record<string, unknown> = {
        destinationMode: publishRequirements.destinationMode,
        geo:
          geoMode === "country"
            ? { type: "country", country: geoCountry }
            : { type: "custom_radius", latitude: Number(radiusLat), longitude: Number(radiusLon), radiusKm: Number(radiusKm) },
        schedule: {
          startTime: scheduleStart ? new Date(scheduleStart).toISOString() : null,
          endTime: scheduleEnd ? new Date(scheduleEnd).toISOString() : null,
        },
        placements: {
          publisherPlatforms: [
            ...(facebookEnabled ? ["facebook"] : []),
            ...(instagramEnabled ? ["instagram"] : []),
          ],
        },
        ...(budgetMinor ? { dailyBudgetMinorUnits: budgetMinor } : {}),
        ...(destinationUrl.trim() ? { destinationUrl: destinationUrl.trim() } : {}),
      };
      const res = await fetch(
        `/api/adstudio/ads/${encodeURIComponent(adId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ controls }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as PublishReceipt;
      setReceipt(body);
    } catch (err) {
      setReceipt({ error: err instanceof Error ? err.message : "Publish request failed." });
    } finally {
      setSubmitting(false);
    }
  }, [adId, budgetMinor, destinationUrl, facebookEnabled, geoCountry, geoMode, instagramEnabled, publishRequirements.destinationMode, radiusKm, radiusLat, radiusLon, scheduleEnd, scheduleStart, workspaceId]);

  // Safe retry: the publish created Meta objects but activation did not
  // complete. The retry targets that exact plan and never creates duplicates.
  const handleRetryActivation = useCallback(
    async (planId: string) => {
      setRetrying(true);
      setRetryReceipt(null);
      try {
        const res = await fetch(
          `/api/adstudio/ads/${encodeURIComponent(adId)}/activate?workspaceId=${encodeURIComponent(workspaceId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as ActivationReceipt;
        setRetryReceipt(body);
      } catch (err) {
        setRetryReceipt({ error: err instanceof Error ? err.message : "Publish retry failed." });
      } finally {
        setRetrying(false);
      }
    },
    [adId, workspaceId],
  );

  if (notSaved) {
    return (
      <div className="flex h-full items-center justify-center bg-(--canvas)">
        <div className="max-w-md rounded-(--r-card) border border-amber-200 bg-amber-50 p-6 text-center">
          <h2 className="mb-2 text-base font-semibold text-amber-900">Nothing to publish yet</h2>
          <p className="text-sm text-amber-800">
            This ad has no saved revision. Save it in the editor first — publishing always uses the
            last saved version.
          </p>
          <a
            href={`/ad-studio/packs/${encodeURIComponent(packId)}`}
            className="mt-4 inline-block rounded-(--r-control) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white"
          >
            Go to editor
          </a>
        </div>
      </div>
    );
  }

  const issues = initialIssues ?? [];
  const requiresForm = publishRequirements.destinationMode === "instant_form";
  const formReady = !requiresForm || Boolean(initialState?.form) || formPinned;
  const destinationReady = publishRequirements.destinationMode !== "website" || validHttpsUrl(destinationUrl);
  const ready = issues.length === 0 && formReady && destinationReady && radiusValid && scheduleValid && placementsValid;

  const budgetSummary = budgetMinor
    ? `$${formatBudget(budgetDollars)} per day`
    : `Blockwise default ($${(SERVER_DEFAULT_DAILY_BUDGET_MINOR / 100).toFixed(2)} per day)`;
  const geoSummary = geoMode === "country"
    ? COUNTRY_OPTIONS.find((c) => c.value === geoCountry)?.label ?? geoCountry
    : `Custom radius — ${radiusKm || "?"} km around ${radiusLat || "?"}, ${radiusLon || "?"}`;
  const placementsSummary = [
    ...(facebookEnabled ? ["Facebook"] : []),
    ...(instagramEnabled ? ["Instagram"] : []),
  ].join(" and ") || "None selected";
  const scheduleSummary = scheduleStart
    ? `Starts ${new Date(scheduleStart).toLocaleString()}${scheduleEnd ? `, ends ${new Date(scheduleEnd).toLocaleString()}` : ", runs until you pause it"}`
    : "Starts as soon as Meta approves the ad; runs continuously";

  return (
    <div className="flex h-full flex-col bg-(--canvas)">
      <div className="flex-1 overflow-y-auto p-6">
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

        {/* Revision to publish */}
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="mb-2 text-sm font-semibold">Revision to publish (last saved)</h3>
          {initialState ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Revision <span className="font-medium text-foreground">#{initialState.revision.revisionNumber}</span>
              </p>
              <p>Feed PNG: {shortHash(initialState.revision.feedPngHash)}</p>
              <p>Story PNG: {shortHash(initialState.revision.storyPngHash)}</p>
              <p>Pack: {packName}</p>
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

        {requiresForm ? (
          <div className="mb-6">
            <InstantFormEditor
              adId={adId}
              workspaceId={workspaceId}
              onPinStateChange={handlePinStateChange}
            />
          </div>
        ) : (
          <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
            <label className="text-sm font-semibold" htmlFor="publish-destination-url">Article or website destination</label>
            <p className="mt-1 text-xs text-muted-foreground">Use the real HTTPS page promised by this ad. Blockwise never substitutes the privacy-policy URL.</p>
            <input
              id="publish-destination-url"
              type="url"
              value={destinationUrl}
              onChange={(event) => setDestinationUrl(event.target.value)}
              placeholder="https://your-site.com/article"
              className="mt-3 w-full rounded-(--r-control) border border-(--line) bg-(--canvas) px-3 py-2 text-sm outline-none focus:border-(--ui-primary)"
            />
            {destinationUrl && !destinationReady ? <p className="mt-2 text-xs text-red-600">Enter a valid HTTPS URL.</p> : null}
          </div>
        )}

        {/* Real publish controls — the customer chooses; nothing is fixed */}
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Campaign settings</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the budget, audience, placements and schedule for this campaign. Fields left
            untouched use Blockwise&apos;s documented defaults.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Budget */}
            <label className="block">
              <span className="text-sm font-semibold">Daily budget (AUD)</span>
              <input
                type="number"
                min="1"
                step="0.5"
                value={budgetDollars}
                onChange={(event) => setBudgetDollars(event.target.value)}
                placeholder="20.00"
                className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--canvas) px-3 py-2 text-sm outline-none focus:border-(--ui-primary)"
                aria-label="Daily budget in Australian dollars"
              />
              <span className="mt-1 block text-xs text-muted-foreground">Leave blank for the default ($20.00 per day).</span>
            </label>

            {/* Audience */}
            <fieldset className="block">
              <legend className="text-sm font-semibold">Audience</legend>
              <div className="mt-1 flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="geo-mode" checked={geoMode === "country"} onChange={() => setGeoMode("country")} />
                  Whole country
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="geo-mode" checked={geoMode === "custom_radius"} onChange={() => setGeoMode("custom_radius")} />
                  Custom radius
                </label>
              </div>
              {geoMode === "country" ? (
                <select
                  value={geoCountry}
                  onChange={(event) => setGeoCountry(event.target.value)}
                  className="mt-2 w-full rounded-(--r-control) border border-(--line) bg-(--canvas) px-3 py-2 text-sm outline-none focus:border-(--ui-primary)"
                  aria-label="Audience country"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <input type="text" inputMode="decimal" value={radiusLat} onChange={(e) => setRadiusLat(e.target.value)} placeholder="Latitude" className="rounded-(--r-control) border border-(--line) bg-(--canvas) px-2 py-2 text-sm outline-none focus:border-(--ui-primary)" aria-label="Latitude" />
                  <input type="text" inputMode="decimal" value={radiusLon} onChange={(e) => setRadiusLon(e.target.value)} placeholder="Longitude" className="rounded-(--r-control) border border-(--line) bg-(--canvas) px-2 py-2 text-sm outline-none focus:border-(--ui-primary)" aria-label="Longitude" />
                  <input type="number" min="1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} placeholder="Radius km" className="rounded-(--r-control) border border-(--line) bg-(--canvas) px-2 py-2 text-sm outline-none focus:border-(--ui-primary)" aria-label="Radius in kilometres" />
                </div>
              )}
              {geoMode === "custom_radius" && !radiusValid && (
                <p className="mt-1 text-xs text-red-600">Enter a latitude, longitude and a radius of at least 1 km.</p>
              )}
            </fieldset>

            {/* Placements */}
            <fieldset className="block">
              <legend className="text-sm font-semibold">Placements</legend>
              <div className="mt-1 flex flex-col gap-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={facebookEnabled} onChange={(e) => setFacebookEnabled(e.target.checked)} />
                  Facebook (Feed)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={instagramEnabled} onChange={(e) => setInstagramEnabled(e.target.checked)} />
                  Instagram (Feed and Story)
                </label>
              </div>
              {!placementsValid && <p className="mt-1 text-xs text-red-600">Choose at least one placement.</p>}
            </fieldset>

            {/* Schedule */}
            <fieldset className="block">
              <legend className="text-sm font-semibold">Schedule</legend>
              <div className="mt-1 space-y-2">
                <label className="block text-xs text-muted-foreground">
                  Start (optional)
                  <input type="datetime-local" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--canvas) px-3 py-2 text-sm text-foreground outline-none focus:border-(--ui-primary)" />
                </label>
                <label className="block text-xs text-muted-foreground">
                  End (optional)
                  <input type="datetime-local" value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} className="mt-1 w-full rounded-(--r-control) border border-(--line) bg-(--canvas) px-3 py-2 text-sm text-foreground outline-none focus:border-(--ui-primary)" />
                </label>
              </div>
              {!scheduleValid && <p className="mt-1 text-xs text-red-600">The end time must be after the start time.</p>}
            </fieldset>
          </div>
        </div>

        {/* Explicit confirmation summary of the ACTUAL selections */}
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Confirm before publishing</h3>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <SummaryRow label="Objective" value="Leads (instant form or website destination)" />
            <SummaryRow label="Budget" value={budgetSummary} />
            <SummaryRow label="Audience" value={geoSummary} />
            <SummaryRow label="Placements" value={placementsSummary} />
            <SummaryRow label="Schedule" value={scheduleSummary} />
            <SummaryRow
              label="Destination"
              value={requiresForm
                ? `Instant Form${initialState ? ` — ${initialState.form?.name ?? "generated below"}` : ""}`
                : (destinationUrl.trim() || "Enter the destination URL below")}
            />
          </dl>
        </div>

        {/* Provider mode */}
        <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Publish mode</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {providerWritesEnabled
              ? "Provider writes are enabled — publishing creates your campaign on Meta and activates it."
              : "Provider writes are disabled (BLOCKWISE_ENABLE_PROVIDER_WRITES=false) — publishing returns a dry-run receipt and creates nothing on Meta."}
          </p>
        </div>

        {/* Receipt */}
        {receipt && (
          <ReceiptCard
            receipt={receipt}
            retrying={retrying}
            retryReceipt={retryReceipt}
            onRetryActivation={handleRetryActivation}
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-(--line) bg-(--surface) px-5 py-4">
        {receipt?.error ? (
          <p className="text-sm text-red-600">{receipt.error}</p>
        ) : !formReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Generate and pin the Instant Form above to enable publishing.
          </p>
        ) : !destinationReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add the real HTTPS article or website URL to continue.</p>
        ) : !radiusValid ? (
          <p className="text-sm text-muted-foreground">Complete the custom radius audience to continue.</p>
        ) : !placementsValid ? (
          <p className="text-sm text-muted-foreground">Choose at least one placement to continue.</p>
        ) : (
          <span />
        )}
        <div className="ml-auto">
          <button
            onClick={handlePublish}
            disabled={!ready || submitting}
            className="rounded-(--r-control) bg-(--ui-primary) px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </footer>
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ReceiptCard({
  receipt,
  retrying,
  retryReceipt,
  onRetryActivation,
}: {
  receipt: PublishReceipt;
  retrying: boolean;
  retryReceipt: ActivationReceipt | null;
  onRetryActivation: (planId: string) => void;
}) {
  if (receipt.error) {
    return (
      <div className="mt-6 rounded-(--r-card) border border-red-200 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-800">Publish failed</h3>
        <p className="text-sm text-red-700">{receipt.error}</p>
        {receipt.issues && receipt.issues.length > 0 && (
          <ul className="mt-2 space-y-1">
            {receipt.issues.map((issue, i) => (
              <li key={i} className="text-xs text-red-700">• {issue}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (receipt.mode === "dry_run") {
    return (
      <div className="mt-6 rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-amber-900">Dry run — nothing was created</h3>
        <p className="text-sm text-amber-800">{receipt.message}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-amber-800 sm:grid-cols-5">
          <ReceiptStat label="Snapshot" value={shortHash(receipt.snapshotId ?? "")} />
          <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
          <ReceiptStat label="Campaigns" value={String(receipt.plannedObjects?.campaigns ?? 0)} />
          <ReceiptStat label="Creatives" value={String(receipt.plannedObjects?.creatives ?? 0)} />
          <ReceiptStat label="Ads" value={String(receipt.plannedObjects?.ads ?? 0)} />
        </dl>
        <p className="mt-3 text-xs font-medium text-amber-800">
          No Meta objects were created.
        </p>
      </div>
    );
  }

  if (receipt.mode === "publish" && receipt.status === "active") {
    const objects = receipt.reconciledObjects;
    return (
      <div className="mt-6 rounded-(--r-card) border border-green-200 bg-green-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-green-800">Published — your campaign is set to active</h3>
        <p className="text-sm text-green-700">{receipt.message}</p>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-green-800 sm:grid-cols-2">
          <ReceiptStat label="Campaign ID" value={objects?.campaignId ?? "—"} />
          <ReceiptStat label="Ad set IDs" value={formatIds(objects?.adSetIds)} />
          <ReceiptStat label="Lead form IDs" value={formatIds(objects?.leadFormIds)} />
          <ReceiptStat label="Creative IDs" value={formatIds(objects?.creativeIds)} />
          <ReceiptStat label="Ad IDs" value={formatIds(objects?.adIds)} />
        </dl>
      </div>
    );
  }

  if (receipt.mode === "publish" && receipt.status === "paused") {
    // Honest partial failure: objects were created on Meta but activation did
    // not complete — they are genuinely PAUSED, nothing is running. Offer the
    // safe retry that targets the exact objects already created.
    const objects = receipt.reconciledObjects;
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">Created on Meta — currently paused, not running</h3>
          <p className="text-sm text-amber-800">{receipt.message}</p>
          {receipt.activationError && (
            <p className="mt-2 text-xs font-medium text-amber-900">Reason: {receipt.activationError}</p>
          )}
          <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-amber-800 sm:grid-cols-2">
            <ReceiptStat label="Campaign ID" value={objects?.campaignId ?? "—"} />
            <ReceiptStat label="Ad set IDs" value={formatIds(objects?.adSetIds)} />
            <ReceiptStat label="Ad IDs" value={formatIds(objects?.adIds)} />
          </dl>
        </div>
        {retryReceipt && <RetryReceiptCard receipt={retryReceipt} />}
        {receipt.planId && !retryReceipt?.mode && (
          <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
            <button
              onClick={() => onRetryActivation(receipt.planId!)}
              disabled={retrying}
              className="rounded-(--r-control) bg-(--ui-primary) px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {retrying ? "Publishing…" : "Finish publishing"}
            </button>
            <span className="ml-3 text-xs text-muted-foreground">
              Safely activates the campaign already created on Meta — no duplicates are made.
            </span>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function RetryReceiptCard({ receipt }: { receipt: ActivationReceipt }) {
  if (receipt.error) {
    return (
      <div className="rounded-(--r-card) border border-red-200 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-800">Publish retry failed</h3>
        <p className="text-sm text-red-700">{receipt.error}</p>
        <p className="mt-2 text-xs text-red-700">
          Your campaign exists on Meta but is paused — nothing is running without your approval.
        </p>
      </div>
    );
  }

  if (receipt.mode === "dry_run") {
    return (
      <div className="rounded-(--r-card) border border-amber-200 bg-amber-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-amber-900">Dry run — not applied</h3>
        <p className="text-sm text-amber-800">{receipt.message}</p>
      </div>
    );
  }

  if (receipt.mode === "activate") {
    return (
      <div className="rounded-(--r-card) border border-green-200 bg-green-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-green-800">Published — your campaign is set to active</h3>
        <p className="text-sm text-green-700">{receipt.message}</p>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-green-800 sm:grid-cols-2">
          <ReceiptStat label="Plan" value={shortHash(receipt.planId ?? "")} />
          <ReceiptStat label="Campaign ID" value={receipt.targets?.campaignId ?? "—"} />
        </dl>
      </div>
    );
  }

  return null;
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

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === "https:";
  } catch {
    return false;
  }
}

function formatIds(ids: Record<string, string> | undefined): string {
  if (!ids || Object.keys(ids).length === 0) return "—";
  return Object.values(ids).map(v => v.slice(0, 12)).join(", ");
}
