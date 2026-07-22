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
} from "lucide-react";

import type { AdStudioCampaignPack, AdStudioFormat } from "@/lib/adstudio";
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
  onExport: () => void;
  onDelete?: () => void;
  brandApproved?: boolean;
  exportStatus?: ExportFormatStatus[] | null;
  onRetryExportFormat?: (format: AdStudioFormat) => void;
};

const STEPS = ["Campaign setup", "Creatives", "Destination", "Budget", "Review", "Live"] as const;
const BUDGET_PRESETS = [10, 20, 50] as const;
const DURATION_PRESETS = [7, 14, 30] as const;

type ScheduleMode = `${(typeof DURATION_PRESETS)[number]}` | "custom" | "ongoing";

function formatLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToIso(value: string, endOfDay = false): string | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function PublishSetupPanel({
  campaignId,
  campaignPack,
  destinationUrl,
  onChangeDestinationUrl,
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
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("7");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

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
  const campaignStepReady = campaignMode === "new" || Boolean(selectedCampaign);
  const destinationReady = isWebUrl(destinationUrl);
  const selectedBudgetPreset = BUDGET_PRESETS.includes(dailyBudgetAud as (typeof BUDGET_PRESETS)[number])
    ? dailyBudgetAud
    : null;
  const parsedCustomStart = dateInputToIso(customStartDate);
  const parsedCustomEnd = dateInputToIso(customEndDate, true);
  const budgetError = Number.isFinite(dailyBudgetAud) && dailyBudgetAud >= 1
    ? ""
    : "Enter a daily budget of at least $1.";
  const scheduleError = scheduleMode === "custom"
    ? !parsedCustomStart || !parsedCustomEnd
      ? "Choose both a start date and an end date."
      : new Date(parsedCustomEnd).getTime() <= new Date(parsedCustomStart).getTime()
        ? "End date must be after the start date."
        : ""
    : "";
  const budgetStepReady = !budgetError && !scheduleError;
  const presetDurationDays = scheduleMode === "custom" || scheduleMode === "ongoing"
    ? null
    : Number(scheduleMode);
  const customDurationDays = parsedCustomStart && parsedCustomEnd
    ? Math.max(1, Math.ceil((new Date(parsedCustomEnd).getTime() - new Date(parsedCustomStart).getTime()) / 86_400_000))
    : null;
  const plannedSpend = !budgetError
    ? dailyBudgetAud * (presetDurationDays ?? customDurationDays ?? 0)
    : null;
  const scheduleSummary = scheduleMode === "ongoing"
    ? "Runs until stopped"
    : scheduleMode === "custom"
      ? customStartDate && customEndDate
        ? `${formatInputDate(customStartDate)} to ${formatInputDate(customEndDate)}`
        : "Custom dates"
      : `${scheduleMode} days`;

  function toggleVariant(variantId: string) {
    setDeselectedVariantIds((current) => {
      const next = new Set(current);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  function chooseSchedule(mode: ScheduleMode) {
    if (mode === "custom" && (!customStartDate || !customEndDate)) {
      const start = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      setCustomStartDate(formatLocalDateInput(start));
      setCustomEndDate(formatLocalDateInput(end));
    }
    setScheduleMode(mode);
  }

  function buildControls(): MetaPublishControls {
    const start = new Date();
    const end = new Date(start);
    if (presetDurationDays) end.setDate(start.getDate() + presetDurationDays);
    const startTime = scheduleMode === "custom" ? parsedCustomStart : start.toISOString();
    const endTime = scheduleMode === "ongoing"
      ? null
      : scheduleMode === "custom"
        ? parsedCustomEnd
        : end.toISOString();
    return {
      dailyBudgetMinorUnits: Math.max(1, Math.round(dailyBudgetAud * 100)),
      geo: { type: "country", country: campaignPack.campaign.market.country },
      schedule: { startTime, endTime },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: [],
        instagramPositions: [],
      },
    };
  }

  async function handlePublishLive() {
    if (!allMet || selectionHint || !campaignStepReady || !destinationReady || !budgetStepReady) return;
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
        : stepIndex === 3
          ? !budgetStepReady
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
          <div><i style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} /></div>
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
              <div className="studio-publish-summary-row"><span>Location</span><strong>{campaignPack.campaign.market.country}</strong></div>
            </section>
          )}

          {stepIndex === 3 && (
            <section className="studio-publish-screen" aria-labelledby="budget-title">
              <h1 id="budget-title">Budget</h1>

              <fieldset className="studio-budget-section">
                <legend>Daily budget <span>AUD</span></legend>
                <div className="studio-budget-presets" aria-label="Daily budget presets">
                  {BUDGET_PRESETS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      className={selectedBudgetPreset === amount ? "selected" : ""}
                      aria-pressed={selectedBudgetPreset === amount}
                      onClick={() => setDailyBudgetAud(amount)}
                    >
                      <strong>${amount}<small>/day</small></strong>
                      <span>{amount === 10 ? "Starter" : amount === 20 ? "Recommended" : "Stronger test"}</span>
                    </button>
                  ))}
                </div>
                <label className="studio-budget-amount">
                  <span>Enter amount</span>
                  <span className="studio-currency-input">
                    <i aria-hidden>$</i>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="decimal"
                      value={Number.isFinite(dailyBudgetAud) ? dailyBudgetAud : ""}
                      aria-invalid={Boolean(budgetError)}
                      aria-describedby={budgetError ? "budget-error" : undefined}
                      onChange={(event) => setDailyBudgetAud(event.target.value === "" ? Number.NaN : Number(event.target.value))}
                    />
                    <i aria-hidden>/ day</i>
                  </span>
                </label>
                {budgetError && <p className="studio-field-error" id="budget-error">{budgetError}</p>}
              </fieldset>

              <fieldset className="studio-budget-section">
                <legend>Schedule</legend>
                <div className="studio-duration-presets" aria-label="Schedule presets">
                  {DURATION_PRESETS.map((days) => {
                    const value = String(days) as ScheduleMode;
                    return (
                      <button
                        key={days}
                        type="button"
                        className={scheduleMode === value ? "selected" : ""}
                        aria-pressed={scheduleMode === value}
                        onClick={() => chooseSchedule(value)}
                      >
                        {days} days
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={scheduleMode === "custom" ? "selected" : ""}
                    aria-pressed={scheduleMode === "custom"}
                    onClick={() => chooseSchedule("custom")}
                  >
                    Custom dates
                  </button>
                </div>

                {scheduleMode === "custom" && (
                  <div className="studio-date-range">
                    <label>
                      <span>Start date</span>
                      <input
                        type="date"
                        value={customStartDate}
                        aria-invalid={Boolean(scheduleError)}
                        onChange={(event) => setCustomStartDate(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>End date</span>
                      <input
                        type="date"
                        min={customStartDate || undefined}
                        value={customEndDate}
                        aria-invalid={Boolean(scheduleError)}
                        aria-describedby={scheduleError ? "schedule-error" : undefined}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                      />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  className={`studio-run-ongoing ${scheduleMode === "ongoing" ? "selected" : ""}`}
                  aria-pressed={scheduleMode === "ongoing"}
                  onClick={() => chooseSchedule("ongoing")}
                >
                  <span aria-hidden />
                  <span><strong>Run until stopped</strong><small>No end date. Pause the campaign whenever you need to.</small></span>
                </button>
                {scheduleError && <p className="studio-field-error" id="schedule-error">{scheduleError}</p>}
              </fieldset>

              <div className="studio-publish-total">
                <span>{scheduleMode === "ongoing" ? "Daily spend limit" : "Planned spend"}</span>
                <strong>
                  {scheduleMode === "ongoing"
                    ? `$${Number.isFinite(dailyBudgetAud) ? dailyBudgetAud.toLocaleString("en-AU") : "—"} AUD / day`
                    : plannedSpend
                      ? `$${plannedSpend.toLocaleString("en-AU")} AUD`
                      : "—"}
                </strong>
              </div>
            </section>
          )}

          {stepIndex === 4 && (
            <section className="studio-publish-screen" aria-labelledby="review-title">
              <h1 id="review-title">Review</h1>
              <div className="studio-review-list">
                <div><span>Campaign</span><strong>{campaignMode === "existing" ? selectedCampaign?.name : campaignPack.campaign.name}</strong></div>
                <div><span>Creatives</span><strong>{selectedVariantIds.length}</strong></div>
                <div><span>Destination</span><strong>{destinationUrl}</strong></div>
                <div><span>Budget</span><strong>${dailyBudgetAud}/day · {scheduleSummary}</strong></div>
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

function formatInputDate(value: string) {
  const iso = dateInputToIso(value);
  return iso ? formatDate(iso) : value;
}
