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
  Download,
  Image as ImageIcon,
  Images,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";

import type { AdStudioCampaignPack, AdStudioFormat, AdStudioTargetLocation } from "@/lib/adstudio";
import type { AdStudioCreativeLibraryItem } from "@/lib/adstudio/creative-library";
import type { MetaPublishControls } from "@/lib/providers/meta-execution";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import type { ExportFormatStatus } from "../use-campaign-actions";

type ReadinessEntry = {
  id?: string;
  label: string;
  met: boolean;
  automatic?: boolean;
  blocked?: boolean;
};

type MetaCampaignsResponse = {
  connected?: boolean;
  account?: { id: string; name: string };
};

type MetaTargetingLocationsResponse = {
  locations?: AdStudioTargetLocation[];
  error?: string;
};

type PublishResponse = {
  publishReady?: boolean;
  blockers?: string[];
  providerWritesEnabled?: boolean;
  queueJobId?: string | null;
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
  queueStatus?: string | null;
  queueError?: string | null;
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
  creativeSource?: "current" | "library";
  initialStep?: number;
  destinationUrl: string;
  onChangeDestinationUrl?: (value: string) => void;
  onChangeTargeting?: (locations: AdStudioTargetLocation[], includeSurroundingSuburbs: boolean | undefined) => void;
  onChangeLeadForm?: (leadForm: { headline: string; questions: string[]; thankYouScreen: { title: string; body: string } }) => void;
  onExport: () => void;
  onDelete?: () => void;
  brandApproved?: boolean;
  exportStatus?: ExportFormatStatus[] | null;
  onRetryExportFormat?: (format: AdStudioFormat) => void;
};

const STEPS = ["Audience", "Ads", "Budget", "Review", "Live"] as const;
const BUDGET_PRESETS = [10, 20, 50] as const;
const DURATION_PRESETS = [3, 7] as const;
const MAX_LIBRARY_SELECTIONS = 6;

type DurationMode = `${(typeof DURATION_PRESETS)[number]}` | "custom";
type CustomDurationMode = "date" | "ongoing";

function formatDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateInputToEndOfDayIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function PublishSetupPanel({
  campaignId,
  campaignPack,
  creativeSource = "current",
  initialStep = 0,
  destinationUrl,
  onChangeDestinationUrl,
  onChangeTargeting,
  onChangeLeadForm,
  onExport,
  onDelete,
  brandApproved = true,
  exportStatus = null,
  onRetryExportFormat,
}: PublishSetupPanelProps) {
  const [stepIndex, setStepIndex] = useState(initialStep);
  const leadFormTemplate = campaignPack.copyPacks[0]?.meta.leadForm;
  const [leadForm, setLeadForm] = useState(() => ({
    headline: leadFormTemplate?.headline ?? "",
    questions: leadFormTemplate?.questions?.length ? [...leadFormTemplate.questions] : [],
    thankYouTitle: leadFormTemplate?.thankYouScreen.title ?? "",
    thankYouBody: leadFormTemplate?.thankYouScreen.body ?? "",
  }));
  const leadFormStepReady = leadForm.headline.trim().length > 0;
  function updateLeadForm(patch: Partial<typeof leadForm>) {
    setLeadForm((prev) => {
      const next = { ...prev, ...patch };
      onChangeLeadForm?.({
        headline: next.headline,
        questions: next.questions.filter((q) => q.trim()),
        thankYouScreen: { title: next.thankYouTitle, body: next.thankYouBody },
      });
      return next;
    });
  }
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaignsResponse | null>(null);
  const [readiness, setReadiness] = useState<ReadinessEntry[] | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishDone, setPublishDone] = useState(false);
  const [publishMessage, setPublishMessage] = useState("Published");
  const [publishPhase, setPublishPhase] = useState<"idle" | "creating" | "live" | "failed">("idle");
  const [publishPlanId, setPublishPlanId] = useState<string | null>(null);
  const [deselectedVariantIds, setDeselectedVariantIds] = useState<ReadonlySet<string>>(new Set());
  const [publishedVariantCount, setPublishedVariantCount] = useState<number | null>(null);
  const [dailyBudgetAud, setDailyBudgetAud] = useState(20);
  const [durationMode, setDurationMode] = useState<DurationMode>("3");
  const [customDurationMode, setCustomDurationMode] = useState<CustomDurationMode>("date");
  const [customEndDate, setCustomEndDate] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 7);
    return formatDateInputValue(end);
  });
  const [creativeLibrary, setCreativeLibrary] = useState<AdStudioCreativeLibraryItem[]>([]);
  const [creativeLibraryLoading, setCreativeLibraryLoading] = useState(creativeSource === "library");
  const [creativeLibraryError, setCreativeLibraryError] = useState("");
  const [creativeLibraryRefresh, setCreativeLibraryRefresh] = useState(0);
  const [selectedLibraryCampaignIds, setSelectedLibraryCampaignIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (creativeSource !== "library") return;
    let cancelled = false;
    setCreativeLibraryLoading(true);
    setCreativeLibraryError("");
    fetch("/api/adstudio/campaigns?include=creativeLibrary", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Your ad library could not be loaded.");
        return Array.isArray(body?.creativeLibrary) ? body.creativeLibrary as AdStudioCreativeLibraryItem[] : [];
      })
      .then((items) => {
        if (!cancelled) {
          setCreativeLibrary(items);
          const selectableCampaignIds = new Set(
            items.flatMap((item) => item.status === "unpublished" && item.variantId ? [item.campaignId] : []),
          );
          setSelectedLibraryCampaignIds((current) =>
            new Set([...current].filter((campaignId) => selectableCampaignIds.has(campaignId))),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCreativeLibraryError("We couldn't load your ads. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setCreativeLibraryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [creativeLibraryRefresh, creativeSource]);

  const [targetQuery, setTargetQuery] = useState("");
  const [targetSuggestions, setTargetSuggestions] = useState<AdStudioTargetLocation[]>([]);
  const [targetSuggestionsLoading, setTargetSuggestionsLoading] = useState(false);
  const [targetSuggestionsError, setTargetSuggestionsError] = useState("");

  const targetSuburbs = campaignPack.campaign.market.targetSuburbs ?? [];
  const targetSuburbKeys = targetSuburbs.map((location) => location.key).join("|");
  const includeSurroundingSuburbs = campaignPack.campaign.market.includeSurroundingSuburbs ?? true;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/adstudio/meta-campaigns")
      .then(async (response) => ({ response, body: (await response.json().catch(() => ({}))) as MetaCampaignsResponse }))
      .then(({ response, body }) => {
        if (cancelled) return;
        setMetaCampaigns(response.ok ? body : {});
      })
      .catch(() => {
        if (!cancelled) setMetaCampaigns({});
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
        })));
      })
      .catch(() => setReadiness([]));
  }, [campaignId]);

  useEffect(() => {
    if (!publishPlanId || !publishDone) return;

    const planId = publishPlanId;
    let cancelled = false;
    let ticks = 0;
    let fetchFailures = 0;
    let interval = 0;

    function stopPolling() {
      window.clearInterval(interval);
    }

    async function pollPlan() {
      ticks += 1;
      const response = await fetch(`/api/integrations/meta/publish-plans/${encodeURIComponent(planId)}`).catch(() => null);
      if (cancelled) return;

      if (!response?.ok) {
        fetchFailures += 1;
        // Don't spin forever when the status check itself keeps failing.
        if (fetchFailures >= 4) {
          stopPolling();
          setPublishDone(false);
          setPublishError("We couldn't confirm the publish status. Check Performance in a few minutes, or try again.");
          setPublishPhase("failed");
        }
        return;
      }
      fetchFailures = 0;
      const plan = (await response.json().catch(() => ({}))) as PublishPlanStatus;
      if (cancelled) return;

      if (plan.status === "failed" || plan.queueStatus === "failed") {
        stopPolling();
        setPublishDone(false);
        setPublishError(plan.queueError ?? plan.lastError ?? "Meta publish failed.");
        setPublishPhase("failed");
      } else if (plan.status === "paused_live") {
        stopPolling();
        setPublishMessage("Ad submitted");
        setPublishPhase("live");
      } else if (plan.status === "publishing" || plan.status === "approved") {
        const ads = plan.reconciledObjects?.ads ?? 0;
        setPublishMessage(ads > 0 ? `Creating ${ads} paused ad${ads === 1 ? "" : "s"} on Meta` : "Creating your paused ads on Meta");
        setPublishPhase("creating");
        // A publish normally completes well inside 5 minutes. Past that,
        // stop the spinner and be honest instead of spinning forever.
        if (ticks > 60) {
          stopPolling();
          setPublishDone(false);
          setPublishError("This is taking longer than expected. Check Performance in a few minutes. Your ad may still finish publishing.");
          setPublishPhase("failed");
        }
      } else if (plan.status === "draft") {
        // The plan was never queued (blockers or a queue failure) — surface it.
        if (ticks > 6) {
          stopPolling();
          setPublishDone(false);
          setPublishError("The publish did not start. Go back to Review and try again.");
          setPublishPhase("failed");
        }
      }
    }

    void pollPlan();
    interval = window.setInterval(() => void pollPlan(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [publishDone, publishPlanId]);

  const brandItem: ReadinessEntry | null = brandApproved
    ? null
    : { id: "brand_kit_approved", label: "Confirm brand kit", met: false };
  const checklist = [...(brandItem ? [brandItem] : []), ...(readiness ?? [])];
  const blockingItems = checklist.filter((item) => !item.met);
  const allMet = readiness !== null && blockingItems.length === 0;
  const variants = campaignPack.variants;
  const selectedVariantIds = variants.map((variant) => variant.variantId).filter((id) => !deselectedVariantIds.has(id));
  const fullSelection = selectedVariantIds.length === variants.length;
  const currentSelectionHint = selectedVariantIds.length === 0
    ? "Select at least one creative."
    : !fullSelection && selectedVariantIds.length > 3
      ? "Select up to three creatives."
      : "";
  const unpublishedCreativeLibrary = creativeLibrary.filter(
    (item): item is AdStudioCreativeLibraryItem & { variantId: string } =>
      item.status === "unpublished" && Boolean(item.variantId),
  );
  const selectedLibraryItems = unpublishedCreativeLibrary.filter(
    (item) => selectedLibraryCampaignIds.has(item.campaignId) && item.variantId,
  );
  const librarySelectionHint = selectedLibraryItems.length === 0
    ? "Select at least one creative."
    : "";
  const selectionHint = creativeSource === "library" ? librarySelectionHint : currentSelectionHint;
  const selectedCreativeCount = creativeSource === "library" ? selectedLibraryItems.length : selectedVariantIds.length;
  const brandName = campaignPack.brandKit.identity.tradingName?.trim()
    || campaignPack.brandKit.identity.businessName
    || "Your brand";
  const audienceReady = targetSuburbs.length > 0;
  const campaignStepReady = audienceReady;
  const destinationReady = isWebUrl(destinationUrl);
  const creativeStepReady = !selectionHint;
  const selectedBudgetPreset = BUDGET_PRESETS.includes(dailyBudgetAud as (typeof BUDGET_PRESETS)[number])
    ? dailyBudgetAud
    : null;
  const budgetError = Number.isFinite(dailyBudgetAud) && dailyBudgetAud >= 1
    ? ""
    : "Enter a daily budget of at least $1.";
  const customEndTime = durationMode === "custom" && customDurationMode === "date"
    ? dateInputToEndOfDayIso(customEndDate)
    : null;
  const scheduleError = durationMode === "custom" && customDurationMode === "date"
    ? !customEndTime
      ? "Choose an end date."
      : new Date(customEndTime).getTime() <= Date.now()
        ? "Choose a future end date."
        : ""
    : "";
  const budgetStepReady = !budgetError && !scheduleError;
  const publishReady = allMet
    && campaignStepReady
    && creativeStepReady
    && leadFormStepReady
    && destinationReady
    && budgetStepReady;
  const plannedDurationDays = durationMode === "custom"
    ? customDurationMode === "date" && customEndTime
      ? Math.max(1, Math.ceil((new Date(customEndTime).getTime() - Date.now()) / 86_400_000))
      : null
    : Number(durationMode);
  const plannedSpend = !budgetError && plannedDurationDays
    ? dailyBudgetAud * plannedDurationDays
    : null;
  const scheduleSummary = durationMode === "custom"
    ? customDurationMode === "ongoing"
      ? "Until stopped"
      : customEndTime
        ? `Until ${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(customEndTime))}`
        : "Choose an end date"
    : `${durationMode} days`;
  const minimumEndDate = (() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateInputValue(tomorrow);
  })();

  function toggleVariant(variantId: string) {
    setDeselectedVariantIds((current) => {
      const next = new Set(current);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  function toggleLibraryCreative(campaignId: string) {
    setSelectedLibraryCampaignIds((current) => {
      const next = new Set(current);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else if (next.size < MAX_LIBRARY_SELECTIONS) {
        next.add(campaignId);
      }
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

  function buildControls(): MetaPublishControls {
    const start = new Date();
    const presetDuration = durationMode === "custom" ? null : Number(durationMode);
    const presetEnd = presetDuration ? new Date(start) : null;
    if (presetEnd && presetDuration) presetEnd.setDate(start.getDate() + presetDuration);
    const endTime = durationMode === "custom"
      ? customDurationMode === "ongoing" ? null : customEndTime
      : presetEnd?.toISOString() ?? null;
    return {
      dailyBudgetMinorUnits: Math.max(1, Math.round(dailyBudgetAud * 100)),
      destinationUrl,
      geo: targetSuburbs.length > 0
        ? { type: "cities", locations: targetSuburbs, includeSurroundingSuburbs: true }
        : { type: "country", country: campaignPack.campaign.market.country },
      schedule: { startTime: start.toISOString(), endTime },
      placements: {
        publisherPlatforms: ["facebook", "instagram"],
        facebookPositions: [],
        instagramPositions: [],
      },
    };
  }

  async function handlePublishLive(): Promise<boolean> {
    if (!publishReady) return false;
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
          dryRun: false,
          ...(creativeSource === "library"
            ? {
                librarySelections: selectedLibraryItems.map((item) => ({
                  campaignId: item.campaignId,
                  variantId: item.variantId,
                })),
              }
            : fullSelection
              ? {}
              : { variantIds: selectedVariantIds }),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as PublishResponse;
      if (!response.ok) throw new Error(body.error ?? "Publish failed.");

      if (body.providerWritesEnabled === false) throw new Error("Live publishing is not enabled yet. Export your creatives to launch manually.");

      const planStatus = body.metaPublishPlan?.status;
      const queued = Boolean(body.queueJobId) || planStatus === "paused_live" || planStatus === "publishing";
      if (!queued) {
        // The server declined to queue the publish — show the real blockers
        // instead of pretending the submission is in progress.
        if (body.blockers?.length) throw new Error(body.blockers.join(" "));
        throw new Error("Meta did not confirm the publish request.");
      }

      if (!fullSelection) setPublishedVariantCount(body.metaPublishPlan?.variantIds?.length ?? selectedVariantIds.length);
      setPublishPlanId(body.metaPublishPlan?.id ?? null);
      setPublishMessage(planStatus === "paused_live" ? "Ad submitted" : "Creating your paused ads on Meta");
      setPublishDone(true);
      setPublishPhase(planStatus === "paused_live" ? "live" : "creating");
      return true;
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Publish failed.");
      setPublishDone(false);
      setPublishPhase("failed");
      return false;
    } finally {
      setPublishing(false);
    }
  }

  async function handlePublishAndAdvance() {
    const accepted = await handlePublishLive();
    if (accepted) {
      setStepIndex((index) => Math.min(STEPS.length - 1, index + 1));
    }
  }

  const continueDisabled = stepIndex === 0
    ? !campaignStepReady || !destinationReady
    : stepIndex === 1
      ? !creativeStepReady
      : stepIndex === 2
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
          <div><i style={{ transform: `scaleX(${(stepIndex + 1) / STEPS.length})` }} /></div>
        </div>

        <div className="studio-publish-content">
          {stepIndex === 0 && (
            <section className="studio-publish-screen" aria-labelledby="campaign-setup-title">
              <h1 id="campaign-setup-title">Choose your audience</h1>
              <p className="m-0 text-sm leading-6 text-(--muted)">
                Blockwise will create and manage a new Meta leads campaign using our recommended real-estate settings.
              </p>

              <div className="grid gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--ink) text-white"><Building2 aria-hidden size={18} /></span>
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="text-sm text-(--ink)">Blockwise Campaign</strong>
                    <small className="text-xs font-semibold text-(--muted)">Leads · Housing · Facebook and Instagram</small>
                  </span>
                  <span className="ml-auto rounded-full bg-(--ui-success-soft) px-2.5 py-1 text-[11px] font-bold text-(--ui-success)">Managed for you</span>
                </div>
                <p className="m-0 text-[13px] leading-5 text-(--muted)">
                  We set the bidding, placements, lead optimization and campaign structure. You only confirm who should see the ads and where enquiries should go.
                </p>
              </div>

              <div className="studio-targeting-setup">
                <div className="studio-targeting-heading">
                  <strong>Target suburbs</strong>
                  <span>Choose every suburb this ad set should reach.</span>
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

                <div className="flex items-start gap-2 rounded-(--r-card) bg-(--surface-subtle) px-3 py-2.5 text-[13px] leading-5 text-(--muted)">
                  <Check aria-hidden className="mt-0.5 shrink-0 text-(--ui-success)" size={16} />
                  <span><strong className="text-(--ink)">Nearby areas included automatically.</strong> Blockwise uses Meta's housing-safe 25 km area around each selected suburb.</span>
                </div>
              </div>

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

              <div className="studio-connection-row">
                <Building2 aria-hidden size={18} />
                <span>{metaCampaigns?.account?.name ?? "Meta Ads"} · {brandName}</span>
                <span className={metaCampaigns?.connected ? "studio-connected" : "studio-disconnected"}>
                  {metaCampaigns?.connected ? "Connected" : "Not connected"}
                </span>
                {metaCampaigns?.connected ? (
                  <Link href="/settings#connections">Settings</Link>
                ) : (
                  <Link href="/connect-meta">Connect Meta</Link>
                )}
              </div>

            </section>
          )}

          {stepIndex === 1 && (
            <section className="studio-publish-screen" aria-labelledby="creatives-title">
              <h1 id="creatives-title">Creatives</h1>
              {creativeSource === "current" ? (
                <>
                  <div className="studio-creative-intro">
                    <strong>Current ad</strong>
                    <span>This is the ad you were working on. Check the artwork before continuing.</span>
                  </div>
                  <div className="studio-creative-selection studio-creative-selection-visual">
                    {variants.map((variant) => {
                      const preview = previewForVariant(campaignPack, variant.variantId);
                      const selected = !deselectedVariantIds.has(variant.variantId);
                      return (
                        <article className={selected ? "selected" : ""} key={variant.variantId}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleVariant(variant.variantId)}
                            />
                            <span>{variant.angle}</span>
                            <em>Current ad</em>
                          </label>
                          <div className="studio-current-creative">
                            <CreativeThumbnail src={preview?.src ?? null} alt={`${variant.angle} ad preview`} />
                            <div>
                              <strong>{variant.headline}</strong>
                              <dl>
                                <div><dt>Format</dt><dd>{preview?.format ? formatCreativeFormat(preview.format) : "Feed"}</dd></div>
                                <div><dt>CTA</dt><dd>{variant.cta}</dd></div>
                              </dl>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {selectionHint && <p className="studio-field-error"><CircleAlert aria-hidden size={15} /> {selectionHint}</p>}
                </>
              ) : (
                <div className="studio-ad-library" aria-live="polite">
                  <div className="studio-creative-intro">
                    <strong>Reuse an existing ad</strong>
                    <span>Select one or more unpublished ads to run together.</span>
                  </div>
                  <p className="m-0 rounded-(--r-card) bg-(--surface-subtle) px-3 py-2.5 text-[13px] leading-5 text-(--muted)">
                    All selected creatives will be added to{" "}
                    <strong className="font-bold text-(--ink)">a new Blockwise Campaign</strong>.
                  </p>
                  {creativeLibraryLoading ? (
                    <div className="studio-ad-library-loading" role="status">
                      <RefreshCw aria-hidden size={18} />
                      <span>Loading your ads</span>
                    </div>
                  ) : creativeLibraryError ? (
                    <div className="studio-publish-empty">
                      <strong>Ads couldn't be loaded</strong>
                      <span>{creativeLibraryError}</span>
                      <button type="button" onClick={() => setCreativeLibraryRefresh((value) => value + 1)}>Try again</button>
                    </div>
                  ) : unpublishedCreativeLibrary.length === 0 ? (
                    <div className="studio-publish-empty">
                      <strong>No unpublished ads</strong>
                      <span>Open the full library to review published ads or create another ad.</span>
                    </div>
                  ) : (
                    <div className="studio-ad-library-list">
                      {unpublishedCreativeLibrary.map((item) => {
                        const selected = selectedLibraryCampaignIds.has(item.campaignId);
                        const disabled = !selected && selectedLibraryCampaignIds.size >= MAX_LIBRARY_SELECTIONS;
                        return (
                        <article
                          className={selected ? "bg-(--surface-subtle)/55" : ""}
                          key={item.campaignId}
                        >
                          <CreativeThumbnail src={item.previewSrc} alt={`${item.name} ad preview`} compact />
                          <div className="studio-ad-library-copy">
                            <strong title={item.name}>{item.name}</strong>
                            <span>{item.format ? formatCreativeFormat(item.format) : "Ad creative"}</span>
                          </div>
                          <span className={`studio-library-status ${item.status}`}>{capitalize(item.status)}</span>
                          <time dateTime={item.updatedAt ?? undefined}>Updated {formatDate(item.updatedAt)}</time>
                          <div className="flex min-h-11 items-center justify-end gap-3 max-[900px]:[grid-area:action]">
                            <span className="whitespace-nowrap text-xs font-bold text-(--ink)">Use this ad</span>
                            <Checkbox
                              className="relative size-5 before:absolute before:-inset-3 before:content-['']"
                              checked={selected}
                              disabled={disabled}
                              aria-label={`Use ${item.name}`}
                              onCheckedChange={() => toggleLibraryCreative(item.campaignId)}
                            />
                          </div>
                        </article>
                      )})}
                    </div>
                  )}
                  {selectedLibraryCampaignIds.size >= MAX_LIBRARY_SELECTIONS && (
                    <p className="studio-field-error">
                      <CircleAlert aria-hidden size={15} /> Select up to six creatives for one campaign.
                    </p>
                  )}
                  <Button asChild variant="outline" size="lg" className="justify-self-start">
                    <Link href="/ad-studio/library"><Images aria-hidden /> View full library</Link>
                  </Button>
                </div>
              )}
              {creativeSource === "library" && selectionHint && (
                <p className="studio-field-error"><CircleAlert aria-hidden size={15} /> {selectionHint}</p>
              )}
            </section>
          )}

          {stepIndex === 2 && (
            <section className="studio-publish-screen" aria-labelledby="budget-title">
              <h1 id="budget-title">Budget</h1>
              <p className="m-0 text-sm leading-6 text-(--muted)">
                Choose how much to spend each day and how long the campaign should run.
              </p>

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
                <legend>Duration</legend>
                <div className="studio-budget-presets" aria-label="Campaign duration">
                  {DURATION_PRESETS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={durationMode === String(days) ? "selected" : ""}
                      aria-pressed={durationMode === String(days)}
                      onClick={() => setDurationMode(String(days) as DurationMode)}
                    >
                      <strong>{days} days</strong>
                      <span>{days === 3 ? "Quick test" : "More time to learn"}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={durationMode === "custom" ? "selected" : ""}
                    aria-pressed={durationMode === "custom"}
                    onClick={() => setDurationMode("custom")}
                  >
                    <strong>Custom</strong>
                    <span>Choose when it ends</span>
                  </button>
                </div>

                {durationMode === "custom" && (
                  <div className="grid gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
                    <div className="grid gap-2">
                      <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-(--ink)">
                        <input
                          className="accent-(--ui-primary)"
                          type="radio"
                          name="custom-duration"
                          value="date"
                          checked={customDurationMode === "date"}
                          onChange={() => setCustomDurationMode("date")}
                        />
                        End on a date
                      </label>
                      <input
                        className="h-11 w-full rounded-(--r-card) border border-(--line) bg-(--surface) px-3 text-sm text-(--ink) disabled:cursor-not-allowed disabled:opacity-50"
                        type="date"
                        min={minimumEndDate}
                        value={customEndDate}
                        disabled={customDurationMode !== "date"}
                        aria-label="Campaign end date"
                        aria-invalid={Boolean(scheduleError)}
                        aria-describedby={scheduleError ? "schedule-error" : undefined}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-(--ink)">
                      <input
                        className="accent-(--ui-primary)"
                        type="radio"
                        name="custom-duration"
                        value="ongoing"
                        checked={customDurationMode === "ongoing"}
                        onChange={() => setCustomDurationMode("ongoing")}
                      />
                      Run until stopped
                    </label>
                  </div>
                )}
                {scheduleError && <p className="studio-field-error" id="schedule-error">{scheduleError}</p>}
              </fieldset>

              <div className="studio-publish-total">
                <span>{plannedDurationDays ? "Estimated maximum spend" : "Estimated total spend"}</span>
                <strong>{plannedSpend !== null ? `$${plannedSpend.toLocaleString("en-AU")} AUD` : "No fixed total"}</strong>
              </div>
            </section>
          )}

          {stepIndex === 3 && (
            <section className="studio-publish-screen" aria-labelledby="review-title">
              <h1 id="review-title">Review</h1>
              <div className="studio-review-list">
                <div><span>Campaign</span><strong>Blockwise Campaign</strong></div>
                <div><span>Creatives</span><strong>{selectedCreativeCount}</strong></div>
                <div><span>Lead form</span><strong>Prepared for you</strong></div>
                <div><span>Audience</span><strong>{formatTargetAudience(targetSuburbs, includeSurroundingSuburbs)}</strong></div>
                <div><span>Budget</span><strong>${dailyBudgetAud}/day · {scheduleSummary}</strong></div>
              </div>
              <details className="studio-readiness-details">
                <summary>
                  <span>Lead form</span>
                  <strong className={leadFormStepReady ? "ready" : "needs-work"}>{leadFormStepReady ? "Blockwise default" : "Needs attention"}</strong>
                  <ChevronDown aria-hidden size={17} />
                </summary>
                <div className="grid gap-4">
                  <p className="m-0 text-[13px] leading-5 text-(--muted)">Name, email and phone are collected automatically. You can edit the generated form if needed.</p>
                  <label className="studio-publish-field">
                    <span>Form headline</span>
                    <input
                      type="text"
                      value={leadForm.headline}
                      placeholder="Request the property details"
                      aria-invalid={!leadForm.headline.trim()}
                      onChange={(event) => updateLeadForm({ headline: event.target.value })}
                    />
                  </label>
                  <div className="studio-leadform-questions">
                    <strong>Extra questions</strong>
                    {leadForm.questions.map((question, index) => (
                      <div className="studio-leadform-q-row" key={index}>
                        <input
                          type="text"
                          value={question}
                          placeholder="e.g. What is your best contact number?"
                          onChange={(event) => {
                            const questions = [...leadForm.questions];
                            questions[index] = event.target.value;
                            updateLeadForm({ questions });
                          }}
                        />
                        <button type="button" className="studio-leadform-del" aria-label={`Remove question ${index + 1}`} onClick={() => {
                          updateLeadForm({ questions: leadForm.questions.filter((_, itemIndex) => itemIndex !== index) });
                        }}>&times;</button>
                      </div>
                    ))}
                    {leadForm.questions.length < 5 && (
                      <button type="button" className="studio-leadform-add" onClick={() => updateLeadForm({ questions: [...leadForm.questions, ""] })}>+ Add a question</button>
                    )}
                  </div>
                </div>
              </details>
              <details className="studio-readiness-details" open={!allMet}>
                <summary>
                  <span>Readiness</span>
                  <strong className={allMet ? "ready" : "needs-work"}>{readiness === null ? "Checking" : allMet ? "Ready" : blockingItems.map((item) => item.label).join(", ")}</strong>
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
              {creativeSource === "library" && selectedLibraryItems.length > 0 && (
                <div className="studio-review-creatives">
                  <strong>Your {selectedLibraryItems.length === 1 ? "ad" : "ads"}</strong>
                  <div className="grid gap-2">
                    {selectedLibraryItems.map((item) => (
                      <article
                        className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-(--r-card) border border-(--line) p-2.5"
                        key={item.campaignId}
                      >
                        <CreativeThumbnail src={item.previewSrc} alt={`${item.name} ad preview`} compact />
                        <div className="grid min-w-0 gap-1">
                          <strong className="truncate text-sm">{item.name}</strong>
                          <span className="text-xs font-semibold text-(--muted)">
                            {item.format ? formatCreativeFormat(item.format) : "Ad creative"}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              {creativeSource === "current" && variants.length > 0 && (
                <div className="studio-review-creatives">
                  <strong>Your {selectedVariantIds.length === 1 ? "ad" : "ads"}</strong>
                  <div className="studio-creative-selection studio-creative-selection-visual">
                    {variants.filter((variant) => !deselectedVariantIds.has(variant.variantId)).map((variant) => {
                      const preview = previewForVariant(campaignPack, variant.variantId);
                      return (
                        <article key={variant.variantId}>
                          <div className="studio-current-creative">
                            <CreativeThumbnail src={preview?.src ?? null} alt={`${variant.angle} ad preview`} />
                            <div>
                              <strong>{variant.headline}</strong>
                              <dl>
                                <div><dt>Format</dt><dd>{preview?.format ? formatCreativeFormat(preview.format) : "Feed"}</dd></div>
                                <div><dt>CTA</dt><dd>{variant.cta}</dd></div>
                              </dl>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
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
              {publishError && stepIndex === 3 && <p className="studio-publish-error">{publishError}</p>}
            </section>
          )}

          {stepIndex === 4 && (
            <section className="studio-publish-screen studio-live-screen" aria-labelledby="live-title">
              <h1 id="live-title">Live</h1>
              {publishPhase === "idle" && !publishDone && !publishing && (
                <div className="studio-live-status blocked">
                  <CircleAlert aria-hidden size={20} />
                  <span><strong>Not submitted yet</strong><small>Go back to Review and submit your ad to Meta.</small></span>
                </div>
              )}
              {publishing && (
                <div className="studio-live-progress">
                  <span className="studio-live-spinner"><RefreshCw aria-hidden size={24} /></span>
                  <strong>Submitting to Meta...</strong>
                  <small>Sending your campaign, creatives, and lead form.</small>
                </div>
              )}
              {publishPhase === "creating" && (
                <div className="studio-live-progress">
                  <span className="studio-live-spinner"><RefreshCw aria-hidden size={24} /></span>
                  <strong>{publishMessage || "Creating your paused ads on Meta..."}</strong>
                  <small>Building campaign, ad sets, and creatives. This takes a moment.</small>
                </div>
              )}
              {publishPhase === "live" && (
                <div className="studio-publish-success">
                  <span><Check aria-hidden size={24} /></span>
                  <strong>Ad submitted</strong>
                  {publishedVariantCount && <small>{publishedVariantCount} creatives submitted to Meta</small>}
                  <Link href="/results" className="studio-btn publish studio-live-results-btn">View in Performance <ChevronRight aria-hidden size={17} /></Link>
                </div>
              )}
              {publishPhase === "failed" && !publishing && (
                <>
                  <div className="studio-live-status blocked">
                    <CircleAlert aria-hidden size={20} />
                    <span><strong>Publish failed</strong><small>{publishError || "Something went wrong submitting to Meta."}</small></span>
                  </div>
                  <button className="studio-btn publish studio-publish-retry" type="button" disabled={publishing} onClick={() => void handlePublishLive()}><Send aria-hidden size={17} /> Try again</button>
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
              disabled={stepIndex === 3 ? (!publishReady || publishing) : continueDisabled}
              onClick={stepIndex === 3 ? () => void handlePublishAndAdvance() : () => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
            >
              {stepIndex === 3 ? <>{publishing ? <RefreshCw aria-hidden size={17} /> : <Send aria-hidden size={17} />} {publishing ? "Submitting..." : "Launch campaign"} <ChevronRight aria-hidden size={17} /></> : <>Continue to {STEPS[stepIndex + 1]?.toLowerCase()} <ChevronRight aria-hidden size={17} /></>}
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

function CreativeThumbnail({ src, alt, compact = false }: { src: string | null; alt: string; compact?: boolean }) {
  return (
    <div className={`studio-creative-thumbnail${compact ? " compact" : ""}`}>
      <span><ImageIcon aria-hidden size={compact ? 17 : 22} /> Preview unavailable</span>
      {src && (
        <img
          src={src}
          alt={alt}
          loading={compact ? "lazy" : "eager"}
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      )}
    </div>
  );
}

function previewForVariant(pack: AdStudioCampaignPack, variantId: string): { src: string; format: AdStudioFormat } | null {
  const creative = pack.creatives.find((item) => item.variantId === variantId && item.format === "4:5")
    ?? pack.creatives.find((item) => item.variantId === variantId);
  if (!creative) return null;
  const imageObject = creative.canvas.objects.find((object) => object.role === "primary_image");
  const imageSource = imageObject?.content || imageObject?.assetId;
  if (imageSource) return { src: imageSource, format: creative.format };
  if (!creative.previewSvg) return null;
  return {
    src: creative.previewSvg.startsWith("data:image/")
      ? creative.previewSvg
      : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(creative.previewSvg)}`,
    format: creative.format,
  };
}

function formatCreativeFormat(format: string) {
  if (format === "4:5") return "Feed · 1080 × 1350";
  if (format === "9:16") return "Story · 1080 × 1920";
  return format;
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
