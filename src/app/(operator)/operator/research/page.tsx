import {
  Activity,
  AlertOctagon,
  ChevronRight,
  ExternalLink,
  PauseOctagon,
  RefreshCcw,
  ShieldCheck,
  Signal,
  Timer,
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

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
  live_advertiser_pages: number;
  live_agents: number;
  live_agencies: number;
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

async function loadCoverage(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase.schema("research").from("v_coverage_status").select("*").order("priority").order("postcode");
  return (data ?? []) as CoverageRow[];
}

async function loadRuns(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase
    .schema("research")
    .from("ad_fetch_runs")
    .select("id,source_provider,role,target_kind,target_value,started_at,completed_at,status,cost_usd,result_summary,error")
    .order("started_at", { ascending: false })
    .limit(20);
  return (data ?? []) as RunRow[];
}

async function loadDefects(supabase: Awaited<ReturnType<typeof requirePageSurfaceAccess>>["supabase"]) {
  const { data } = await supabase.schema("research").from("v_missing_competitors").select("*").limit(30);
  return (data ?? []) as DefectRow[];
}

export default async function OperatorResearchPage() {
  const { supabase } = await requirePageSurfaceAccess("monitor");
  const [coverage, runs, defects] = await Promise.all([
    loadCoverage(supabase).catch(() => [] as CoverageRow[]),
    loadRuns(supabase).catch(() => [] as RunRow[]),
    loadDefects(supabase).catch(() => [] as DefectRow[]),
  ]);

  const liveAds = coverage.reduce((acc, r) => acc + (r.live_active_ads ?? 0), 0);
  const liveAgents = coverage.reduce((acc, r) => acc + (r.live_agents ?? 0), 0);
  const openDefects = defects.length;
  const failedRunsLast20 = runs.filter((r) => r.status === "failed").length;
  const totalCost24h = runs
    .filter((r) => new Date(r.started_at).getTime() > Date.now() - 24 * 3600 * 1000)
    .reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);

  const externalLinks = [
    { label: "AionUi cockpit", url: "https://aion.blockwise.sale", note: "Visual Hermes control" },
    { label: "Coolify", url: "https://coolify.blockwise.sale", note: "VPS / deploy / logs" },
    { label: "Hermes admin", url: "https://hermes.blockwise.sale", note: "Skill management" },
    { label: "Uptime Kuma", url: "https://uptime.blockwise.sale", note: "Service monitors" },
  ];

  return (
    <main className="content">
      <PageHeading
        eyebrow="Research engine"
        title="Operator control"
        description="Live coverage, fetch runs, defects, and the kill switch for the Hermes-driven research engine."
      />

      <section className="grid cols-4">
        <MetricCard icon={Signal} label="Live active ads" value={String(liveAds)} note="Across all covered postcodes" />
        <MetricCard icon={Activity} label="Known agents" value={String(liveAgents)} note="From census + page resolution" />
        <MetricCard icon={AlertOctagon} label="Open defects" value={String(openDefects)} note="Gaps awaiting investigation" />
        <MetricCard icon={Timer} label="24h collector spend" value={`$${totalCost24h.toFixed(2)}`} note={`${failedRunsLast20} failed in last 20 runs`} />
      </section>

      <section className="panel">
        <h2>External cockpits</h2>
        <div className="grid cols-4">
          {externalLinks.map((link) => (
            <a key={link.label} className="item-card" href={link.url} target="_blank" rel="noreferrer">
              <h3>
                {link.label} <ExternalLink size={14} />
              </h3>
              <p className="item-meta">{link.note}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="row-between">
          <h2>Coverage status</h2>
          <form method="post" action="/api/operator/research/kill-switch">
            <input type="hidden" name="paused" value="true" />
            <button className="button secondary" type="submit">
              <PauseOctagon size={14} /> Pause scheduler
            </button>
          </form>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Postcode</th>
              <th>Priority</th>
              <th>Cadence</th>
              <th>Last run</th>
              <th>Active ads</th>
              <th>Pages</th>
              <th>Health</th>
              <th>Audit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={`${row.postcode}-${row.state}`}>
                <td>
                  {row.postcode} <span className="muted">{row.state}</span>
                </td>
                <td>{row.priority}</td>
                <td>{row.refresh_cadence_minutes} min</td>
                <td>{row.last_refreshed_at ? new Date(row.last_refreshed_at).toLocaleString() : "—"}</td>
                <td>{row.live_active_ads}</td>
                <td>{row.live_advertiser_pages}</td>
                <td>
                  <StatusPill tone={healthTone(row.health)}>{row.health}</StatusPill>
                </td>
                <td>{row.last_audit_status ? `${row.last_audit_status} (${row.last_audit_score ?? 0})` : "never"}</td>
                <td>
                  <form method="post" action="/api/operator/research/refresh-now">
                    <input type="hidden" name="scope" value="postcode" />
                    <input type="hidden" name="value" value={row.postcode} />
                    <button className="button secondary" type="submit">
                      <RefreshCcw size={14} /> Run
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {coverage.length === 0 && (
              <tr>
                <td colSpan={9}>No postcodes configured. Insert into research.refresh_policies to begin.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recent fetch runs</h2>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Provider</th>
              <th>Target</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString()}</td>
                <td>{r.source_provider}</td>
                <td>
                  <span className="muted">{r.target_kind}</span> {r.target_value.slice(0, 20)}
                </td>
                <td>
                  <StatusPill tone={r.status === "success" ? "green" : r.status === "failed" ? "rose" : "amber"}>
                    {r.status}
                  </StatusPill>
                </td>
                <td>${(Number(r.cost_usd) || 0).toFixed(4)}</td>
                <td>
                  {r.result_summary ? (
                    <span>
                      new {String((r.result_summary as Record<string, unknown>).adsNew ?? 0)}, upd{" "}
                      {String((r.result_summary as Record<string, unknown>).adsUpdated ?? 0)}, miss{" "}
                      {String((r.result_summary as Record<string, unknown>).adsMissing ?? 0)}
                    </span>
                  ) : r.error ? (
                    <span className="muted">{r.error.slice(0, 80)}</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6}>No fetch runs yet. The orchestrator will start logging here on first tick.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Open coverage defects</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Where</th>
              <th>Agent / Agency</th>
              <th>Notes</th>
              <th>Reporter</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.postcode ?? "—"} {d.suburb ? `(${d.suburb})` : ""}
                </td>
                <td>{d.agent_name ?? d.agency_name ?? "—"}</td>
                <td>{d.notes.slice(0, 120)}</td>
                <td>{d.reported_by}</td>
                <td>
                  <StatusPill tone={d.status === "open" ? "rose" : "amber"}>{d.status}</StatusPill>
                </td>
                <td>
                  <a className="button secondary" href={`/operator/research/defects/${d.id}`}>
                    Investigate <ChevronRight size={14} />
                  </a>
                </td>
              </tr>
            ))}
            {defects.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <ShieldCheck size={14} /> No open coverage defects. Auditor will populate this when it next runs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function healthTone(health: string): "green" | "amber" | "rose" | "blue" {
  switch (health) {
    case "healthy":
      return "green";
    case "refresh_overdue":
    case "audit_overdue":
      return "amber";
    case "gap_known":
      return "rose";
    case "never_audited":
    default:
      return "blue";
  }
}
