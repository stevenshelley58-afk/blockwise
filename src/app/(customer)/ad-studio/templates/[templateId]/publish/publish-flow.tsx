"use client";

import { useCallback, useState } from "react";

import { InstantFormEditor } from "@/components/adstudio/instant-form-editor";
import type { PublishRequirements } from "@/lib/adstudio/publish-adapter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  packName: string;
  publishRequirements: PublishRequirements;
  /** True when the ad has no saved revision yet. */
  notSaved: boolean;
  initialState: {
    ad: { metaPrimaryText: string; metaHeadline: string; metaDescription: string; metaCta: string };
    revision: { revisionNumber: number; feedPngHash: string; feedPngPath: string; storyPngHash: string; storyPngPath: string };
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
  message?: string;
  error?: string;
  issues?: string[];
  blockers?: string[];
};

type ActivationTargets = {
  campaignId?: string;
  adSetIds?: string[];
  adIds?: string[];
};

type FulfilmentDraft = {
  exactOffer: string; eligibility: string; conditions: string; timeframe: string;
  evidence: string; approval: string; disclaimer: string; privacyUrl: string; consent: string;
  fulfilmentAsset: string; fulfilmentUrl: string; owner: string; expiry: string; tracking: string;
};
const emptyFulfilment: FulfilmentDraft = {
  exactOffer: "", eligibility: "", conditions: "", timeframe: "", evidence: "", approval: "",
  disclaimer: "", privacyUrl: "", consent: "", fulfilmentAsset: "", fulfilmentUrl: "",
  owner: "", expiry: "", tracking: "",
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
};

export function PublishFlow({
  adId,
  workspaceId,
  templateId,
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
  const [targetMode, setTargetMode] = useState<"new_campaign_new_adset" | "existing_campaign_new_adset" | "existing_adset">("new_campaign_new_adset");
  const [campaignId, setCampaignId] = useState("");
  const [adSetIds, setAdSetIds] = useState("");
  const [fulfilment, setFulfilment] = useState<FulfilmentDraft>(emptyFulfilment);
  // BW-Q — activation is a SEPARATE explicit action after the PAUSED publish
  // receipt; it is never automatic.
  const [activating, setActivating] = useState(false);
  const [activateReceipt, setActivateReceipt] = useState<ActivationReceipt | null>(null);

  const handlePinStateChange = useCallback((pinned: boolean) => {
    setFormPinned(pinned);
  }, []);

  const handlePublish = useCallback(async () => {
    setSubmitting(true);
    setReceipt(null);
    try {
      const res = await fetch(
        `/api/adstudio/ads/${encodeURIComponent(adId)}/publish?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            controls: {
              destinationMode: publishRequirements.destinationMode,
              target: targetMode === "new_campaign_new_adset"
                ? { mode: targetMode }
                : targetMode === "existing_campaign_new_adset"
                  ? { mode: targetMode, campaignId: campaignId.trim() }
                  : { mode: targetMode, campaignId: campaignId.trim(), adSetIds: adSetIds.split(",").map((id) => id.trim()).filter(Boolean) },
              ...(destinationUrl.trim() ? { destinationUrl: destinationUrl.trim() } : {}),
              fulfilment,
            },
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as PublishReceipt;
      setReceipt(body);
    } catch (err) {
      setReceipt({ error: err instanceof Error ? err.message : "Publish request failed." });
    } finally {
      setSubmitting(false);
    }
  }, [adId, adSetIds, campaignId, destinationUrl, fulfilment, publishRequirements.destinationMode, targetMode, workspaceId]);

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
            body: JSON.stringify({ planId }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as ActivationReceipt;
        setActivateReceipt(body);
      } catch (err) {
        setActivateReceipt({ error: err instanceof Error ? err.message : "Activate request failed." });
      } finally {
        setActivating(false);
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
            This ad has no saved revision. Save it in the editor first — publishing always freezes the
            last saved revision.
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

  const issues = initialIssues ?? [];
  const requiresForm = publishRequirements.destinationMode === "instant_form";
  const formReady = !requiresForm || Boolean(initialState?.form) || formPinned;
  const destinationReady = publishRequirements.destinationMode !== "website" || validHttpsUrl(destinationUrl);
  const fulfilmentReady = Object.entries(fulfilment).every(([key, value]) => key === "fulfilmentAsset" || key === "fulfilmentUrl" ? true : Boolean(value.trim())) && Boolean(fulfilment.fulfilmentAsset.trim() || fulfilment.fulfilmentUrl.trim());
  const ready = issues.length === 0 && formReady && destinationReady && fulfilmentReady;

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

        {/* Frozen revision */}
        <div className="mb-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="mb-2 text-sm font-semibold">Frozen revision (last saved)</h3>
          {initialState ? (
             <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Revision <span className="font-medium text-foreground">#{initialState.revision.revisionNumber}</span>
              </p>
               <div className="grid gap-4 sm:grid-cols-2">
                 <div><p className="mb-2">Feed creative</p><img src={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.feedPngPath)}`} alt="Frozen Feed ad creative" className="w-full rounded-md border border-border" /></div>
                 <div><p className="mb-2">Story creative</p><img src={`/api/adstudio/media?path=${encodeURIComponent(initialState.revision.storyPngPath)}`} alt="Frozen Story ad creative" className="w-full rounded-md border border-border" /></div>
               </div>
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

        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Meta destination</h3>
          <p className="text-xs text-muted-foreground">Choose where the paused objects belong. Existing campaigns and ad sets are never edited.</p>
          <select
            aria-label="Meta campaign and ad set target"
            value={targetMode}
            onChange={(event) => setTargetMode(event.target.value as typeof targetMode)}
            className="min-h-11 w-full rounded-md border border-border bg-muted/30 px-3 text-sm"
          >
            <option value="new_campaign_new_adset">New campaign and new ad set</option>
            <option value="existing_campaign_new_adset">Existing campaign and new ad set</option>
            <option value="existing_adset">Existing campaign and one or more existing ad sets</option>
          </select>
          {targetMode !== "new_campaign_new_adset" ? (
            <Input aria-label="Existing Meta campaign ID" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} placeholder="Existing campaign ID" className="min-h-11 w-full bg-muted/30" />
          ) : null}
          {targetMode === "existing_adset" ? (
            <Input aria-label="Existing Meta ad set IDs" value={adSetIds} onChange={(event) => setAdSetIds(event.target.value)} placeholder="Existing ad set IDs, comma separated" className="min-h-11 w-full bg-muted/30" />
          ) : null}
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
            <Label className="text-sm font-semibold" htmlFor="publish-destination-url">Article or website destination</Label>
            <p className="mt-1 text-xs text-muted-foreground">Use the real HTTPS page promised by this ad. Blockwise never substitutes the privacy-policy URL.</p>
            <Input
              id="publish-destination-url"
              type="url"
              value={destinationUrl}
              onChange={(event) => setDestinationUrl(event.target.value)}
              placeholder="https://your-site.com/article"
              className="mt-3 min-h-11 w-full bg-muted/30"
            />
            {destinationUrl && !destinationReady ? <p className="mt-2 text-xs text-red-600">Enter a valid HTTPS URL.</p> : null}
          </div>
        )}

        <div className="mb-6 space-y-3 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Offer and fulfilment</h3>
          <p className="text-xs text-muted-foreground">Complete what is promised, who qualifies, the evidence and consent, and exactly how the lead receives it. Publication is blocked until this is complete.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["exactOffer", "Exact offer"], ["eligibility", "Eligibility"], ["conditions", "Conditions"], ["timeframe", "Timeframe"],
              ["evidence", "Evidence"], ["approval", "Evidence approval"], ["disclaimer", "Disclaimer"], ["privacyUrl", "Privacy URL"],
              ["consent", "Consent wording"], ["owner", "Fulfilment owner"], ["expiry", "Expiry"], ["tracking", "Tracking"],
            ] as const).map(([field, label]) => (
              <div key={field}><Label htmlFor={"fulfilment-" + field}>{label}</Label><Input id={"fulfilment-" + field} value={fulfilment[field]} onChange={(event) => setFulfilment((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 min-h-11 bg-muted/30" /></div>
            ))}
            <div><Label htmlFor="fulfilment-asset">Fulfilment asset</Label><Input id="fulfilment-asset" value={fulfilment.fulfilmentAsset} onChange={(event) => setFulfilment((current) => ({ ...current, fulfilmentAsset: event.target.value }))} placeholder="Asset name or delivery file" className="mt-1 min-h-11 bg-muted/30" /></div>
            <div><Label htmlFor="fulfilment-url">Fulfilment URL</Label><Input id="fulfilment-url" type="url" value={fulfilment.fulfilmentUrl} onChange={(event) => setFulfilment((current) => ({ ...current, fulfilmentUrl: event.target.value }))} placeholder="https://..." className="mt-1 min-h-11 bg-muted/30" /></div>
          </div>
          {!fulfilmentReady ? <p className="text-xs text-amber-700">All offer fields are required, plus a fulfilment asset or HTTPS URL.</p> : null}
        </div>

        {/* Provider mode */}
        <div className="rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
          <h3 className="text-sm font-semibold">Publish mode</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {providerWritesEnabled
              ? "Your ad will be created in a paused state for your final review."
              : "Dry run mode is on — nothing will be created. You can still review the complete publish plan."}
          </p>
        </div>

        {/* Receipt */}
        {receipt && <ReceiptCard receipt={receipt} />}

        {/* BW-Q — Activate is a SEPARATE explicit click, only offered after a
            paused publish receipt (mode "publish" = objects created PAUSED on
            Meta). It targets that exact plan and never runs automatically. */}
        {receipt?.mode === "publish" && receipt.planId && !receipt.error && (
          <ActivateSection
            planId={receipt.planId}
            providerWritesEnabled={providerWritesEnabled}
            activating={activating}
            receipt={activateReceipt}
            onActivate={handleActivate}
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-(--line) bg-(--surface) px-5 py-4">
        {receipt?.error ? (
          <p className="text-sm text-red-600">{receipt.error}</p>
        ) : !formReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Generate and pin the Instant Form above to enable Freeze &amp; Create PAUSED.
          </p>
        ) : !destinationReady && issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add the real HTTPS article or website URL to continue.</p>
        ) : (
          <span />
        )}
        <div className="ml-auto">
          <Button
            onClick={handlePublish}
             disabled={!ready || submitting || Boolean(receipt && !receipt.error)}
            className="min-h-11 rounded-full px-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {submitting ? "Freezing & creating PAUSED..." : "Freeze & Create PAUSED"}
          </Button>
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

function ReceiptCard({ receipt }: { receipt: PublishReceipt }) {
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
        <h3 className="mb-1 text-sm font-semibold text-amber-900">Dry run — paused-disabled receipt</h3>
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

  if (receipt.mode === "publish") {
    const objects = receipt.reconciledObjects;
    return (
      <div className="mt-6 rounded-(--r-card) border border-green-200 bg-green-50 p-4" role="status">
        <h3 className="mb-1 text-sm font-semibold text-green-800">Created PAUSED on Meta</h3>
        <p className="text-sm text-green-700">{receipt.message}</p>
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-green-800 sm:grid-cols-2">
          <ReceiptStat label="Campaign ID" value={objects?.campaignId ?? "—"} />
          <ReceiptStat label="Ad set IDs" value={formatIds(objects?.adSetIds)} />
          <ReceiptStat label="Lead form IDs" value={formatIds(objects?.leadFormIds)} />
          <ReceiptStat label="Creative IDs" value={formatIds(objects?.creativeIds)} />
          <ReceiptStat label="Ad IDs" value={formatIds(objects?.adIds)} />
        </dl>
        <p className="mt-3 text-xs font-medium text-green-700">
          All objects are PAUSED — nothing is running. Activation is a separate step.
        </p>
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

// ---------------------------------------------------------------------------
// BW-Q — Activate: the second explicit click after a PAUSED publish.
// ---------------------------------------------------------------------------

function ActivateSection({
  planId,
  providerWritesEnabled,
  activating,
  receipt,
  onActivate,
}: {
  planId: string;
  providerWritesEnabled: boolean;
  activating: boolean;
  receipt: ActivationReceipt | null;
  onActivate: (planId: string) => void;
}) {
  return (
    <div className="mt-6 rounded-(--r-card) border border-(--line) bg-(--surface) p-4">
      <h3 className="text-sm font-semibold">Activate on Meta</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Your campaign is <span className="font-medium text-foreground">PAUSED on Meta</span> — nothing is running.
        Activating is a separate explicit step that turns the campaign, ad sets, and ads ACTIVE so they can start
        delivering.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {providerWritesEnabled
          ? "This optional step will move the paused campaign live."
          : "Dry run mode is on — this optional step will only show what would change."}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          onClick={() => onActivate(planId)}
          disabled={activating || Boolean(receipt?.ok)}
          className="min-h-11 rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {activating ? "Activating on Meta..." : "Activate on Meta"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Plan {shortHash(planId)} · this only affects the paused objects from your publish.
        </span>
      </div>

      {receipt && <ActivationReceiptCard receipt={receipt} />}
    </div>
  );
}

function ActivationReceiptCard({ receipt }: { receipt: ActivationReceipt }) {
  if (receipt.error) {
    return (
      <div className="mt-4 rounded-(--r-card) border border-red-200 bg-red-50 p-4" role="alert">
        <h3 className="mb-1 text-sm font-semibold text-red-800">Activation failed</h3>
        <p className="text-sm text-red-700">{receipt.error}</p>
        <p className="mt-2 text-xs text-red-700">
          The campaign is still PAUSED on Meta — nothing started running.
        </p>
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
