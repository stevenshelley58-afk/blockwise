"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Download,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import type { AdStudioCampaignPack, AdStudioFormat, AdStudioTargetLocation } from "@/lib/adstudio";
import type { MetaPublishControls } from "@/lib/providers/meta-execution";

import type { ExportFormatStatus } from "../use-campaign-actions";

type ReadinessEntry = {
  id?: string;
  label: string;
  met: boolean;
  automatic?: boolean;
  blocked?: boolean;
  review?: boolean;
};

type MetaCampaign = {
  id: string;
  name: string;
  status: "active" | "paused";
  objective: "leads";
  createdAt: string | null;
  updatedAt: string | null;
};

type MetaCampaignsResponse = {
  connected?: boolean;
  account?: { id: string; name: string };
  campaigns?: MetaCampaign[];
  issue?: string;
};

type MetaTargetingLocationsResponse = {
  locations?: AdStudioTargetLocation[];
  error?: string;
};

type PublishResponse = {
  publishReady?: boolean;
  blockers?: string[];
  providerWritesEnabled?: boolean;
  triggerRunId?: string | null;
  status?: string;
  metaPublishPlan?: {
    id?: string;
    status?: string;
    approvalRequestId?: string | null;
    variantIds?: string[];
  } | null;
  error?: string;
};

type PublishPlanStatus = {
  status?: string;
  lastError?: string | null;
  reconciledObjects?: {
    campaigns: number;
    leadForms: number;
    adSets: number;
    creatives: number;
    ads: number;
  };
};

type PublishSetupPanelProps = {
  campaignId: string;
  campaignPack: AdStudioCampaignPack;
  destinationUrl: string;
  onChangeDestinationUrl?: (value: string) => void;
  onChangeTargeting?: (locations: AdStudioTargetLocation[], includeSurroundingSuburbs: boolean | undefined) => void;
  onExport: () => void;
  onDelete?: () => void;
  brandApproved?: boolean;
  exportStatus?: ExportFormatStatus[] | null;
  onRetryExportFormat?: (format: AdStudioFormat) => void;
};

const STEPS = ["Campaign setup", "Creatives", "Destination", "Budget", "Review", "Live"] as const;

export function PublishSetupPanel({
  campaignId,
  campaignPack,
  destinationUrl,
  onChangeDestinationUrl,
  onChangeTargeting,
  onExport,
  onDelete,
  brandApproved = true,
  exportStatus = null,
  onRetryExportFormat,
}: PublishSetupPanelProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [campaignMode, setCampaignMode] = useState<"existing" | "new">("new");
  const [selectedMetaCampaignId, setSelectedMetaCampaignId] = useState("");
  const [expandedMetaCampaignId, setExpandedMetaCampaignId] = useState("");
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaignsResponse | null>(null);
  const [metaCampaignsLoading, setMetaCampaignsLoading] = useState(true);
  const [metaCampaignRefresh, setMetaCampaignRefresh] = useState(0);
  const [readiness, setReadiness] = useState<ReadinessEntry[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishDone, setPublishDone] = useState(false);
  const [publishMessage, setPublishMessage] = useState("Published");
  const [publishPlanId, setPublishPlanId] = useState<string | null>(null);
  const [deselectedVariantIds, setDeselectedVariantIds] = useState<ReadonlySet<string>>(new Set());
  const [publishedVariantCount, setPublishedVariantCount] = useState<number | null>(null);
  const [dailyBudgetAud, setDailyBudgetAud] = useState(20);
  const [durationDays, setDurationDays] = useState(7);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetSuggestions, setTargetSuggestions] = useState<AdStudioTargetLocation[]>([]);
  const [targetSuggestionsLoading, setTargetSuggestionsLoading] = useState(false);
  const [targetSuggestionsError, setTargetSuggestionsError] = useState("");

  const targetSuburbs = campaignPack.campaign.market.targetSuburbs ?? [];
  const targetSuburbKeys = targetSuburbs.map((location) => location.key).join("|");
  const includeSurroundingSuburbs = campaignPack.campaign.market.includeSurroundingSuburbs;

  useEffect(() => {
    let cancelled = false;
    setMetaCampaignsLoading(true);
    fetch("/api/adstudio/meta-campaigns")
      .then(async (response) => ({ response, body: (await response.json().catch(() => ({}))) as MetaCampaignsResponse }))
      .then(({ response, body }) => {
        if (cancelled) return;
        setMetaCampaigns(response.ok ? body : { campaigns: [], issue: "Campaigns could not be loaded." });
      })
      .catch(() => {
        if (!cancelled) setMetaCampaigns({ campaigns: [], issue: "Campaigns could not be loaded." });
      })
      .finally(() => {
        if (!cancelled) setMetaCampaignsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [metaCampaignRefresh]);

  useEffect(() => {
    const query = targetQuery.trim();
    if (query.length < 2) {
      setTargetSuggestions([]);
      setTargetSuggestionsLoading(false);
      setTargetSuggestionsError("");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTargetSuggestionsLoading(true);
      setTargetSuggestionsError("");
      fetch(`/api/adstudio/meta-targeting-locations?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response) => ({ response, body: (await response.json().catch(() => ({}))) as MetaTargetingLocationsResponse }))
        .then(({ response, body }) => {
          if (!response.ok) throw new Error(body.error ?? "Suburbs could not be loaded.");
          setTargetSuggestions((body.locations ?? []).filter((location) => !targetSuburbs.some((selected) => selected.key === location.key)));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setTargetSuggestions([]);
          setTargetSuggestionsError(error instanceof Error ? error.message : "Suburbs could not be loaded.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setTargetSuggestionsLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [targetQuery, targetSuburbKeys]);

  useEffect(() => {
    if (!campaignId) return;
    fetch(`/api/adstudio/publish-readiness?campaignId=${encodeURIComponent(campaignId)}`)
      .then((response) => response.json().catch(() => null))
      .then((data) => {
        if (!data) return;
        const source = Array.isArray(data)
          ? data
          : Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.checklist)
              ? data.checklist
              : [];
        setReadiness(source.map((item: ReadinessEntry & { done?: boolean }) => ({
          id: item.id,
          label: item.label,
          met: item.met ?? Boolean(item.done),
          automatic: item.automatic,
          blocked: item.blocked,
          review: item.review,
        })));
      })
      .catch(() => setReadiness([]));
  }, [campaignId]);

  useEffect(() => {
    if (!publishPlanId || !publishDone) return;

    const planId = publishPlanId;
    let cancelled = false;
    async function pollPlan() {
      const response = await fetch(`/api/integrations/meta/publish-plans/${encodeURIComponent(planId)}`);
      const plan = (await response.json().catch(() => ({}))) as PublishPlanStatus;
      if (cancelled || !response.ok) return;

      if (plan.status === "failed") {
        setPublishDone(false);
        setPublishError(plan.lastError ?? "Meta publish failed.");
      } else if (plan.status === "paused_live") {
        setPublishMessage("Live on Meta (paused)");
      } else if (plan.status === "publishing" || plan.status === "approved") {
        const ads = plan.reconciledObjects?.ads ?? 0;
        setPublishMessage(ads > 0 ? `Creating ${ads} paused ad${ads === 1 ? "" : "s"}` : "Creating your paused ads");
      }
    }

    void pollPlan();
    const interval = window.setInterval(() => void pollPlan(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [publishDone, publishPlanId]);

  const brandItem: ReadinessEntry | null = brandApproved
    ? null
    : { id: "brand_kit_approved", label: "Confirm brand kit", met: false };
  const checklist = [...(brandItem ? [brandItem] : []), ...(readiness ?? [])];
  const blockingItems = checklist.filter((item) => !item.met && (!item.review || item.blocked));
  const allMet = readiness !== null && blockingItems.length === 0;
  const onlyBlockedProviderWrite = blockingItems.length === 1
    && blockingItems[0]?.id === "provider_writes"
    && blockingItems[0]?.blocked;
  const needsApprovalReview = checklist.some((item) => item.id === "approval_ready" && item.review && !item.met && !item.blocked);
  const variants = campaignPack.variants;
  const selectedVariantIds = variants.map((variant) => variant.variantId).filter((id) => !deselectedVariantIds.has(id));
  const fullSelection = selectedVariantIds.length === variants.length;
  const selectionHint = selectedVariantIds.length === 0
    ? "Select at least one creative."
    : !fullSelection && selectedVariantIds.length > 3
      ? "Select up to three creatives."
      : "";
  const brandName = campaignPack.brandKit.identity.tradingName?.trim()
    || campaignPack.brandKit.identity.businessName
    || "Your brand";
  const selectedCampaign = metaCampaigns?.campaigns?.find((campaign) => campaign.id === selectedMetaCampaignId);
  const campaignStepReady = campaignMode === "existing"
    ? Boolean(selectedCampaign)
    : targetSuburbs.length > 0 && includeSurroundingSuburbs !== undefined;
  const destinationReady = isWebUrl(destinationUrl);

  function toggleVariant(variantId: string) {
    setDeselectedVariantIds((current) => {
      const next = new Set(current);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  function addTargetSuburb(location: AdStudioTargetLocation) {
    onChangeTargeting?.([...targetSuburbs, location], includeSurroundingSuburbs);
    setTargetQuery("");
    setTargetSuggestions([]);
  }

  function removeTargetSuburb(key: string) {
    onChangeTargeting?.(targetSuburbs.filter((location) => location.key !== key), includeSurroundingSuburbs);
  }

  function chooseSurroundingSuburbs(value: boolean) {
    onChangeTargeting?.(targetSuburbs, value);
  }

  function buildControls(): MetaPublishControls {
    const start = new Date();
    const end = new Date(start);
    end.setDate(start.getDate() + durationDays);
    return {
      dailyBudgetMinorUnits: Math.max(1, Math.round(dailyBudgetAud * 100)),
      geo: campaignMode === "new" && targetSuburbs.length > 0
        ? { type: "cities", locations: targetSuburbs, includeSurroundingSuburbs: includeSurroundingSuburbs === true }
        : { type: "country", country: campaignPack.campaign.market.country },
      schedule: { startTime: start.toISOString(), endTime: end.toISOString() },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: [],
        instagramPositions: [],
      },
    };
  }

  async function handlePublishLive() {
    if (!allMet || selectionHint || !campaignStepReady || !destinationReady) return;
    setPublishing(true);
    setPublishError("");
    setPublishDone(false);
    setPublishPlanId(null);
    setPublishedVariantCount(null);

    try {
      const response = await fetch(`/api/adstudio/export-packages/${campaignId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignPack,
          controls: buildControls(),
          requestApproval: true,
          dryRun: false,
          ...(campaignMode === "existing" ? { existingMetaCampaignId: selectedMetaCampaignId } : {}),
          ...(fullSelection ? {} : { variantIds: selectedVariantIds }),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as PublishResponse;
      if (!response.ok) throw new Error(body.error ?? "Publish failed.");

      if (body.metaPublishPlan?.approvalRequestId && !body.triggerRunId) {
        setPublishMessage("Submitted for review");
        setPublishPlanId(body.metaPublishPlan.id ?? null);
        setPublishDone(true);
        return;
      }

      const queued = Boolean(body.triggerRunId) || body.metaPublishPlan?.status === "paused_live";
      if (!queued) {
        if (body.blockers?.length) throw new Error("Resolve the readiness items before publishing.");
        if (body.providerWritesEnabled === false) throw new Error("Live publishing is not enabled.");
        throw new Error("Meta did not confirm the publish request.");
      }

      if (!fullSelection) setPublishedVariantCount(body.metaPublishPlan?.variantIds?.length ?? selectedVariantIds.length);
      setPublishPlanId(body.metaPublishPlan?.id ?? null);
      setPublishMessage(body.metaPublishPlan?.status === "paused_live" ? "Live on Meta (paused)" : "Creating your paused ads");
      setPublishDone(true);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  const continueDisabled = stepIndex === 0
    ? !campaignStepReady
    : stepIndex === 1
      ? Boolean(selectionHint)
      : stepIndex === 2
        ? !destinationReady
        : false;

  return (
    <div className="studio-publish-flow">
      <nav className="studio-publish-stepnav" aria-label="Publish steps">
        {STEPS.map((step, index) => (
          <button
            key={step}
            type="button"
            className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""}
            aria-current={index === stepIndex ? "step" : undefined}
            onClick={() => setStepIndex(index)}
          >
            <span>{index < stepIndex ? <Check aria-hidden size={14} /> : index + 1}</span>
            {step}
          </button>
        ))}
      </nav>

      <div className="studio-publish-main">
        <div className="studio-publish-mobile-progress" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
          <span>{stepIndex + 1} / {STEPS.length}</span>
          <div><i style={{ transform: `scaleX(${(stepIndex + 1) / STEPS.length})` }} /></div>
        </div>

        <div className="studio-publish-content">
          {stepIndex === 0 && (
            <section className="studio-publish-screen" aria-labelledby="campaign-setup-title">
              <h1 id="campaign-setup-title">Campaign setup</h1>

              <div className="studio-segmented" aria-label="Campaign choice">
                <button type="button" className={campaignMode === "existing" ? "active" : ""} onClick={() => setCampaignMode("existing")}>
                  {campaignMode === "existing" && <Check aria-hidden size={15} />}
                  Use existing
                </button>
                <button type="button" className={campaignMode === "new" ? "active" : ""} onClick={() => setCampaignMode("new")}>
                  Create new
                </button>
              </div>

              {campaignMode === "existing" ? (
                <div className="studio-publish-choice">
                  <h2>Use an existing campaign</h2>
                  {metaCampaignsLoading ? (
                    <div className="studio-publish-loading"><RefreshCw aria-hidden size={17} /> Loading campaigns</div>
                  ) : (metaCampaigns?.campaigns?.length ?? 0) > 0 ? (
                    <div className="studio-campaign-list">
                      {metaCampaigns?.campaigns?.map((campaign) => {
                        const expanded = expandedMetaCampaignId === campaign.id;
                        return (
                          <article className={selectedMetaCampaignId === campaign.id ? "selected" : ""} key={campaign.id}>
                            <div className="studio-campaign-row">
                              <label>
                                <input
                                  type="radio"
                                  name="meta-campaign"
                                  value={campaign.id}
                                  checked={selectedMetaCampaignId === campaign.id}
                                  onChange={() => setSelectedMetaCampaignId(campaign.id)}
                                />
                                <span>{campaign.name}</span>
                              </label>
                              <span className={`studio-status-chip ${campaign.status}`}>{campaign.status}</span>
                              <button
                                type="button"
                                aria-label={`${expanded ? "Hide" : "Show"} details for ${campaign.name}`}
                                aria-expanded={expanded}
                                onClick={() => setExpandedMetaCampaignId(expanded ? "" : campaign.id)}
                              >
                                <ChevronDown aria-hidden size={17} />
                              </button>
                            </div>
                            {expanded && (
                              <dl className="studio-campaign-details">
                                <div><dt>Goal</dt><dd>Leads</dd></div>
                                <div><dt>Status</dt><dd>{capitalize(campaign.status)}</dd></div>
                                <div><dt>Updated</dt><dd>{formatDate(campaign.updatedAt ?? campaign.createdAt)}</dd></div>
                              </dl>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="studio-publish-empty">
                      <strong>No reusable lead campaigns</strong>
                      <span>{metaCampaigns?.issue ?? "Create a new campaign to continue."}</span>
                      {metaCampaigns?.issue && (
                        <button type="button" onClick={() => setMetaCampaignRefresh((value) => value + 1)}>Retry</button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="studio-publish-choice">
                  <h2>Create a new campaign</h2>
                  <div className="studio-new-campaign-row">
                    <span>{campaignPack.campaign.name}</span>
                    <span className="studio-status-chip paused">paused</span>
                  </div>

                  <div className="studio-targeting-setup">
                    <div className="studio-targeting-heading">
                      <strong>Target suburbs</strong>
                      <span>Choose every suburb this campaign should reach.</span>
                    </div>
                    {targetSuburbs.length > 0 && (
                      <div className="studio-targeting-chips" aria-label="Selected target suburbs">
                        {targetSuburbs.map((location) => (
                          <span key={location.key}>
                            {location.name}{location.region ? `, ${location.region}` : ""}
                            <button type="button" aria-label={`Remove ${location.name}`} onClick={() => removeTargetSuburb(location.key)}>
                              <X aria-hidden size={14} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="studio-targeting-search">
                      <label htmlFor="campaign-target-suburb">Search for a suburb</label>
                      <input
                        id="campaign-target-suburb"
                        type="search"
                        autoComplete="off"
                        value={targetQuery}
                        placeholder="Start typing a suburb"
                        aria-describedby={targetSuggestionsError ? "campaign-target-error" : undefined}
                        onChange={(event) => setTargetQuery(event.target.value)}
                      />
                      {targetSuggestionsLoading && <span className="studio-targeting-loading"><RefreshCw aria-hidden size={15} /> Searching Meta</span>}
                      {!targetSuggestionsLoading && targetSuggestions.length > 0 && (
                        <div className="studio-targeting-results" role="listbox" aria-label="Suburb suggestions">
                          {targetSuggestions.map((location) => (
                            <button key={location.key} type="button" role="option" aria-selected="false" onClick={() => addTargetSuburb(location)}>
                              <strong>{location.name}</strong>
                              <span>{location.region ?? "Australia"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {targetSuggestionsError && <p id="campaign-target-error" className="studio-field-error"><CircleAlert aria-hidden size={15} /> {targetSuggestionsError}</p>}
                    </div>

                    <fieldset className="studio-surrounding-choice">
                      <legend>Include surrounding suburbs?</legend>
                      <label className={includeSurroundingSuburbs === true ? "selected" : ""}>
                        <input type="radio" name="surrounding-suburbs" checked={includeSurroundingSuburbs === true} onChange={() => chooseSurroundingSuburbs(true)} />
                        <span><strong>Yes, include nearby suburbs</strong><small>Add a 10 km area around each selected suburb.</small></span>
                      </label>
                      <label className={includeSurroundingSuburbs === false ? "selected" : ""}>
                        <input type="radio" name="surrounding-suburbs" checked={includeSurroundingSuburbs === false} onChange={() => chooseSurroundingSuburbs(false)} />
                        <span><strong>No, selected suburbs only</strong><small>Keep targeting to the suburbs listed above.</small></span>
                      </label>
                    </fieldset>
                  </div>
                </div>
              )}

              <div className="studio-connection-row">
                <Building2 aria-hidden size={18} />
                <span>{metaCampaigns?.account?.name ?? "Meta Ads"} · {brandName}</span>
                <span className={metaCampaigns?.connected ? "studio-connected" : "studio-disconnected"}>
                  {metaCampaigns?.connected ? "Connected" : "Not connected"}
                </span>
                <Link href="/settings#connections">Settings</Link>
              </div>

              <details className="studio-publish-help">
                <summary>
                  <CircleHelp aria-hidden size={18} />
                  <span><strong>Questions about campaigns?</strong><small>Short answers and the full guide</small></span>
                  <ChevronDown aria-hidden size={17} />
                </summary>
                <div>
                  <p><b>Use existing</b> when it already has the same lead goal.</p>
                  <p><b>Create new</b> when the goal or setup is different.</p>
                  <Link href="/guides/sold-price-list-seller-leads">Read the campaign guide</Link>
                </div>
              </details>
            </section>
          )}

          {stepIndex === 1 && (
            <section className="studio-publish-screen" aria-labelledby="creatives-title">
              <h1 id="creatives-title">Creatives</h1>
              <div className="studio-creative-selection">
                {variants.map((variant) => (
                  <article className={!deselectedVariantIds.has(variant.variantId) ? "selected" : ""} key={variant.variantId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!deselectedVariantIds.has(variant.variantId)}
                        onChange={() => toggleVariant(variant.variantId)}
                      />
                      <span>{variant.angle}</span>
                    </label>
                    <details>
                      <summary>Details <ChevronDown aria-hidden size={16} /></summary>
                      <p>{variant.headline}</p>
                      <dl><div><dt>CTA</dt><dd>{variant.cta}</dd></div></dl>
                    </details>
                  </article>
                ))}
              </div>
              {selectionHint && <p className="studio-field-error"><CircleAlert aria-hidden size={15} /> {selectionHint}</p>}
            </section>
          )}

          {stepIndex === 2 && (
            <section className="studio-publish-screen" aria-labelledby="destination-title">
              <h1 id="destination-title">Destination</h1>
              <label className="studio-publish-field">
                <span>Destination URL</span>
                <input
                  type="url"
                  value={destinationUrl}
                  placeholder="https://your-agency.com.au/appraisal"
                  aria-invalid={destinationUrl.length > 0 && !destinationReady}
                  onChange={(event) => onChangeDestinationUrl?.(event.target.value)}
                  readOnly={!onChangeDestinationUrl}
                />
              </label>
              {destinationUrl.length > 0 && !destinationReady && <p className="studio-field-error">Enter a full http or https URL.</p>}
            </section>
          )}

          {stepIndex === 3 && (
            <section className="studio-publish-screen" aria-labelledby="budget-title">
              <h1 id="budget-title">Budget</h1>
              <div className="studio-publish-field-grid">
                <label className="studio-publish-field">
                  <span>Daily budget</span>
                  <select value={dailyBudgetAud} onChange={(event) => setDailyBudgetAud(Number(event.target.value))}>
                    <option value={10}>$10/day</option>
                    <option value={20}>$20/day</option>
                    <option value={50}>$50/day</option>
                  </select>
                </label>
                <label className="studio-publish-field">
                  <span>Duration</span>
                  <select value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))}>
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </label>
              </div>
              <div className="studio-publish-total"><span>Planned spend</span><strong>${dailyBudgetAud * durationDays} AUD</strong></div>
            </section>
          )}

          {stepIndex === 4 && (
            <section className="studio-publish-screen" aria-labelledby="review-title">
              <h1 id="review-title">Review</h1>
              <div className="studio-review-list">
                <div><span>Campaign</span><strong>{campaignMode === "existing" ? selectedCampaign?.name : campaignPack.campaign.name}</strong></div>
                <div><span>Creatives</span><strong>{selectedVariantIds.length}</strong></div>
                <div><span>Destination</span><strong>{destinationUrl}</strong></div>
                <div><span>Audience</span><strong>{campaignMode === "existing" ? "Existing campaign targeting" : formatTargetAudience(targetSuburbs, includeSurroundingSuburbs)}</strong></div>
                <div><span>Budget</span><strong>${dailyBudgetAud}/day · {durationDays} days</strong></div>
              </div>
              <details className="studio-readiness-details" open={!allMet}>
                <summary>
                  <span>Readiness</span>
                  <strong className={allMet ? "ready" : "needs-work"}>{readiness === null ? "Checking" : allMet ? "Ready" : `${blockingItems.length} to fix`}</strong>
                  <ChevronDown aria-hidden size={17} />
                </summary>
                <div>
                  {checklist.map((item) => (
                    <p key={item.id ?? item.label}>
                      {item.met ? <Check aria-hidden size={15} /> : <CircleAlert aria-hidden size={15} />}
                      {item.label}
                    </p>
                  ))}
                </div>
              </details>
              <button className="studio-btn secondary" type="button" onClick={onExport}><Download aria-hidden size={17} /> Export creatives</button>
              {exportStatus && exportStatus.length > 0 && (
                <div className="studio-export-status">
                  {exportStatus.map((item) => (
                    <div key={item.format}>
                      <span>{item.label}</span><strong>{capitalize(item.state)}</strong>
                      {item.state === "failed" && onRetryExportFormat && (
                        <button type="button" onClick={() => onRetryExportFormat(item.format)}>Retry</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {stepIndex === 5 && (
            <section className="studio-publish-screen studio-live-screen" aria-labelledby="live-title">
              <h1 id="live-title">Live</h1>
              {publishDone ? (
                <div className="studio-publish-success">
                  <span><Check aria-hidden size={24} /></span>
                  <strong>{publishMessage}</strong>
                  {publishedVariantCount && <small>{publishedVariantCount} creatives selected</small>}
                </div>
              ) : (
                <>
                  <div className={`studio-live-status ${allMet ? "ready" : "blocked"}`}>
                    {allMet ? <Check aria-hidden size={20} /> : <CircleAlert aria-hidden size={20} />}
                    <span><strong>{allMet ? "Ready to publish" : "Not ready"}</strong><small>{allMet ? "Ads will be created paused." : `${blockingItems.length} item${blockingItems.length === 1 ? "" : "s"} need attention.`}</small></span>
                  </div>
                  {publishError && <p className="studio-publish-error">{publishError}</p>}
                  <button
                    className="studio-btn publish studio-publish-live-button"
                    type="button"
                    disabled={!allMet || publishing || Boolean(selectionHint)}
                    onClick={handlePublishLive}
                  >
                    {publishing ? <RefreshCw aria-hidden size={17} /> : <Send aria-hidden size={17} />}
                    {publishing ? "Submitting" : needsApprovalReview ? "Send for review" : "Publish paused"}
                  </button>
                  {onlyBlockedProviderWrite && <button className="studio-btn secondary" type="button" onClick={onExport}>Export creatives</button>}
                </>
              )}

              {onDelete && (
                <details className="studio-campaign-options">
                  <summary>Campaign options <ChevronDown aria-hidden size={16} /></summary>
                  <button type="button" onClick={onDelete}><Trash2 aria-hidden size={15} /> Delete campaign</button>
                </details>
              )}
            </section>
          )}
        </div>

        <footer className="studio-publish-actions">
          {stepIndex === 0 ? (
            <Link href="/ad-studio"><ChevronLeft aria-hidden size={17} /> Back to Ad Studio</Link>
          ) : (
            <button type="button" className="studio-publish-back" onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>
              <ChevronLeft aria-hidden size={17} /> Back
            </button>
          )}
          {stepIndex < STEPS.length - 1 && (
            <button
              type="button"
              className="studio-publish-continue"
              disabled={continueDisabled}
              onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
            >
              Continue to {STEPS[stepIndex + 1]?.toLowerCase()} <ChevronRight aria-hidden size={17} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function capitalize(value: string) {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Not available"
    : new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatTargetAudience(locations: AdStudioTargetLocation[], includeSurroundingSuburbs: boolean | undefined) {
  if (locations.length === 0) return "No suburbs selected";
  const names = locations.map((location) => location.name).join(", ");
  return includeSurroundingSuburbs ? `${names} + nearby suburbs` : names;
}
