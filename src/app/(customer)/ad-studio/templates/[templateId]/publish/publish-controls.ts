import type {
  MetaOfferFulfilment,
  MetaParentState,
  MetaPublishControls,
  MetaPublishTarget,
} from "@/lib/providers/meta-execution";

export const MIN_META_RADIUS_KM = 25;

export type PublishTargetMode =
  | "new_campaign_new_adset"
  | "existing_campaign_new_adset"
  | "existing_adset";

export type AudienceMode = "" | "saved_locations" | "custom_radius";
export type PublishBudgetMode = "" | "campaign" | "adset";
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

export type PublishFulfilmentDraft = Omit<
  MetaOfferFulfilment,
  "fulfilmentAsset"
>;

export type ExplicitPublishControlsDraft = {
  destinationMode: "website" | "instant_form";
  destinationUrl: string;
  targetMode: PublishTargetMode;
  campaignId: string;
  adSetIds: string[];
  variantIds: Array<"feed" | "story">;
  budgetMode: PublishBudgetMode;
  dailyBudgetDollars: string;
  newCampaignObjective: string;
  newCampaignSpecialAdCategory: string | null;
  newCampaignSpecialAdCategoryCountry: string;
  parentState?: MetaParentState;
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
  offerEnabled: boolean;
  fulfilmentRequired: boolean;
  fulfilment: PublishFulfilmentDraft;
  setupConfirmed: boolean;
};

export type ExplicitPublishControlsResult =
  | { controls: MetaPublishControls; issues: []; summary: PublishSetupSummary }
  | { controls: null; issues: string[]; summary: null };

export function normalizeSavedPublishAudienceLocations(markets: unknown[]): PublishAudienceLocation[] {
  const seen = new Set<string>();
  const locations: PublishAudienceLocation[] = [];
  for (const value of markets) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const targets = (value as { targetSuburbs?: unknown }).targetSuburbs;
    if (!Array.isArray(targets)) continue;
    for (const target of targets) {
      if (!target || typeof target !== "object" || Array.isArray(target)) continue;
      const row = target as { key?: unknown; name?: unknown; region?: unknown };
      const key = typeof row.key === "string" ? row.key.trim() : "";
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!key || !name || seen.has(key)) continue;
      seen.add(key);
      locations.push({
        key,
        name,
        region: typeof row.region === "string" && row.region.trim() ? row.region.trim() : null,
      });
    }
  }
  return locations.slice(0, 24);
}

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

  const variantIds = [...new Set(draft.variantIds)];
  if (variantIds.length === 0) {
    issues.push("Choose at least one creative variant.");
  }

  const target = buildTarget(draft, issues);
  const fulfilment = buildExecutableFulfilment(draft, issues);
  const parentState = displayParentState(draft, target);
  const variantLabel = variantIds.map(variant => variant === "feed" ? "Feed" : "Story").join(" + ");
  const fulfilmentLabel = fulfilment
    ? `${fulfilment.exactOffer} · delivered at ${fulfilment.fulfilmentUrl}`
    : "No offer or delivery promise";

  if (draft.targetMode === "existing_adset") {
    if (!draft.setupConfirmed) {
      issues.push("Confirm that the selected ad sets keep their live Meta settings.");
    }
    if (!target || target.mode !== "existing_adset" || issues.length > 0) return { controls: null, issues, summary: null };

    const controls: MetaPublishControls = {
      target,
      destinationMode: draft.destinationMode,
      destinationUrl,
      variantIds,
      ...(fulfilment ? { fulfilment } : {}),
    };
    return {
      controls,
      issues: [],
      summary: {
        target: `${target.adSetIds.length} existing ${target.adSetIds.length === 1 ? "ad set" : "ad sets"}`,
        budgetMode: parentState?.campaign?.budgetMode === "campaign"
          ? "Campaign budget (CBO) · inherited from Meta"
          : parentState?.campaign?.budgetMode === "adset"
            ? "Ad set budgets (ABO) · inherited from Meta"
            : "Verified against Meta immediately before creation",
        budget: "Unchanged in Meta",
        audience: "Unchanged in Meta",
        placements: "Unchanged in Meta",
        schedule: "Unchanged in Meta",
        destination: destinationUrl,
        variants: variantLabel,
        fulfilment: fulfilmentLabel,
        activationConfirmation:
          `I confirm ${variantIds.length} ${variantIds.length === 1 ? "ad" : "ads"} will use the selected ad sets' live settings${fulfilment ? ` and deliver ${fulfilment.exactOffer}` : ""} when activated.`,
        usesExistingAdSetSettings: true,
      },
    };
  }

  const newCampaignBudgetMode = draft.budgetMode === "campaign" || draft.budgetMode === "adset"
    ? draft.budgetMode
    : null;
  const existingCampaignBudgetMode = parentState?.campaign?.budgetMode;
  const effectiveBudgetMode = draft.targetMode === "new_campaign_new_adset"
    ? newCampaignBudgetMode ?? ""
    : existingCampaignBudgetMode ?? "";
  if (draft.targetMode === "new_campaign_new_adset" && !effectiveBudgetMode) {
    issues.push("Choose campaign budget (CBO) or ad set budget (ABO).");
  }
  if (draft.targetMode === "new_campaign_new_adset" && !draft.newCampaignObjective.trim()) {
    issues.push("This template is missing its Meta campaign objective.");
  }
  const specialAdCategoryCountry = draft.newCampaignSpecialAdCategoryCountry.trim().toUpperCase();
  if (draft.targetMode === "new_campaign_new_adset" && !/^[A-Z]{2}$/.test(specialAdCategoryCountry)) {
    issues.push("Enter the two-letter country code for the Meta special ad category.");
  }

  const dailyBudgetMinorUnits = parseDailyBudget(draft.dailyBudgetDollars);
  if (dailyBudgetMinorUnits === null) {
    issues.push(
      draft.targetMode === "new_campaign_new_adset" && effectiveBudgetMode === "campaign"
        ? "Enter a campaign daily budget greater than A$0.00."
        : "Enter a daily budget greater than A$0.00 for the new ad set. It is used only when Meta verifies ABO.",
    );
  }

  const audience = buildAudience(draft, issues);
  const placements = buildPlacements(draft.placementChoices, issues);
  const schedule = buildSchedule(draft, issues);
  if (!draft.setupConfirmed) {
    issues.push("Confirm the budget, audience, placements and schedule.");
  }

  if (
    !target
    || dailyBudgetMinorUnits === null
    || (draft.targetMode === "new_campaign_new_adset" && !effectiveBudgetMode)
    || !audience
    || !placements
    || !schedule
    || issues.length > 0
  ) {
    return { controls: null, issues, summary: null };
  }

  const controls: MetaPublishControls = {
    target,
    destinationMode: draft.destinationMode,
    destinationUrl,
    variantIds,
    dailyBudgetMinorUnits,
    ...(draft.targetMode === "new_campaign_new_adset"
      ? {
          newCampaign: {
            objective: draft.newCampaignObjective.trim(),
            specialAdCategories: draft.newCampaignSpecialAdCategory
              ? [draft.newCampaignSpecialAdCategory]
              : [],
            specialAdCategoryCountries: [specialAdCategoryCountry],
            budgetMode: newCampaignBudgetMode!,
          },
        }
      : {}),
    geo: audience.geo,
    placements: placements.value,
    schedule: schedule.value,
    ...(fulfilment ? { fulfilment } : {}),
  };

  const budgetLabel = draft.targetMode === "existing_campaign_new_adset"
    ? `${formatAud(dailyBudgetMinorUnits)} per day if Meta verifies ABO; ignored for live CBO`
    : effectiveBudgetMode === "campaign"
    ? draft.targetMode === "new_campaign_new_adset"
      ? `${formatAud(dailyBudgetMinorUnits)} per day at campaign level`
      : "Inherited campaign budget (CBO) · no ad set budget added"
    : `${formatAud(dailyBudgetMinorUnits)} per day for the new ad set`;

  return {
    controls,
    issues: [],
    summary: {
      target:
        draft.targetMode === "new_campaign_new_adset"
          ? "New campaign · new ad set"
          : `Campaign ${shortId(draft.campaignId)} · new ad set`,
      budgetMode: draft.targetMode === "existing_campaign_new_adset"
        ? parentState?.campaign?.budgetMode === "campaign"
          ? "Last checked: Campaign budget (CBO) · re-verified before creation"
          : parentState?.campaign?.budgetMode === "adset"
            ? "Last checked: Ad set budget (ABO) · re-verified before creation"
            : "Verified against Meta immediately before creation"
        : effectiveBudgetMode === "campaign" ? "Campaign budget (CBO)" : "Ad set budget (ABO)",
      budget: budgetLabel,
      audience: audience.label,
      placements: placements.label,
      schedule: schedule.label,
      destination: destinationUrl,
      variants: variantLabel,
      fulfilment: fulfilmentLabel,
      activationConfirmation: draft.targetMode === "existing_campaign_new_adset"
        ? `I confirm Blockwise will re-verify the campaign's live budget mode, use its campaign budget for CBO or apply ${formatAud(dailyBudgetMinorUnits)} to the new ad set for ABO${fulfilment ? `, and deliver ${fulfilment.exactOffer}` : ""} once I activate it.`
        : effectiveBudgetMode === "campaign"
          ? `I confirm Meta can use the campaign's ${formatAud(dailyBudgetMinorUnits)} daily budget${fulfilment ? ` and deliver ${fulfilment.exactOffer}` : ""} once I activate it.`
          : `I confirm Meta can spend up to ${formatAud(dailyBudgetMinorUnits)} per day for this ad set${fulfilment ? ` and deliver ${fulfilment.exactOffer}` : ""} once I activate it.`,
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
  const adSetIds = draft.adSetIds.map(value => value.trim()).filter(Boolean);
  if (adSetIds.length === 0) {
    issues.push("Add at least one existing ad set ID.");
    return null;
  }
  const duplicates = duplicateValues(adSetIds);
  if (duplicates.length > 0) {
    issues.push(`Remove duplicate ad set IDs: ${duplicates.join(", ")}.`);
    return null;
  }
  return { mode: draft.targetMode, campaignId, adSetIds };
}

function displayParentState(
  draft: ExplicitPublishControlsDraft,
  target: MetaPublishTarget | null,
): MetaParentState | null {
  if (!target || target.mode === "new_campaign_new_adset") return null;
  const campaign = draft.parentState?.campaign;
  if (!campaign || campaign.id.trim() !== target.campaignId) {
    return null;
  }
  if (target.mode === "existing_campaign_new_adset") {
    return { campaign, adSets: [] };
  }

  const states = draft.parentState?.adSets ?? [];
  const byId = new Map(states.map(state => [state.id.trim(), state]));
  const missing = target.adSetIds.filter(id => {
    const state = byId.get(id);
    return !state || state.campaignId.trim() !== target.campaignId;
  });
  if (missing.length > 0) {
    return null;
  }
  return { campaign, adSets: target.adSetIds.map(id => byId.get(id)!) };
}

function buildExecutableFulfilment(
  draft: ExplicitPublishControlsDraft,
  issues: string[],
): MetaOfferFulfilment | null {
  const enabled = draft.fulfilmentRequired || draft.offerEnabled;
  if (!enabled) return null;
  const initialIssueCount = issues.length;

  const labels: Record<keyof PublishFulfilmentDraft, string> = {
    exactOffer: "exact offer",
    eligibility: "eligibility",
    conditions: "conditions",
    timeframe: "delivery timeframe",
    evidence: "evidence",
    approval: "evidence approval",
    disclaimer: "disclaimer",
    privacyUrl: "privacy URL",
    consent: "consent wording",
    fulfilmentUrl: "HTTPS delivery URL",
    owner: "fulfilment owner",
    expiry: "expiry",
    tracking: "tracking",
  };
  for (const key of Object.keys(labels) as Array<keyof PublishFulfilmentDraft>) {
    if (!draft.fulfilment[key].trim()) issues.push(`Add the ${labels[key]} for this offer or promise.`);
  }
  if (draft.fulfilment.fulfilmentUrl.trim() && !validHttpsUrl(draft.fulfilment.fulfilmentUrl.trim())) {
    issues.push("Add the valid HTTPS delivery URL promised by this ad.");
  }
  if (draft.fulfilment.privacyUrl.trim() && !validHttpsUrl(draft.fulfilment.privacyUrl.trim())) {
    issues.push("Add a valid HTTPS privacy URL for this offer or promise.");
  }
  if (issues.length > initialIssueCount) return null;

  return {
    ...Object.fromEntries(
      (Object.keys(labels) as Array<keyof PublishFulfilmentDraft>)
        .map(key => [key, draft.fulfilment[key].trim()]),
    ) as PublishFulfilmentDraft,
    fulfilmentAsset: "",
  };
}

/**
 * The confirmation is bound to the exact setup, not a mutable checkbox.
 * Any destination, matrix, offer, fulfilment, budget or parent change yields a
 * different fingerprint and therefore invalidates the prior confirmation.
 */
export function publishSetupFingerprint(
  draft: Omit<ExplicitPublishControlsDraft, "setupConfirmed">,
): string {
  return JSON.stringify({
    ...draft,
    campaignId: draft.campaignId.trim(),
    adSetIds: draft.adSetIds.map(value => value.trim()).filter(Boolean),
    variantIds: [...draft.variantIds],
    destinationUrl: draft.destinationUrl.trim(),
    dailyBudgetDollars: draft.dailyBudgetDollars.trim(),
    selectedLocationKeys: [...draft.selectedLocationKeys],
    placementChoices: [...draft.placementChoices],
    fulfilment: Object.fromEntries(
      Object.entries(draft.fulfilment).map(([key, value]) => [key, value.trim()]),
    ),
  });
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
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
