import { OperatorAssistant, type OperatorAssistantCoverageRow } from "@/components/operator/operator-assistant";
import {
  ResearchConsole,
  type ConsoleCoverageRow,
  type ConsoleDecisionRow,
  type ConsoleDefectRow,
  type ConsoleOfficialMetaApi,
  type ConsolePipelineStage,
  type ConsoleQueueRow,
  type ConsoleSkill,
} from "@/components/operator/research-console";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { logCaught } from "@/lib/log";
import { listHermesSkills, type HermesSkillSummary } from "@/lib/operator/hermes-assets";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type ResearchSupabaseClient = ReturnType<typeof createSupabaseServiceClient>;

type CoverageRow = {
  postcode: string;
  state: string;
  priority: number;
  refresh_cadence_minutes: number;
  last_refreshed_at: string | null;
  next_refresh_at: string | null;
  policy_active: boolean;
  last_audit_status: string | null;
  last_audit_score: number | null;
  live_active_ads: number;
  live_advertiser_pages?: number;
  listings?: number;
  health: string;
};

type WorkQueueRow = {
  id: string;
  job_type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  blocked_reason: string | null;
  last_error: string | null;
  updated_at: string;
  dedupe_key: string | null;
  is_stale_claim: boolean | null;
  payload?: Record<string, unknown> | null;
};

type DefectRow = {
  id: string;
  notes: string;
  status: string;
  created_at: string;
};

type DecisionRow = {
  id: string;
  decided_at: string;
  decision_type: string;
  subject_type: string;
  subject_id: string;
  confidence: number;
  model: string | null;
  hermes_skill: string | null;
  rationale: string | null;
};

const SUPERVISOR_STAGES: { key: string; label: string }[] = [
  { key: "blockwise-agent-census", label: "census" },
  { key: "blockwise-page-resolver", label: "resolver" },
  { key: "blockwise-ad-collector", label: "collector" },
  { key: "blockwise-media-collector", label: "media" },
  { key: "blockwise-ad-classifier", label: "classifier" },
];

const SKILL_CRON: Record<string, string> = {
  "blockwise-agent-census": "Mon 3a",
  "blockwise-coverage-auditor": "Mon 5a",
};

const STALE_PAGE_INTERVAL_MINUTES = 360;
const DAILY_SPEND_CAP_USD = Number(process.env.HERMES_DAILY_SPEND_LIMIT_USD ?? 25);

type QueueStats = {
  runningJobs: number;
  queuedJobs: number;
  blockedJobs: number;
  failedJobs: number;
  staleJobs: number;
};

type DefectStats = {
  openDefects: number;
};

async function loadCoverage(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("v_coverage_status")
    .select("*")
    .order("priority")
    .order("postcode")
    .limit(5000);
  return (data ?? []) as CoverageRow[];
}

async function loadWorkQueue(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("v_operator_work_queue_diagnostics")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(250);
  return (data ?? []) as WorkQueueRow[];
}

async function loadDefects(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("coverage_defects")
    .select("id,notes,status,created_at")
    .in("status", ["open", "investigating", "blocked"])
    .order("created_at", { ascending: false })
    .limit(40);
  return (data ?? []) as DefectRow[];
}

async function countResearchRows(
  supabase: ResearchSupabaseClient,
  table: string,
  applyFilter: (query: any) => any = (query) => query,
) {
  const { count } = await applyFilter(
    supabase.schema("research").from(table).select("id", { count: "exact", head: true }),
  );
  return count ?? 0;
}

async function loadQueueStats(supabase: ResearchSupabaseClient): Promise<QueueStats> {
  const [runningJobs, queuedJobs, blockedJobs, failedJobs, staleJobs] = await Promise.all([
    countResearchRows(supabase, "work_queue", (query) => query.eq("status", "claimed")),
    countResearchRows(supabase, "work_queue", (query) => query.eq("status", "pending")),
    countResearchRows(supabase, "work_queue", (query) => query.eq("status", "blocked")),
    countResearchRows(supabase, "work_queue", (query) => query.eq("status", "failed")),
    countResearchRows(supabase, "v_operator_work_queue_diagnostics", (query) => query.eq("is_stale_claim", true)),
  ]);
  return { runningJobs, queuedJobs, blockedJobs, failedJobs, staleJobs };
}

async function loadPipelineStats(supabase: ResearchSupabaseClient): Promise<ConsolePipelineStage[]> {
  return Promise.all(SUPERVISOR_STAGES.map(async (stage) => {
    const [pending, claimed, failed, blocked] = await Promise.all([
      countResearchRows(supabase, "work_queue", (query) => query.eq("job_type", stage.key).eq("status", "pending")),
      countResearchRows(supabase, "work_queue", (query) => query.eq("job_type", stage.key).eq("status", "claimed")),
      countResearchRows(supabase, "work_queue", (query) => query.eq("job_type", stage.key).eq("status", "failed")),
      countResearchRows(supabase, "work_queue", (query) => query.eq("job_type", stage.key).eq("status", "blocked")),
    ]);
    return {
      key: stage.key,
      label: stage.label,
      pending,
      claimed,
      failed,
      blocked,
    };
  }));
}

async function loadDefectStats(supabase: ResearchSupabaseClient): Promise<DefectStats> {
  const openDefects = await countResearchRows(supabase, "coverage_defects", (query) =>
    query.in("status", ["open", "investigating", "blocked"]),
  );
  return { openDefects };
}

async function loadDecisions(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("agent_decisions")
    .select("id,decided_at,decision_type,subject_type,subject_id,confidence,model,hermes_skill,rationale")
    .order("decided_at", { ascending: false })
    .limit(40);
  return (data ?? []) as DecisionRow[];
}

async function loadHeartbeat(supabase: ResearchSupabaseClient) {
  const research = supabase.schema("research");
  const [{ data: lastEvent }, { data: lastRun }] = await Promise.all([
    research.from("ingest_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    research.from("build_runs").select("mode,status").eq("status", "running").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const createdAt = (lastEvent as { created_at?: string } | null)?.created_at ?? null;
  return {
    ageSeconds: createdAt ? Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 1000)) : null,
    mode: (lastRun as { mode?: string } | null)?.mode ?? "maintain",
  };
}

async function loadSpend24h(supabase: ResearchSupabaseClient) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data } = await supabase
    .schema("research")
    .from("ad_fetch_runs")
    .select("cost_usd")
    .gte("started_at", since)
    .limit(1000);
  const rows = (data ?? []) as { cost_usd: number | null }[];
  return rows.reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
}

async function loadStalePagesDue(supabase: ResearchSupabaseClient) {
  const cutoff = new Date(Date.now() - STALE_PAGE_INTERVAL_MINUTES * 60_000).toISOString();
  const { count } = await supabase
    .schema("research")
    .from("advertiser_pages")
    .select("id", { count: "exact", head: true })
    .in("status", ["resolved_collectable", "no_ads_confirmed"])
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`);
  return count ?? 0;
}

async function loadPolicyStats(supabase: ResearchSupabaseClient) {
  const { data } = await supabase.schema("research").from("refresh_policies").select("active,next_refresh_at").limit(5000);
  const rows = (data ?? []) as { active: boolean; next_refresh_at: string | null }[];
  const active = rows.filter((row) => row.active).length;
  const nextRefreshAt =
    rows
      .filter((row) => row.active && row.next_refresh_at)
      .map((row) => row.next_refresh_at as string)
      .sort()[0] ?? null;
  return { total: rows.length, active, paused: rows.length > 0 && active === 0, nextRefreshAt };
}

async function loadInventory(supabase: ResearchSupabaseClient, skillFiles: number) {
  const research = supabase.schema("research");
  const [sourceDocs, mediaTotal, mediaFailed, reports, decisionCount] = await Promise.all([
    research.from("source_documents").select("id", { count: "exact", head: true }),
    research.from("media_assets").select("id", { count: "exact", head: true }),
    research.from("media_assets").select("id", { count: "exact", head: true }).eq("capture_status", "failed"),
    research.from("build_run_reports").select("id", { count: "exact", head: true }),
    research.from("agent_decisions").select("id", { count: "exact", head: true }),
  ]);
  return {
    sourceDocuments: sourceDocs.count ?? 0,
    mediaAssets: mediaTotal.count ?? 0,
    mediaFailed: mediaFailed.count ?? 0,
    buildRunReports: reports.count ?? 0,
    decisionCount: decisionCount.count ?? 0,
    skillFiles,
  };
}

async function loadEntityCounts(supabase: ResearchSupabaseClient) {
  const research = supabase.schema("research");
  const [{ count: agents }, { count: advertiserPages }] = await Promise.all([
    research.from("agents").select("id", { count: "exact", head: true }),
    research.from("advertiser_pages").select("id", { count: "exact", head: true }),
  ]);
  return { agents: agents ?? 0, advertiserPages: advertiserPages ?? 0 };
}

async function loadAdLibraryStats(supabase: ResearchSupabaseClient) {
  const research = supabase.schema("research");
  const [{ count: totalCards }, { count: activeCards }, { data }] = await Promise.all([
    research.from("v_customer_meta_ad_library_cards").select("card_id", { count: "exact", head: true }),
    research
      .from("v_customer_meta_ad_library_cards")
      .select("card_id", { count: "exact", head: true })
      .ilike("active_status", "active"),
    research
      .from("v_customer_meta_ad_library_cards")
      .select("image_storage_path,video_storage_path,media_assets")
      .limit(10000),
  ]);
  const rows = (data ?? []) as {
    image_storage_path: string | null;
    video_storage_path: string | null;
    media_assets: unknown;
  }[];
  return {
    activeCards: activeCards ?? 0,
    totalCards: totalCards ?? 0,
    cardsWithStoredMedia: rows.filter(
      (row) =>
        Boolean(row.image_storage_path || row.video_storage_path) ||
        (Array.isArray(row.media_assets) && row.media_assets.length > 0),
    ).length,
  };
}

function loadOfficialMetaApiStatus(): ConsoleOfficialMetaApi {
  const tokenName = process.env.META_AD_LIBRARY_ACCESS_TOKEN?.trim()
    ? "META_AD_LIBRARY_ACCESS_TOKEN"
    : process.env.META_AD_LIBRARY_TOKEN?.trim()
      ? "META_AD_LIBRARY_TOKEN"
      : null;

  return {
    configured: Boolean(tokenName),
    tokenName,
    maxPagesPerSearch: 3,
  };
}

export default async function OperatorResearchPage() {
  await requirePageSurfaceAccess("operator");
  const supabase = createSupabaseServiceClient();

  const [coverage, workQueue, queueStats, pipeline, defects, defectStats, decisions, heartbeat, spendToday, stalePagesDue, policy, skills, entity, adLibrary] =
    await Promise.all([
      loadCoverage(supabase).catch(logCaught("research ops: coverage", [] as CoverageRow[])),
      loadWorkQueue(supabase).catch(logCaught("research ops: work queue", [] as WorkQueueRow[])),
      loadQueueStats(supabase).catch(logCaught("research ops: queue stats", { runningJobs: 0, queuedJobs: 0, blockedJobs: 0, failedJobs: 0, staleJobs: 0 })),
      loadPipelineStats(supabase).catch(logCaught("research ops: pipeline stats", SUPERVISOR_STAGES.map((stage) => ({ ...stage, pending: 0, claimed: 0, failed: 0, blocked: 0 })))),
      loadDefects(supabase).catch(logCaught("research ops: defects", [] as DefectRow[])),
      loadDefectStats(supabase).catch(logCaught("research ops: defect stats", { openDefects: 0 })),
      loadDecisions(supabase).catch(logCaught("research ops: decisions", [] as DecisionRow[])),
      loadHeartbeat(supabase).catch(logCaught("research ops: heartbeat", { ageSeconds: null, mode: "maintain" })),
      loadSpend24h(supabase).catch(logCaught("research ops: spend 24h", 0)),
      loadStalePagesDue(supabase).catch(logCaught("research ops: stale pages due", 0)),
      loadPolicyStats(supabase).catch(logCaught("research ops: policy stats", { total: 0, active: 0, paused: false, nextRefreshAt: null })),
      listHermesSkills().catch(logCaught("research ops: hermes skills", [] as HermesSkillSummary[])),
      loadEntityCounts(supabase).catch(logCaught("research ops: entity counts", { agents: 0, advertiserPages: 0 })),
      loadAdLibraryStats(supabase).catch(logCaught("research ops: ad library stats", { activeCards: 0, totalCards: 0, cardsWithStoredMedia: 0 })),
    ]);
  const inventory = await loadInventory(supabase, skills.length).catch(logCaught("research ops: inventory", {
    sourceDocuments: 0,
    mediaAssets: 0,
    mediaFailed: 0,
    buildRunReports: 0,
    decisionCount: 0,
    skillFiles: skills.length,
  }));

  const { runningJobs, queuedJobs, blockedJobs, failedJobs, staleJobs } = queueStats;
  const activeJobs = runningJobs + queuedJobs;
  const needsAttention = failedJobs + blockedJobs + staleJobs + defectStats.openDefects;
  const coveredRows = coverage.filter((row) => row.live_active_ads > 0 || coverageAdvertiserPages(row) > 0 || row.last_refreshed_at || row.last_audit_status).length;
  const coveragePercent = coverage.length ? Math.round((coveredRows / coverage.length) * 100) : 0;
  const officialMetaApi = loadOfficialMetaApiStatus();

  const consoleCoverage: ConsoleCoverageRow[] = coverage.map((row) => ({
    postcode: row.postcode,
    state: row.state,
    score: coverageScore(row),
    activeAds: row.live_active_ads ?? 0,
    advertiserPages: coverageAdvertiserPages(row),
    nextRefreshAt: row.next_refresh_at,
    lastRefreshedAt: row.last_refreshed_at,
    health: row.health,
    policyActive: row.policy_active !== false,
  }));

  const consoleQueue: ConsoleQueueRow[] = workQueue
    .filter((job) => job.status !== "complete")
    .slice(0, 100)
    .map((job) => ({
      id: job.id,
      jobType: job.job_type,
      subject: jobSubject(job),
      priority: job.priority,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      status: job.status,
      isStale: Boolean(job.is_stale_claim),
      blockedReason: job.blocked_reason,
      lastError: job.last_error,
      updatedAt: job.updated_at,
    }));

  const consoleDefects: ConsoleDefectRow[] = defects.map((defect) => ({
    id: defect.id,
    notes: defect.notes,
    status: defect.status,
    createdAt: defect.created_at,
  }));

  const consoleDecisions: ConsoleDecisionRow[] = decisions.map((decision) => ({
    id: decision.id,
    decidedAt: decision.decided_at,
    decisionType: decision.decision_type,
    subjectType: decision.subject_type,
    subjectId: decision.subject_id,
    confidence: Number(decision.confidence) || 0,
    model: decision.model,
    skill: decision.hermes_skill,
    rationale: decision.rationale,
  }));

  const consoleSkills: ConsoleSkill[] = skills.map((skill) => ({
    slug: skill.slug,
    title: skill.title,
    purpose: skill.purpose,
    byteSize: skill.byteSize,
    updatedAt: skill.updatedAt,
    cron: SKILL_CRON[skill.slug] ?? null,
  }));

  const assistantCoverageRows: OperatorAssistantCoverageRow[] = consoleCoverage
    .map((row) => ({
      postcode: row.postcode,
      state: row.state,
      score: row.score,
      activeAds: row.activeAds,
      advertiserPages: row.advertiserPages,
      health: row.health,
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 4);

  return (
    <main style={{ padding: "18px 18px 28px", maxWidth: 1280, margin: "0 auto" }}>
      <ResearchConsole
        heartbeat={heartbeat}
        spend={{ today: spendToday, cap: DAILY_SPEND_CAP_USD }}
        policy={policy}
        stats={{
          needsAttention,
          activeJobs,
          runningJobs,
          queuedJobs,
          blockedJobs,
          failedJobs,
          staleJobs,
          coveragePercent,
          liveAds: adLibrary.activeCards,
        }}
        pipeline={pipeline}
        stalePagesDue={stalePagesDue}
        coverage={consoleCoverage}
        queue={consoleQueue}
        defects={consoleDefects}
        decisions={consoleDecisions}
        inventory={inventory}
        entity={entity}
        adLibrary={adLibrary}
        officialMetaApi={officialMetaApi}
        skills={consoleSkills}
        nowIso={new Date().toISOString()}
      />
      <OperatorAssistant
        initialRows={assistantCoverageRows}
        initialPostcode={assistantCoverageRows[0]?.postcode ?? null}
        lastUpdated={heartbeat.ageSeconds === null ? "no events yet" : `${heartbeat.ageSeconds}s ago`}
      />
    </main>
  );
}

function coverageScore(row: CoverageRow): number {
  if (typeof row.last_audit_score === "number") {
    return clamp(Math.round(row.last_audit_score), 0, 100);
  }
  if (row.live_active_ads > 0) {
    return clamp(55 + row.live_active_ads * 8, 55, 100);
  }
  if (coverageAdvertiserPages(row) > 0) {
    return 45;
  }
  if (row.last_refreshed_at) {
    return 35;
  }
  return 0;
}

function coverageAdvertiserPages(row: CoverageRow): number {
  return row.live_advertiser_pages ?? row.listings ?? 0;
}

function jobSubject(job: WorkQueueRow): string {
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const postcode = (payload as Record<string, unknown>).postcode;
  if (typeof postcode === "string" && postcode) return postcode;
  const subjectId = (payload as Record<string, unknown>).subjectId;
  if (typeof subjectId === "string" && subjectId) return shortId(subjectId);
  const creative = (payload as Record<string, unknown>).adCreativeId;
  if (typeof creative === "string" && creative) return shortId(creative);
  const page = (payload as Record<string, unknown>).advertiserPageId;
  if (typeof page === "string" && page) return shortId(page);
  if (job.dedupe_key) return job.dedupe_key.split(":").slice(-1)[0].slice(0, 14);
  return "—";
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
