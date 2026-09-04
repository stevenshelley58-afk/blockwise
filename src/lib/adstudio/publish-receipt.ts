import type { MetaPublishPlan } from "../providers/meta-execution";

export type PublishPlanSummary = {
  target: string;
  budgetMode: string;
  budget: string;
  audience: string;
  placements: string;
  schedule: string;
  destination: string;
  variants: string;
  fulfilment: string;
  activationConfirmation: string;
  usesExistingAdSetSettings: boolean;
};

export type PersistedPublishSource = {
  snapshotId: string | null;
  source: MetaPublishPlan["source"];
  publishedCreative: {
    feedPngPath: string | null;
    storyPngPath: string | null;
    primaryText: string;
    headline: string;
    description: string;
    cta: string;
  } | null;
};

/** Reconstruct the immutable creative/revision receipt from the persisted plan. */
export function summarizePersistedPublishSource(plan: MetaPublishPlan): PersistedPublishSource {
  const feed = plan.creatives.find((creative) => creative.localId === "creative_feed");
  const story = plan.creatives.find((creative) => creative.localId === "creative_story");
  const representative = feed ?? story;
  const storagePath = (creative: typeof representative): string | null =>
    creative?.asset?.source === "storage" ? creative.asset.storagePath ?? null : null;
  return {
    snapshotId: plan.publicationSnapshotId ?? plan.source?.snapshotId ?? null,
    source: plan.source ?? null,
    publishedCreative: representative ? {
      feedPngPath: storagePath(feed),
      storyPngPath: storagePath(story),
      primaryText: representative.primaryText,
      headline: representative.headline,
      description: representative.description,
      cta: representative.cta,
    } : null,
  };
}

/** Build receipt copy only from the normalized, persisted server plan. */
export function summarizePersistedPublishPlan(plan: MetaPublishPlan): PublishPlanSummary {
  const controls = plan.controls;
  const target = controls.target;
  const usesExistingAdSetSettings = target?.mode === "existing_adset";
  const budgetMode = usesExistingAdSetSettings
    ? "Existing ad set settings · unchanged"
    : controls.newCampaign?.budgetMode === "campaign"
      ? "Campaign budget (CBO)"
      : "Ad set budget (ABO)";
  const budget = usesExistingAdSetSettings
    ? "Unchanged in Meta"
    : formatMoney(plan.setup.currency, controls.dailyBudgetMinorUnits);

  return {
    target: target?.mode === "new_campaign_new_adset"
      ? "New campaign · new ad set"
      : target?.mode === "existing_campaign_new_adset"
        ? `Campaign ${shortId(target.campaignId)} · new ad set`
        : target?.mode === "existing_adset"
          ? `${target.adSetIds.length} existing ${target.adSetIds.length === 1 ? "ad set" : "ad sets"}`
          : "Not recorded",
    budgetMode,
    budget,
    audience: usesExistingAdSetSettings ? "Unchanged in Meta" : formatAudience(controls.geo),
    placements: usesExistingAdSetSettings ? "Unchanged in Meta" : formatPlacements(controls.placements),
    schedule: usesExistingAdSetSettings ? "Unchanged in Meta" : formatSchedule(controls.schedule, plan.setup.timezone),
    destination: controls.destinationUrl ?? "Not recorded",
    variants: (controls.variantIds ?? []).map((variant) => variant === "feed" ? "Feed" : "Story").join(" + ") || "Not recorded",
    fulfilment: controls.fulfilment?.exactOffer?.trim() || "No fulfilment promise",
    activationConfirmation: usesExistingAdSetSettings
      ? "Activate only the Blockwise-created ads; existing campaign and ad set settings remain unchanged."
      : `Activate the Blockwise-created objects using the reviewed ${budget} budget and targeting.`,
    usesExistingAdSetSettings,
  };
}

function formatMoney(currency: string, minorUnits: number | undefined): string {
  if (!minorUnits) return "Not recorded";
  try {
    return `${new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: currency || "AUD",
    }).format(minorUnits / 100)} per day`;
  } catch {
    return `${currency || "AUD"} ${(minorUnits / 100).toFixed(2)} per day`;
  }
}

function formatAudience(geo: MetaPublishPlan["controls"]["geo"]): string {
  if (!geo) return "Not recorded";
  if (geo.type === "country") return geo.country;
  if (geo.type === "custom_radius") {
    return `${geo.radiusKm} km around ${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`;
  }
  const places = geo.locations.map((location) => location.region
    ? `${location.name}, ${location.region}`
    : location.name).join(", ");
  return `${places}${geo.includeSurroundingSuburbs ? " · surrounding suburbs included" : ""}`;
}

function formatPlacements(placements: MetaPublishPlan["controls"]["placements"]): string {
  if (!placements) return "Not recorded";
  const values = [
    ...(placements.facebookPositions ?? []).map((value) => `Facebook ${value}`),
    ...(placements.instagramPositions ?? []).map((value) => `Instagram ${value}`),
  ];
  return values.join(", ") || (placements.publisherPlatforms ?? []).join(", ") || "Not recorded";
}

function formatSchedule(schedule: MetaPublishPlan["controls"]["schedule"], timezone: string): string {
  if (!schedule?.startTime) return "Not recorded";
  return schedule.endTime
    ? `${formatDate(schedule.startTime, timezone)} to ${formatDate(schedule.endTime, timezone)}`
    : `${formatDate(schedule.startTime, timezone)} · runs until you pause it`;
}

function formatDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleString("en-AU", { timeZone: timezone || "Australia/Perth" });
  } catch {
    return date.toLocaleString("en-AU");
  }
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
