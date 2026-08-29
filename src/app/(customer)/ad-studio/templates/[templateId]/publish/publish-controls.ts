import type { MetaPublishControls, MetaPublishTarget } from "@/lib/providers/meta-execution";

export const MIN_META_RADIUS_KM = 25;

export type PublishTargetMode =
  | "new_campaign_new_adset"
  | "existing_campaign_new_adset"
  | "existing_adset";

export type AudienceMode = "" | "saved_locations" | "custom_radius";
export type ScheduleStartIntent = "" | "as_soon_as_activated" | "scheduled";
export type ScheduleEndIntent = "" | "run_until_paused" | "scheduled";
export type PlacementChoice =
  | "facebook_feed"
  | "facebook_story"
  | "instagram_feed"
  | "instagram_story";

export type PublishAudienceLocation = {
  key: string;
  name: string;
  region: string | null;
};

export type PublishSetupSummary = {
  target: string;
  budget: string;
  audience: string;
  placements: string;
  schedule: string;
  destination: string;
  activationConfirmation: string;
  usesExistingAdSetSettings: boolean;
};

export type ExplicitPublishControlsDraft = {
  destinationMode: "website" | "instant_form";
  destinationUrl: string;
  targetMode: PublishTargetMode;
  campaignId: string;
  adSetIds: string[];
  variantIds: Array<"feed" | "story">;
  dailyBudgetDollars: string;
  audienceMode: AudienceMode;
  availableLocations: PublishAudienceLocation[];
  selectedLocationKeys: string[];
  includeSurroundingSuburbs: boolean;
  latitude: string;
  longitude: string;
  radiusKm: string;
  placementChoices: PlacementChoice[];
  startIntent: ScheduleStartIntent;
  startAt: string;
  endIntent: ScheduleEndIntent;
  endAt: string;
  setupConfirmed: boolean;
};

export type ExplicitPublishControlsResult =
  | { controls: MetaPublishControls; issues: []; summary: PublishSetupSummary }
  | { controls: null; issues: string[]; summary: null };

/**
 * Build only controls the customer explicitly supplied and confirmed.
 * New ad sets never receive provider defaults; existing ad sets deliberately
 * omit parent-owned settings so their live Meta configuration stays intact.
 */
export function buildExplicitMetaPublishControls(
  draft: ExplicitPublishControlsDraft,
): ExplicitPublishControlsResult {
  const issues: string[] = [];
  const destinationUrl = draft.destinationUrl.trim();
  if (!validHttpsUrl(destinationUrl)) {
    issues.push(
      draft.destinationMode === "instant_form"
        ? "Add a valid HTTPS thank-you destination URL."
        : "Add a valid HTTPS article or website destination URL.",
    );
  }

  if (draft.variantIds.length === 0) {
    issues.push("Choose at least one creative variant.");
  }

  const target = buildTarget(draft, issues);
  if (draft.targetMode === "existing_adset") {
    if (!draft.setupConfirmed) {
      issues.push("Confirm that the selected ad sets keep their live Meta settings.");
    }
    if (!target || issues.length > 0) return { controls: null, issues, summary: null };

    const controls: MetaPublishControls = {
      target,
      destinationMode: draft.destinationMode,
      destinationUrl,
      variantIds: draft.variantIds,
    };
    return {
      controls,
      issues: [],
      summary: {
        target: `${draft.adSetIds.length} existing ${draft.adSetIds.length === 1 ? "ad set" : "ad sets"}`,
        budget: "Unchanged in Meta",
        audience: "Unchanged in Meta",
        placements: "Unchanged in Meta",
        schedule: "Unchanged in Meta",
        destination: destinationUrl,
        activationConfirmation:
          "I confirm these ads will use the existing ad set budgets, audiences, placements and schedules when activated.",
        usesExistingAdSetSettings: true,
      },
    };
  }

  const dailyBudgetMinorUnits = parseDailyBudget(draft.dailyBudgetDollars);
  if (dailyBudgetMinorUnits === null) {
    issues.push("Enter a daily budget greater than A$0.00.");
  }

  const audience = buildAudience(draft, issues);
  const placements = buildPlacements(draft.placementChoices, issues);
  const schedule = buildSchedule(draft, issues);
  if (!draft.setupConfirmed) {
    issues.push("Confirm the budget, audience, placements and schedule.");
  }

  if (!target || dailyBudgetMinorUnits === null || !audience || !placements || !schedule || issues.length > 0) {
    return { controls: null, issues, summary: null };
  }

  const controls: MetaPublishControls = {
    target,
    destinationMode: draft.destinationMode,
    destinationUrl,
    variantIds: draft.variantIds,
    dailyBudgetMinorUnits,
    geo: audience.geo,
    placements: placements.value,
    schedule: schedule.value,
  };

  return {
    controls,
    issues: [],
    summary: {
      target:
        draft.targetMode === "new_campaign_new_adset"
          ? "New campaign · new ad set"
          : `Campaign ${shortId(draft.campaignId)} · new ad set`,
      budget: `${formatAud(dailyBudgetMinorUnits)} per day`,
      audience: audience.label,
      placements: placements.label,
      schedule: schedule.label,
      destination: destinationUrl,
      activationConfirmation: `I confirm Meta can spend up to ${formatAud(dailyBudgetMinorUnits)} per day for this ad set once I activate it.`,
      usesExistingAdSetSettings: false,
    },
  };
}

function buildTarget(
  draft: ExplicitPublishControlsDraft,
  issues: string[],
): MetaPublishTarget | null {
  const campaignId = draft.campaignId.trim();
  if (draft.targetMode === "new_campaign_new_adset") {
    return { mode: draft.targetMode };
  }
  if (!campaignId) {
    issues.push("Add the existing campaign ID.");
    return null;
  }
  if (draft.targetMode === "existing_campaign_new_adset") {
    return { mode: draft.targetMode, campaignId };
  }
  if (draft.adSetIds.length === 0) {
    issues.push("Add at least one existing ad set ID.");
    return null;
  }
  return { mode: draft.targetMode, campaignId, adSetIds: draft.adSetIds };
}

function parseDailyBudget(value: string): number | null {
  if (!value.trim()) return null;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const minorUnits = Math.round(dollars * 100);
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : null;
}

function buildAudience(
  draft: ExplicitPublishControlsDraft,
  issues: string[],
): { geo: NonNullable<MetaPublishControls["geo"]>; label: string } | null {
  if (draft.audienceMode === "saved_locations") {
    const selectedKeys = new Set(draft.selectedLocationKeys);
    const locations = draft.availableLocations.filter((location) => selectedKeys.has(location.key));
    if (locations.length === 0) {
      issues.push("Choose at least one saved audience location.");
      return null;
    }
    return {
      geo: {
        type: "cities",
        locations,
        includeSurroundingSuburbs: draft.includeSurroundingSuburbs,
      },
      label: `${locations.map(locationLabel).join(", ")}${draft.includeSurroundingSuburbs ? " + nearby areas" : ""}`,
    };
  }

  if (draft.audienceMode === "custom_radius") {
    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    const radiusKm = Number(draft.radiusKm);
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(radiusKm) || radiusKm < MIN_META_RADIUS_KM
    ) {
      issues.push(`Add valid coordinates and a radius of at least ${MIN_META_RADIUS_KM} km.`);
      return null;
    }
    return {
      geo: { type: "custom_radius", latitude, longitude, radiusKm },
      label: `${radiusKm} km around ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
    };
  }

  issues.push("Choose the audience location method.");
  return null;
}

function buildPlacements(
  choices: PlacementChoice[],
  issues: string[],
): { value: NonNullable<MetaPublishControls["placements"]>; label: string } | null {
  const selected = new Set(choices);
  const facebookPositions = [
    ...(selected.has("facebook_feed") ? ["feed"] : []),
    ...(selected.has("facebook_story") ? ["story"] : []),
  ];
  const instagramPositions = [
    ...(selected.has("instagram_feed") ? ["stream"] : []),
    ...(selected.has("instagram_story") ? ["story"] : []),
  ];
  const publisherPlatforms = [
    ...(facebookPositions.length > 0 ? ["facebook"] : []),
    ...(instagramPositions.length > 0 ? ["instagram"] : []),
  ];
  if (publisherPlatforms.length === 0) {
    issues.push("Choose at least one placement.");
    return null;
  }

  const labels = [
    ...(selected.has("facebook_feed") ? ["Facebook Feed"] : []),
    ...(selected.has("facebook_story") ? ["Facebook Stories"] : []),
    ...(selected.has("instagram_feed") ? ["Instagram Feed"] : []),
    ...(selected.has("instagram_story") ? ["Instagram Stories"] : []),
  ];
  return {
    value: {
      publisherPlatforms,
      ...(facebookPositions.length > 0 ? { facebookPositions } : {}),
      ...(instagramPositions.length > 0 ? { instagramPositions } : {}),
    },
    label: labels.join(" · "),
  };
}

function buildSchedule(
  draft: ExplicitPublishControlsDraft,
  issues: string[],
): { value: NonNullable<MetaPublishControls["schedule"]>; label: string } | null {
  let startTime: string | null;
  if (draft.startIntent === "as_soon_as_activated") {
    startTime = null;
  } else if (draft.startIntent === "scheduled") {
    startTime = isoDateTime(draft.startAt);
    if (!startTime) issues.push("Choose a valid scheduled start date and time.");
  } else {
    startTime = null;
    issues.push("Choose when the ad set should start.");
  }

  let endTime: string | null;
  if (draft.endIntent === "run_until_paused") {
    endTime = null;
  } else if (draft.endIntent === "scheduled") {
    endTime = isoDateTime(draft.endAt);
    if (!endTime) issues.push("Choose a valid scheduled end date and time.");
  } else {
    endTime = null;
    issues.push("Choose when the ad set should end.");
  }

  if (issues.some((issue) => /scheduled|should start|should end/.test(issue))) return null;
  if (endTime && startTime && Date.parse(endTime) <= Date.parse(startTime)) {
    issues.push("Schedule the end after the start.");
    return null;
  }

  const startLabel = startTime ? `Starts ${formatDateTime(startTime)}` : "Starts when activated";
  const endLabel = endTime ? `ends ${formatDateTime(endTime)}` : "runs until paused";
  return { value: { startTime, endTime }, label: `${startLabel} · ${endLabel}` };
}

function isoDateTime(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function locationLabel(location: PublishAudienceLocation): string {
  return location.region ? `${location.name}, ${location.region}` : location.name;
}

function shortId(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 12 ? `${trimmed.slice(0, 12)}…` : trimmed;
}

function formatAud(minorUnits: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(minorUnits / 100);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
