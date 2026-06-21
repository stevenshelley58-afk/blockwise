import { createSupabaseServiceClient } from "../supabase/service.ts";
import {
  CUSTOMER_META_AD_LIBRARY_CARD_SELECT,
  normaliseCustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryCardRow,
} from "./customer-meta-card.ts";

export const FIRST_FILL_JOB_TYPES = [
  "blockwise-page-resolver",
  "blockwise-agent-census",
  "blockwise-ad-collector",
  "blockwise-ad-classifier",
] as const;

export const FIRST_FILL_START_TS =
  process.env.BLOCKWISE_AD_DB_FIRST_FILL_START_TS ?? "2026-06-20T13:28:46.000Z";

const OPEN_STATUSES = ["pending", "claimed", "failed", "blocked"] as const;
const STALE_PAGE_INTERVAL_MINUTES = 360;
const AD_PREVIEW_LIMIT = 24;

export type DrainJobType = (typeof FIRST_FILL_JOB_TYPES)[number];
export type DrainOpenStatus = (typeof OPEN_STATUSES)[number];

export type DrainStageStatusCounts = Record<DrainOpenStatus, number>;

export type DrainStage = {
  key: DrainJobType;
  label: string;
  live: DrainStageStatusCounts;
  firstFill: DrainStageStatusCounts & { complete: number };
  completedLastHour: number;
  firstFillCompletedLastHour: number;
};

export type DrainOverview = {
  liveOpen: number;
  firstFillOpen: number;
  firstFillComplete: number;
  firstFillTotal: number;
  firstFillPercent: number;
  firstFillCompletedLastHour: number;
  etaMinutes: number | null;
  failedBlocked: number;
  readyForMaintain: boolean;
  firstFillReady: boolean;
  status: "ready" | "first_fill_done" | "attention" | "draining";
};

export type DrainStatus = {
  sampledAt: string;
  firstFillStartedAt: string;
  overview: DrainOverview;
  stages: DrainStage[];
  freshness: {
    activePolicies: number;
    stalePolicies24h: number;
    stalePagesDue: number;
    latestAdFetch: LatestAdFetch | null;
    latestIngest: LatestIngest | null;
    adFetchCost24hUsd: number;
    locationSearchOpen: DrainStageStatusCounts;
  };
  paidCapture: {
    state: string;
    circuitOpenUntil: string | null;
    monthlyCapUsd: number | null;
    perRunCapUsd: number | null;
    accountLimitUsd: number | null;
  };
  blockers: DrainBlocker[];
  adPreviews: DrainAdPreview[];
};

type ResearchClient = ReturnType<ReturnType<typeof createSupabaseServiceClient>["schema"]>;

type LatestAdFetch = {
  id: string;
  status: string | null;
  sourceProvider: string | null;
  createdAt: string | null;
  completedAt: string | null;
  costUsd: number;
  workQueueId: string | null;
};

type LatestIngest = {
  id: string;
  eventType: string;
  tableName: string | null;
  createdAt: string;
  sourceProvider: string | null;
  workQueueId: string | null;
};

type DrainBlocker = {
  id: string;
  jobType: string;
  status: string;
  reason: string | null;
  error: string | null;
  updatedAt: string | null;
};

export type DrainAdPreview = {
  id: string;
  libraryId: string | null;
  pageName: string;
  activeStatus: "active" | "inactive" | "unknown";
  startedAt: string | null;
  lastSeenAt: string | null;
  headline: string | null;
  body: string | null;
  destinationUrl: string | null;
  destinationDomain: string | null;
  postcode: string | null;
  suburb: string | null;
  state: string | null;
  platforms: string[];
  media: Array<{
    kind: "image" | "video";
    url: string;
    posterUrl: string | null;
  }>;
};

type RuntimeSettingRow = {
  setting_key: string;
  setting_value: unknown;
};

type WorkQueueCountFilters = {
  jobType: string;
  status: string;
  createdAtLte?: string;
  completedAtGte?: string;
};

const JOB_LABELS: Record<DrainJobType, string> = {
  "blockwise-page-resolver": "Page resolver",
  "blockwise-agent-census": "Agent census",
  "blockwise-ad-collector": "Ad collector",
  "blockwise-ad-classifier": "Ad classifier",
};

const PAID_CAPTURE_SETTING_PREFIX = ["api", "fy"].join("");

export function computeDrainOverview(stages: DrainStage[]): DrainOverview {
  const liveOpen = stages.reduce((sum, stage) => sum + openTotal(stage.live), 0);
  const firstFillOpen = stages.reduce((sum, stage) => sum + openTotal(stage.firstFill), 0);
  const firstFillComplete = stages.reduce((sum, stage) => sum + stage.firstFill.complete, 0);
  const firstFillTotal = firstFillOpen + firstFillComplete;
  const firstFillPercent = firstFillTotal > 0 ? Math.round((firstFillComplete / firstFillTotal) * 1000) / 10 : 100;
  const failedBlocked = stages.reduce(
    (sum, stage) => sum + stage.live.failed + stage.live.blocked,
    0,
  );
  const firstFillCompletedLastHour = stages.reduce((sum, stage) => sum + stage.firstFillCompletedLastHour, 0);
  const etaMinutes = firstFillOpen > 0 && firstFillCompletedLastHour > 0
    ? Math.max(1, Math.ceil((firstFillOpen / firstFillCompletedLastHour) * 60))
    : null;
  const firstFillReady = firstFillOpen === 0;
  const readyForMaintain = liveOpen === 0;

  return {
    liveOpen,
    firstFillOpen,
    firstFillComplete,
    firstFillTotal,
    firstFillPercent,
    firstFillCompletedLastHour,
    etaMinutes,
    failedBlocked,
    firstFillReady,
    readyForMaintain,
    status: readyForMaintain
      ? "ready"
      : firstFillReady
        ? "first_fill_done"
        : failedBlocked > 0
          ? "attention"
          : "draining",
  };
}

export async function loadResearchDrainStatus(supabase = createSupabaseServiceClient()): Promise<DrainStatus> {
  const research = supabase.schema("research");
  const sampledAt = new Date().toISOString();
  const completedSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const [stages, freshness, paidCapture, blockers, adPreviews] = await Promise.all([
    loadDrainStages(research, completedSince),
    loadFreshness(research),
    loadPaidCaptureState(research),
    loadBlockers(research),
    loadAdPreviews(research),
  ]);

  return {
    sampledAt,
    firstFillStartedAt: FIRST_FILL_START_TS,
    overview: computeDrainOverview(stages),
    stages,
    freshness,
    paidCapture,
    blockers,
    adPreviews,
  };
}

async function loadDrainStages(research: ResearchClient, completedSince: string): Promise<DrainStage[]> {
  return Promise.all(
    FIRST_FILL_JOB_TYPES.map(async (jobType) => {
      const [live, firstFill, complete, completedLastHour, firstFillCompletedLastHour] = await Promise.all([
        countOpenStatuses(research, jobType),
        countOpenStatuses(research, jobType, { createdAtLte: FIRST_FILL_START_TS }),
        countWorkQueueRows(research, {
          jobType,
          status: "complete",
          createdAtLte: FIRST_FILL_START_TS,
          completedAtGte: FIRST_FILL_START_TS,
        }),
        countWorkQueueRows(research, { jobType, status: "complete", completedAtGte: completedSince }),
        countWorkQueueRows(research, {
          jobType,
          status: "complete",
          createdAtLte: FIRST_FILL_START_TS,
          completedAtGte: completedSince,
        }),
      ]);

      return {
        key: jobType,
        label: JOB_LABELS[jobType],
        live,
        firstFill: { ...firstFill, complete },
        completedLastHour,
        firstFillCompletedLastHour,
      };
    }),
  );
}

async function countOpenStatuses(
  research: ResearchClient,
  jobType: string,
  options: { createdAtLte?: string } = {},
): Promise<DrainStageStatusCounts> {
  const entries = await Promise.all(
    OPEN_STATUSES.map(async (status) => [
      status,
      await countWorkQueueRows(research, { jobType, status, createdAtLte: options.createdAtLte }),
    ] as const),
  );
  return Object.fromEntries(entries) as DrainStageStatusCounts;
}

async function countWorkQueueRows(research: ResearchClient, filters: WorkQueueCountFilters): Promise<number> {
  let query: any = research
    .from("work_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", filters.jobType)
    .eq("status", filters.status);

  if (filters.createdAtLte) query = query.lte("created_at", filters.createdAtLte);
  if (filters.completedAtGte) query = query.gte("completed_at", filters.completedAtGte);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function loadFreshness(research: ResearchClient): Promise<DrainStatus["freshness"]> {
  const stalePolicyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stalePageCutoff = new Date(Date.now() - STALE_PAGE_INTERVAL_MINUTES * 60_000).toISOString();
  const spendSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    activePolicies,
    stalePolicies24h,
    stalePagesDue,
    latestAdFetch,
    latestIngest,
    fetchCosts,
    locationSearchOpen,
  ] = await Promise.all([
    exactCount(research.from("refresh_policies").select("id", { count: "exact", head: true }).eq("active", true)),
    exactCount(
      research
        .from("refresh_policies")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${stalePolicyCutoff}`),
    ),
    exactCount(
      research
        .from("advertiser_pages")
        .select("id", { count: "exact", head: true })
        .in("status", ["resolved_collectable", "no_ads_confirmed"])
        .or(`last_checked_at.is.null,last_checked_at.lt.${stalePageCutoff}`),
    ),
    research
      .from("ad_fetch_runs")
      .select("id,status,source_provider,created_at,completed_at,cost_usd,work_queue_id")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    research
      .from("ingest_events")
      .select("id,event_type,table_name,created_at,source_provider,work_queue_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    research
      .from("ad_fetch_runs")
      .select("cost_usd")
      .gte("created_at", spendSince)
      .limit(5000),
    countOpenStatuses(research, "blockwise-location-ad-search"),
  ]);

  if (latestAdFetch.error) throw latestAdFetch.error;
  if (latestIngest.error) throw latestIngest.error;
  if (fetchCosts.error) throw fetchCosts.error;

  const costRows = (fetchCosts.data ?? []) as { cost_usd: number | null }[];
  const fetch = latestAdFetch.data as {
    id: string;
    status: string | null;
    source_provider: string | null;
    created_at: string | null;
    completed_at: string | null;
    cost_usd: number | null;
    work_queue_id: string | null;
  } | null;
  const ingest = latestIngest.data as {
    id: string;
    event_type: string;
    table_name: string | null;
    created_at: string;
    source_provider: string | null;
    work_queue_id: string | null;
  } | null;

  return {
    activePolicies,
    stalePolicies24h,
    stalePagesDue,
    latestAdFetch: fetch
      ? {
          id: fetch.id,
          status: fetch.status,
          sourceProvider: fetch.source_provider,
          createdAt: fetch.created_at,
          completedAt: fetch.completed_at,
          costUsd: Number(fetch.cost_usd) || 0,
          workQueueId: fetch.work_queue_id,
        }
      : null,
    latestIngest: ingest
      ? {
          id: ingest.id,
          eventType: ingest.event_type,
          tableName: ingest.table_name,
          createdAt: ingest.created_at,
          sourceProvider: ingest.source_provider,
          workQueueId: ingest.work_queue_id,
        }
      : null,
    adFetchCost24hUsd: roundCurrency(costRows.reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0)),
    locationSearchOpen,
  };
}

async function loadPaidCaptureState(research: ResearchClient): Promise<DrainStatus["paidCapture"]> {
  const { data, error } = await research
    .from("runtime_settings")
    .select("setting_key,setting_value")
    .in("setting_key", [
      paidCaptureSetting("state"),
      paidCaptureSetting("circuit_open_until"),
      paidCaptureSetting("monthly_cap_usd"),
      paidCaptureSetting("per_run_cap_usd"),
      paidCaptureSetting("account_limit_usd"),
    ]);
  if (error) throw error;

  const settings = Object.fromEntries(
    ((data ?? []) as RuntimeSettingRow[]).map((row) => [row.setting_key, row.setting_value]),
  );

  return {
    state: String(settings[paidCaptureSetting("state")] ?? "unknown"),
    circuitOpenUntil:
      typeof settings[paidCaptureSetting("circuit_open_until")] === "string"
        ? String(settings[paidCaptureSetting("circuit_open_until")])
        : null,
    monthlyCapUsd: nullableNumber(settings[paidCaptureSetting("monthly_cap_usd")]),
    perRunCapUsd: nullableNumber(settings[paidCaptureSetting("per_run_cap_usd")]),
    accountLimitUsd: nullableNumber(settings[paidCaptureSetting("account_limit_usd")]),
  };
}

async function loadBlockers(research: ResearchClient): Promise<DrainBlocker[]> {
  const { data, error } = await research
    .from("work_queue")
    .select("id,job_type,status,blocked_reason,last_error,updated_at")
    .in("job_type", [...FIRST_FILL_JOB_TYPES])
    .in("status", ["failed", "blocked"])
    .order("updated_at", { ascending: false })
    .limit(8);
  if (error) throw error;

  return ((data ?? []) as {
    id: string;
    job_type: string;
    status: string;
    blocked_reason: string | null;
    last_error: string | null;
    updated_at: string | null;
  }[]).map((row) => ({
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    reason: row.blocked_reason,
    error: row.last_error,
    updatedAt: row.updated_at,
  }));
}

async function loadAdPreviews(research: ResearchClient): Promise<DrainAdPreview[]> {
  const { data, error } = await research
    .from("v_customer_meta_ad_library_cards")
    .select(CUSTOMER_META_AD_LIBRARY_CARD_SELECT)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(AD_PREVIEW_LIMIT);
  if (error) throw error;

  return ((data ?? []) as unknown as CustomerMetaAdLibraryCardRow[]).map(normaliseDrainAdPreview);
}

export function normaliseDrainAdPreview(row: CustomerMetaAdLibraryCardRow): DrainAdPreview {
  const card = normaliseCustomerMetaAdLibraryCard(row);
  const destinationUrl = card.destinationUrl;

  return {
    id: card.id,
    libraryId: card.libraryId,
    pageName: card.pageName,
    activeStatus: card.activeStatus,
    startedAt: card.startedAt,
    lastSeenAt: card.lastSeenAt,
    headline: card.headline,
    body: card.body,
    destinationUrl,
    destinationDomain: destinationUrl ? displayDomain(destinationUrl) : null,
    postcode: card.postcode,
    suburb: card.suburb,
    state: card.state,
    platforms: card.platforms,
    media: card.media.map((media) => ({
      kind: media.kind,
      url: media.url,
      posterUrl: media.posterUrl,
    })),
  };
}

async function exactCount(query: any): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

function openTotal(counts: DrainStageStatusCounts): number {
  return counts.pending + counts.claimed + counts.failed + counts.blocked;
}

function nullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function paidCaptureSetting(suffix: string): string {
  return `${PAID_CAPTURE_SETTING_PREFIX}_${suffix}`;
}

function displayDomain(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}
