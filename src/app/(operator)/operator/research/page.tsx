import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Bot,
  Clock3,
  ExternalLink,
  FileSearch,
  FolderOpen,
  Gauge,
  type LucideIcon,
  Plus,
  Shield,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import { OperatorAssistant, type OperatorAssistantCoverageRow } from "@/components/operator/operator-assistant";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
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
  next_refresh_at: string;
  policy_active: boolean;
  last_audit_status: string | null;
  last_audit_score: number | null;
  last_audited_at: string | null;
  live_active_ads: number;
  live_advertiser_pages?: number;
  live_agents?: number;
  live_agencies?: number;
  listings?: number;
  health: string;
};

type RunRow = {
  id: string;
  source_provider: string;
  role: string;
  target_kind: string;
  target_value: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  cost_usd: number | null;
  result_summary: Record<string, unknown> | null;
  error: string | null;
};

type DefectRow = {
  id: string;
  postcode: string | null;
  suburb: string | null;
  agency_name: string | null;
  agent_name: string | null;
  platform: string | null;
  notes: string;
  reported_by: string;
  status: string;
  created_at: string;
};

type AdLibraryCardRow = {
  active_status: string | null;
  image_storage_path: string | null;
  video_storage_path: string | null;
  media_assets: unknown;
};

type AdLibraryStats = {
  activeCards: number;
  totalCards: number;
  cardsWithStoredMedia: number;
};

type EntityCounts = {
  agents: number;
  advertiserPages: number;
};

type RecentAdRow = {
  agency_id: string | null;
  agency_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  advertiser_page_id: string;
  page_name: string | null;
  platform: string | null;
  observed_ad_id: string;
  external_ad_id: string | null;
  active_status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_checked_at: string | null;
  headline: string | null;
  body: string | null;
  cta: string | null;
  primary_image_url: string | null;
  video_url: string | null;
  format: string | null;
  classification: Record<string, unknown> | null;
  snapshot_count: number | null;
  ad_delivery_started_at: string | null;
  ad_delivery_stopped_at: string | null;
  ad_creation_date: string | null;
  image_urls: unknown;
  image_storage_path: string | null;
  video_storage_path: string | null;
  video_thumbnail_url: string | null;
  media_assets: unknown;
  ad_type: string | null;
  primary_intent: string | null;
  display_state: string | null;
};

type WorkQueueRow = {
  id: string;
  queue_name: string;
  job_type: string;
  dedupe_key: string | null;
  status: string;
  priority: number;
  available_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  claim_expires_at: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  blocked_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  is_stale_claim: boolean | null;
};

type DefectRollup = {
  label: string;
  count: number;
  detail: string;
  tone: "green" | "rose" | "amber";
};

type PolicyStats = {
  total: number;
  active: number;
  paused: boolean;
  nextRefreshAt: string | null;
};

type FileInventoryStats = {
  sourceDocuments: number;
  mediaBlobs: number;
  buildRunReports: number;
  skillFiles: number;
  latestEvidenceAt: string | null;
  latestMediaAt: string | null;
  latestReportAt: string | null;
  mediaError: string | null;
};

const RECENT_AD_SELECT =
  "agency_id,agency_name,agent_id,agent_name,advertiser_page_id,page_name,platform,observed_ad_id,external_ad_id,active_status,first_seen_at,last_seen_at,last_checked_at,headline,body,cta,primary_image_url,video_url,format,classification,snapshot_count,ad_delivery_started_at,ad_delivery_stopped_at,ad_creation_date,image_urls,image_storage_path,video_storage_path,video_thumbnail_url,media_assets,ad_type,primary_intent,display_state";

const STATUS_TABS = ["All", "Running", "Queued", "Retry", "Blocked", "Failed"];

async function loadCoverage(supabase: ResearchSupabaseClient) {
  const { data } = await supabase.schema("research").from("v_coverage_status").select("*").order("priority").order("postcode");
  return (data ?? []) as CoverageRow[];
}

async function loadRuns(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("ad_fetch_runs")
    .select("id,source_provider,role,target_kind,target_value,started_at,completed_at,status,cost_usd,result_summary,error")
    .order("started_at", { ascending: false })
    .limit(20);
  return (data ?? []) as RunRow[];
}

async function loadDefects(supabase: ResearchSupabaseClient) {
  const { data } = await supabase.schema("research").from("v_missing_competitors").select("*").limit(30);
  return (data ?? []) as DefectRow[];
}

async function loadAdLibraryStats(supabase: ResearchSupabaseClient): Promise<AdLibraryStats> {
  const { data } = await supabase
    .schema("research")
    .from("v_customer_meta_ad_library_cards")
    .select("active_status,image_storage_path,video_storage_path,media_assets")
    .limit(1000);

  const rows = (data ?? []) as AdLibraryCardRow[];

  return {
    activeCards: rows.filter((row) => String(row.active_status ?? "").toLowerCase() === "active").length,
    totalCards: rows.length,
    cardsWithStoredMedia: rows.filter(hasStoredMedia).length,
  };
}

async function loadEntityCounts(supabase: ResearchSupabaseClient): Promise<EntityCounts> {
  const [{ count: agents }, { count: advertiserPages }] = await Promise.all([
    supabase.schema("research").from("agents").select("id", { count: "exact", head: true }),
    supabase.schema("research").from("advertiser_pages").select("id", { count: "exact", head: true }),
  ]);

  return {
    agents: agents ?? 0,
    advertiserPages: advertiserPages ?? 0,
  };
}

async function loadRecentAds(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("v_agent_ad_history")
    .select(RECENT_AD_SELECT)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(50);

  return (data ?? []) as unknown as RecentAdRow[];
}

async function loadWorkQueueDiagnostics(supabase: ResearchSupabaseClient) {
  const { data } = await supabase
    .schema("research")
    .from("v_operator_work_queue_diagnostics")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(250);

  return (data ?? []) as WorkQueueRow[];
}

async function loadPolicyStats(supabase: ResearchSupabaseClient): Promise<PolicyStats> {
  const { data } = await supabase
    .schema("research")
    .from("refresh_policies")
    .select("active,next_refresh_at");
  const rows = (data ?? []) as { active: boolean; next_refresh_at: string | null }[];
  const active = rows.filter((row) => row.active).length;
  const nextRefreshAt =
    rows
      .filter((row) => row.active && row.next_refresh_at)
      .map((row) => row.next_refresh_at as string)
      .sort()[0] ?? null;

  return {
    total: rows.length,
    active,
    paused: rows.length > 0 && active === 0,
    nextRefreshAt,
  };
}

async function loadFileInventoryStats(
  supabase: ResearchSupabaseClient,
  skillFiles: number,
): Promise<FileInventoryStats> {
  const research = supabase.schema("research");
  const [sourceCount, latestSource, mediaCount, latestMedia, reportCount, latestReport] = await Promise.all([
    research.from("source_documents").select("id", { count: "exact", head: true }),
    research.from("source_documents").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
    research.from("media_blobs").select("content_hash", { count: "exact", head: true }),
    research.from("media_blobs").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
    research.from("build_run_reports").select("id", { count: "exact", head: true }),
    research.from("build_run_reports").select("last_seen_at").order("last_seen_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    sourceDocuments: sourceCount.count ?? 0,
    mediaBlobs: mediaCount.error ? 0 : mediaCount.count ?? 0,
    buildRunReports: reportCount.count ?? 0,
    skillFiles,
    latestEvidenceAt: (latestSource.data as { fetched_at?: string | null } | null)?.fetched_at ?? null,
    latestMediaAt: mediaCount.error
      ? null
      : (latestMedia.data as { last_seen_at?: string | null } | null)?.last_seen_at ?? null,
    latestReportAt: (latestReport.data as { last_seen_at?: string | null } | null)?.last_seen_at ?? null,
    mediaError: mediaCount.error?.message ?? latestMedia.error?.message ?? null,
  };
}

export default async function OperatorResearchPage() {
  await requirePageSurfaceAccess("operator");
  const supabase = createSupabaseServiceClient();
  const [coverage, runs, defects, adLibraryStats, entityCounts, recentAds, workQueueJobs, skills, policyStats] = await Promise.all([
    loadCoverage(supabase).catch(() => [] as CoverageRow[]),
    loadRuns(supabase).catch(() => [] as RunRow[]),
    loadDefects(supabase).catch(() => [] as DefectRow[]),
    loadAdLibraryStats(supabase).catch(() => ({ activeCards: 0, totalCards: 0, cardsWithStoredMedia: 0 })),
    loadEntityCounts(supabase).catch(() => ({ agents: 0, advertiserPages: 0 })),
    loadRecentAds(supabase).catch(() => [] as RecentAdRow[]),
    loadWorkQueueDiagnostics(supabase).catch(() => [] as WorkQueueRow[]),
    listHermesSkills().catch(() => [] as HermesSkillSummary[]),
    loadPolicyStats(supabase).catch(() => ({ total: 0, active: 0, paused: false, nextRefreshAt: null })),
  ]);
  const fileInventory = await loadFileInventoryStats(supabase, skills.length).catch(() => ({
    sourceDocuments: 0,
    mediaBlobs: 0,
    buildRunReports: 0,
    skillFiles: skills.length,
    latestEvidenceAt: null,
    latestMediaAt: null,
    latestReportAt: null,
    mediaError: null,
  }));

  const activeJobs = workQueueJobs.filter((job) => job.status === "pending" || job.status === "claimed").length;
  const runningJobs = workQueueJobs.filter((job) => job.status === "claimed" && !job.is_stale_claim).length;
  const queuedJobs = workQueueJobs.filter((job) => job.status === "pending").length;
  const retryJobs = workQueueJobs.filter((job) => job.attempts > 0 && job.status === "pending").length;
  const blockedJobs = workQueueJobs.filter((job) => job.status === "blocked").length;
  const failedJobs = workQueueJobs.filter((job) => job.status === "failed").length;
  const staleJobs = workQueueJobs.filter((job) => job.is_stale_claim).length;
  const needsAttention = failedJobs + blockedJobs + staleJobs + defects.length;
  const coveredRows = coverage.filter((row) => row.live_active_ads > 0 || row.last_refreshed_at || row.last_audit_status).length;
  const coveragePercent = coverage.length ? Math.round((coveredRows / coverage.length) * 100) : 0;
  const totalCost24h = runs
    .filter((run) => new Date(run.started_at).getTime() > Date.now() - 24 * 3600 * 1000)
    .reduce((sum, run) => sum + (Number(run.cost_usd) || 0), 0);
  const lastRun = runs[0];
  const lastRunAge = lastRun ? formatRelativeTime(lastRun.started_at) : "No runs";
  const lastRunTarget = lastRun?.target_value ? `Postcode ${lastRun.target_value}` : "Awaiting first run";
  const topCoverage = coverage.slice(0, 6);
  const defectRollups = rollupDefects(defects);
  const assistantCoverageRows = coverage
    .map(toAssistantCoverageRow)
    .sort((left, right) => left.score - right.score)
    .slice(0, 4);
  const chatPostcode = assistantCoverageRows[0]?.postcode ?? null;
  const activeJobTone = activeJobs > 0 ? "blue" : "green";
  const researchHealthy = needsAttention === 0;
  const killSwitchNote = policyStats.total
    ? `${policyStats.active}/${policyStats.total} policies active`
    : "No refresh policies configured";

  return (
    <main className="operator-os">
      <section className="operator-os-main">
        <header className="operator-os-hero">
          <div>
            <p className="operator-os-eyebrow">
              <Activity aria-hidden size={14} /> Research Ops
            </p>
            <h1>Operator OS</h1>
            <p>Command center for Hermes research operations. Live control, coverage, defects, skills, files, and evidence.</p>
          </div>
        </header>

        <nav className="operator-os-tabs" aria-label="Research Ops sections">
          {["Overview", "Chat", "Skills", "Files", "Inspect"].map((tab, index) => (
            <a className={index === 0 ? "active" : ""} href={`#${tab.toLowerCase()}`} key={tab}>
              {tab}
            </a>
          ))}
        </nav>

        <section className="operator-os-status-grid" id="overview" aria-label="Research status summary">
          <StatusTile icon={Gauge} label="Research status" value={researchHealthy ? "Healthy" : "Needs attention"} note={researchHealthy ? "All systems operational" : `${needsAttention} operator items open`} tone={researchHealthy ? "green" : "rose"} />
          <StatusTile icon={BarChart3} label="Active jobs" value={String(activeJobs)} note={`${runningJobs} running - ${queuedJobs} queued`} tone={activeJobTone} />
          <StatusTile icon={Activity} label="Coverage" value={`${coveragePercent}%`} note="Postcode coverage" tone={coveragePercent > 70 ? "green" : coveragePercent > 35 ? "amber" : "rose"} />
          <StatusTile icon={AlertTriangle} label="Needs attention" value={String(needsAttention)} note="Jobs - Coverage - Defects" tone={needsAttention ? "rose" : "green"} />
          <StatusTile icon={Clock3} label="Last run" value={lastRunAge} note={lastRunTarget} tone={lastRun?.status === "failed" ? "rose" : "blue"} />
          <StatusTile icon={Shield} label="Kill switch" value={policyStats.paused ? "ON" : "OFF"} note={killSwitchNote} tone={policyStats.paused ? "rose" : "blue"} />
        </section>

        <section className="operator-attention-strip" aria-label="Needs attention">
          <div className="operator-section-title">
            <AlertTriangle aria-hidden size={18} />
            <h2>Needs attention</h2>
          </div>
          <AttentionStat value={failedJobs} label="Jobs failing" />
          <AttentionStat value={defects.length} label="Coverage defects" />
          <AttentionStat value={staleJobs} label="Stale claims" />
          <AttentionStat value={blockedJobs} label="Blocked jobs" />
          <a className="button secondary compact" href="/api/operator/research/jobs?status=failed" target="_blank" rel="noreferrer">
            View all issues
          </a>
        </section>

        <section className="operator-os-grid">
          <section className="operator-card operator-card-coverage">
            <CardHeader title="Coverage by postcode" action={`${coveragePercent}% overall coverage`} />
            <div className="operator-coverage-list">
              {topCoverage.map((row) => {
                const score = coverageScore(row);
                return (
                  <div className="operator-coverage-row" key={`${row.state}-${row.postcode}`}>
                    <div>
                      <strong>{row.postcode}</strong>
                      <span>{row.state}</span>
                    </div>
                    <div className="operator-progress" aria-label={`${row.postcode} coverage ${score}%`}>
                      <span style={{ width: `${score}%` }} />
                    </div>
                    <span>{score}%</span>
                  </div>
                );
              })}
              {topCoverage.length === 0 ? <p className="item-meta">No postcodes configured yet.</p> : null}
            </div>
            <a className="operator-text-link" href="/api/operator/research/coverage" target="_blank" rel="noreferrer">
              View coverage matrix <ArrowUpRight size={14} />
            </a>
          </section>

          <section className="operator-card operator-card-queue">
            <CardHeader title="Research queue" action={`${activeJobs} active`} />
            <div className="operator-status-tabs">
              {STATUS_TABS.map((tab) => (
                <span className={tab === "All" ? "active" : ""} key={tab}>
                  {tab}
                  <b>{queueTabCount(tab, { activeJobs, runningJobs, queuedJobs, retryJobs, blockedJobs, failedJobs })}</b>
                </span>
              ))}
            </div>
            <table className="operator-mini-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Type</th>
                  <th>Postcode</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {workQueueJobs.slice(0, 5).map((job) => (
                  <tr key={job.id}>
                    <td>
                      <a href={`/api/operator/research/jobs/${job.id}`} target="_blank" rel="noreferrer">
                        {shortId(job.id)}
                      </a>
                    </td>
                    <td>{compactJobType(job.job_type)}</td>
                    <td>{payloadPostcode(job)}</td>
                    <td>
                      <StatusPill tone={jobTone(job)}>{job.is_stale_claim ? "Stale" : titleCase(job.status)}</StatusPill>
                    </td>
                    <td>{formatRelativeTime(job.updated_at)}</td>
                  </tr>
                ))}
                {workQueueJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No research queue items are visible.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div className="operator-card-footer">
              <a className="operator-text-link" href="/api/operator/research/jobs" target="_blank" rel="noreferrer">
                View all jobs <ArrowUpRight size={14} />
              </a>
              <a className="button secondary compact" href="/api/operator/research/jobs" target="_blank" rel="noreferrer">
                <Plus size={14} /> Queue API
              </a>
            </div>
          </section>

          <section className="operator-card operator-card-defects">
            <CardHeader title="Defects" action="Last 24h" />
            <div className="operator-defect-list">
              {defectRollups.map((defect) => (
                <div className="operator-defect-row" key={defect.label}>
                  <span>{defect.label}</span>
                  <strong>{defect.count}</strong>
                  <em className={defect.tone}>{defect.detail}</em>
                </div>
              ))}
            </div>
            <a className="operator-text-link" href="/api/operator/research/defects" target="_blank" rel="noreferrer">
              View all defects <ArrowUpRight size={14} />
            </a>
          </section>

          <section className="operator-card operator-card-runs">
            <CardHeader title="Recent runs" action="View all runs" href="/api/operator/research/runs" />
            <table className="operator-mini-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Postcode</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 5).map((run) => (
                  <tr key={run.id}>
                    <td>
                      <a href={`/api/operator/research/runs/${run.id}/raw`} target="_blank" rel="noreferrer">
                        {shortId(run.id)}
                      </a>
                    </td>
                    <td>{run.target_value.slice(0, 12)}</td>
                    <td>
                      <StatusPill tone={runTone(run.status)}>{titleCase(run.status)}</StatusPill>
                    </td>
                    <td>{formatDuration(run.started_at, run.completed_at)}</td>
                    <td>{formatRelativeTime(run.completed_at ?? run.started_at)}</td>
                  </tr>
                ))}
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No fetch runs logged yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="operator-card operator-card-saved">
            <CardHeader title="Saved ads" action="View library" href="/research" />
            <div className="operator-saved-ads">
              <strong>{adLibraryStats.activeCards}</strong>
              <span>active customer-visible ads</span>
              <div className="operator-saved-ad-metrics">
                <span>Total cards</span>
                <b>{adLibraryStats.totalCards}</b>
                <span>Cards with stored media</span>
                <b>{adLibraryStats.cardsWithStoredMedia}</b>
                <span>Media blobs</span>
                <b>{fileInventory.mediaBlobs}</b>
              </div>
            </div>
          </section>

          <section className="operator-card operator-card-health">
            <CardHeader title="System health" action={researchHealthy ? "Operational" : "Review"} />
            <div className="operator-health-list">
              <HealthRow label="Hermes skill files" ok={skills.length > 0} />
              <HealthRow label="Work queue" ok={failedJobs === 0 && blockedJobs === 0} />
              <HealthRow label="Evidence documents" ok={fileInventory.sourceDocuments > 0 || runs.length === 0} />
              <HealthRow label="Media archive" ok={!fileInventory.mediaError} />
              <HealthRow label="Scheduler policies" ok={policyStats.total > 0 && !policyStats.paused} />
            </div>
            <a className="operator-text-link" href="/api/health" target="_blank" rel="noreferrer">
              View health details <ArrowUpRight size={14} />
            </a>
          </section>
        </section>

        <section className="operator-lower-grid">
          <section className="operator-card" id="skills">
            <CardHeader title="Skills" action={`${skills.length} live skill files`} href="/api/operator/research/skills" />
            <div className="operator-skill-grid">
              {skills.map((skill) => (
                <article className="operator-skill-card" key={skill.slug}>
                  <Wrench aria-hidden size={16} />
                  <div>
                    <strong>{skill.title}</strong>
                    <span>{skill.slug}</span>
                    <p>{skill.purpose}</p>
                    <div className="operator-skill-meta">
                      <span>{formatBytes(skill.byteSize)}</span>
                      <span>{formatRelativeTime(skill.updatedAt)}</span>
                      <span>{skill.sha256.slice(0, 10)}</span>
                    </div>
                    <div className="operator-skill-actions">
                      <a href={`/api/operator/research/skills/${skill.slug}`} target="_blank" rel="noreferrer">
                        Open
                      </a>
                      <a href={`/api/operator/research/skills/${skill.slug}?mode=edit`} target="_blank" rel="noreferrer">
                        Edit
                      </a>
                    </div>
                  </div>
                </article>
              ))}
              {skills.length === 0 ? <p className="item-meta">No Hermes skill files were found in hermes/skills.</p> : null}
            </div>
          </section>

          <section className="operator-card" id="files">
            <CardHeader title="Files" action={`${fileInventory.sourceDocuments + fileInventory.mediaBlobs + fileInventory.buildRunReports + fileInventory.skillFiles} indexed`} href="/api/operator/research/files" />
            <div className="operator-file-list">
              <FileRow icon={FileSearch} label="Source documents" value={`${fileInventory.sourceDocuments} evidence rows`} href="/api/operator/research/files?kind=source_documents" />
              <FileRow icon={Bot} label="Agent index" value={`${entityCounts.agents} agents / ${entityCounts.advertiserPages} pages`} href="/api/operator/research/coverage" />
              <FileRow icon={FolderOpen} label="Creative media" value={`${fileInventory.mediaBlobs} media blobs`} href="/api/operator/research/files?kind=media_blobs" />
              <FileRow icon={TerminalSquare} label="Runtime skills" value={`${fileInventory.skillFiles} SKILL.md files`} href="/api/operator/research/skills" />
              <FileRow icon={AlertTriangle} label="Run reports" value={`${fileInventory.buildRunReports} reports`} href="/api/operator/research/files?kind=build_run_reports" />
            </div>
          </section>
        </section>

        <section className="operator-card operator-inspect" id="inspect">
          <CardHeader title="Inspect data" action="Open evidence JSON" href="/api/operator/research/files?kind=source_documents" />
          <div className="operator-sql-line">select * from research.v_agent_ad_history order by last_seen_at desc limit 50;</div>
          <p className="item-meta">{recentAds.length} rows loaded from research.v_agent_ad_history.</p>
          <table className="operator-mini-table operator-inspect-table">
            <thead>
              <tr>
                <th>Postcode</th>
                <th>Agency</th>
                <th>Format</th>
                <th>Type</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {recentAds.slice(0, 8).map((ad) => (
                <tr key={ad.observed_ad_id}>
                  <td>{ad.primary_intent === "postcode" ? ad.primary_intent : payloadFromAd(ad)}</td>
                  <td>{ad.agency_name ?? ad.page_name ?? "Advertiser page"}</td>
                  <td>{ad.format ?? "-"}</td>
                  <td>{ad.ad_type ?? ad.primary_intent ?? "-"}</td>
                  <td>{formatRelativeTime(ad.last_seen_at ?? ad.first_seen_at)}</td>
                </tr>
              ))}
              {recentAds.length === 0 ? (
                <tr>
                  <td colSpan={5}>No ad rows available yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <footer className="operator-os-footer">
          <span className="operator-live-dot">Live</span>
          <span>Time (AWST) {new Date().toLocaleTimeString("en-AU", { timeZone: "Australia/Perth" })}</span>
          <span>Environment Production</span>
          <span>Region Australia</span>
          <span>Spend 24h ${totalCost24h.toFixed(2)}</span>
          <a href="https://hermes.blockwise.sale" target="_blank" rel="noreferrer">
            Open Hermes Workspace <ExternalLink size={13} />
          </a>
        </footer>
      </section>

      <OperatorAssistant initialRows={assistantCoverageRows} initialPostcode={chatPostcode} lastUpdated={lastRunAge} />
    </main>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  tone: "green" | "amber" | "rose" | "blue";
}) {
  return (
    <article className={`operator-status-tile ${tone}`}>
      <div>
        <span>{label}</span>
        <span className="operator-status-icon">
          <Icon aria-hidden size={16} />
        </span>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function AttentionStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="operator-attention-stat">
      <AlertTriangle aria-hidden size={14} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function CardHeader({ title, action, href }: { title: string; action?: string; href?: string }) {
  return (
    <div className="operator-card-header">
      <h2>{title}</h2>
      {href ? (
        <a href={href} target={href.startsWith("/api") ? "_blank" : undefined} rel={href.startsWith("/api") ? "noreferrer" : undefined}>
          {action} <ArrowUpRight size={13} />
        </a>
      ) : action ? (
        <span>{action}</span>
      ) : null}
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="operator-health-row">
      <span>{label}</span>
      <strong className={ok ? "green" : "rose"}>{ok ? "Operational" : "Review"}</strong>
    </div>
  );
}

function FileRow({ icon: Icon, label, value, href }: { icon: LucideIcon; label: string; value: string; href?: string }) {
  const content = (
    <>
      <Icon aria-hidden size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (href) {
    const opensNewTab = href.startsWith("/api") || href.startsWith("http");
    return (
      <a className="operator-file-row" href={href} target={opensNewTab ? "_blank" : undefined} rel={opensNewTab ? "noreferrer" : undefined}>
        {content}
      </a>
    );
  }

  return (
    <div className="operator-file-row">
      {content}
    </div>
  );
}

function hasStoredMedia(row: AdLibraryCardRow): boolean {
  return Boolean(
    row.image_storage_path ||
      row.video_storage_path ||
      (Array.isArray(row.media_assets) && row.media_assets.length > 0),
  );
}

function rollupDefects(defects: DefectRow[]): DefectRollup[] {
  const validation = defects.filter((defect) => /validation|verify|evidence|roster/iu.test(defect.notes)).length;
  const processing = defects.filter((defect) => /processing|collector|resolver|classifier/iu.test(defect.notes)).length;
  const timeouts = defects.filter((defect) => /timeout|blocked|rate|login/iu.test(defect.notes)).length;
  const dataGaps = Math.max(0, defects.length - validation - processing - timeouts);

  return [
    { label: "Validation errors", count: validation, detail: validation ? "open" : "clear", tone: validation ? "rose" : "green" },
    { label: "Processing failures", count: processing, detail: processing ? "open" : "clear", tone: processing ? "rose" : "green" },
    { label: "Timeouts", count: timeouts, detail: timeouts ? "open" : "clear", tone: timeouts ? "amber" : "green" },
    { label: "Data gaps", count: dataGaps, detail: dataGaps ? "open" : "clear", tone: dataGaps ? "rose" : "green" },
  ];
}

function queueTabCount(
  tab: string,
  counts: { activeJobs: number; runningJobs: number; queuedJobs: number; retryJobs: number; blockedJobs: number; failedJobs: number },
): number {
  switch (tab) {
    case "Running":
      return counts.runningJobs;
    case "Queued":
      return counts.queuedJobs;
    case "Retry":
      return counts.retryJobs;
    case "Blocked":
      return counts.blockedJobs;
    case "Failed":
      return counts.failedJobs;
    case "All":
    default:
      return counts.activeJobs;
  }
}

function coverageScore(row: CoverageRow): number {
  if (typeof row.last_audit_score === "number") {
    return clamp(Math.round(row.last_audit_score), 0, 100);
  }
  if (row.live_active_ads > 0) {
    return clamp(55 + row.live_active_ads * 8, 55, 100);
  }
  if (row.last_refreshed_at) {
    return 35;
  }
  return 0;
}

function toAssistantCoverageRow(row: CoverageRow): OperatorAssistantCoverageRow {
  return {
    postcode: row.postcode,
    state: row.state,
    score: coverageScore(row),
    activeAds: row.live_active_ads ?? 0,
    advertiserPages: row.live_advertiser_pages ?? 0,
    health: row.health,
  };
}

function compactJobType(value: string): string {
  return value
    .replace(/^blockwise-/u, "")
    .replace(/-/gu, "_")
    .replace(/^ad_collector$/u, "fetch_ads")
    .replace(/^agent_census$/u, "refresh_postcode");
}

function payloadPostcode(job: WorkQueueRow): string {
  const payload = parsePayload(job);
  const value = payload.postcode ?? payload.targetPostcode ?? payload.target_value;
  return typeof value === "string" ? value : "-";
}

function parsePayload(job: WorkQueueRow): Record<string, unknown> {
  const value = (job as unknown as { payload?: unknown }).payload;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function payloadFromAd(ad: RecentAdRow): string {
  const classification = ad.classification ?? {};
  const value = classification.postcode ?? classification.primary_postcode ?? classification.suburb;
  return typeof value === "string" ? value : "-";
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 3)}_${value.slice(-8)}` : value;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const started = new Date(startedAt).getTime();
  const completed = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (Number.isNaN(started) || Number.isNaN(completed)) return "-";
  const seconds = Math.max(0, Math.round((completed - started) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function formatRelativeTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? "ago" : "from now";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ${suffix}`;
  const days = Math.round(hours / 24);
  return `${days}d ${suffix}`;
}

function jobTone(job: WorkQueueRow): "green" | "amber" | "rose" | "blue" {
  if (job.status === "complete") return "green";
  if (job.status === "failed" || job.status === "blocked") return "rose";
  if (job.is_stale_claim) return "amber";
  if (job.status === "pending") return "amber";
  return "blue";
}

function runTone(status: string): "green" | "amber" | "rose" | "blue" {
  if (status === "success") return "green";
  if (status === "failed") return "rose";
  if (status === "partial") return "amber";
  return "blue";
}

function titleCase(value: string): string {
  return value.replace(/_/gu, " ").replace(/\b\w/gu, (match) => match.toUpperCase());
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
