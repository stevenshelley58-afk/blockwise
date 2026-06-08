"use client";

import { useState } from "react";

import { CONSOLE_STYLES } from "./research-console-styles";

export type ConsoleHeartbeat = {
  ageSeconds: number | null;
  mode: string;
};

export type ConsoleSpend = {
  today: number;
  cap: number;
};

export type ConsolePolicy = {
  total: number;
  active: number;
  paused: boolean;
  nextRefreshAt: string | null;
};

export type ConsoleStats = {
  needsAttention: number;
  activeJobs: number;
  runningJobs: number;
  queuedJobs: number;
  blockedJobs: number;
  failedJobs: number;
  staleJobs: number;
  coveragePercent: number;
  liveAds: number;
};

export type ConsolePipelineStage = {
  key: string;
  label: string;
  pending: number;
  claimed: number;
  failed: number;
  blocked: number;
};

export type ConsoleCoverageRow = {
  postcode: string;
  state: string;
  score: number;
  activeAds: number;
  advertiserPages: number;
  nextRefreshAt: string | null;
  lastRefreshedAt: string | null;
  health: string;
  policyActive: boolean;
};

export type ConsoleQueueRow = {
  id: string;
  jobType: string;
  subject: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  status: string;
  isStale: boolean;
  blockedReason: string | null;
  lastError: string | null;
  updatedAt: string;
};

export type ConsoleDefectRow = {
  id: string;
  notes: string;
  status: string;
  createdAt: string;
};

export type ConsoleDecisionRow = {
  id: string;
  decidedAt: string;
  decisionType: string;
  subjectType: string;
  subjectId: string;
  confidence: number;
  model: string | null;
  skill: string | null;
  rationale: string | null;
};

export type ConsoleInventory = {
  sourceDocuments: number;
  mediaAssets: number;
  mediaFailed: number;
  buildRunReports: number;
  decisionCount: number;
  skillFiles: number;
};

export type ConsoleEntityCounts = {
  agents: number;
  advertiserPages: number;
};

export type ConsoleAdLibrary = {
  activeCards: number;
  totalCards: number;
  cardsWithStoredMedia: number;
};

export type ConsoleOfficialMetaApi = {
  configured: boolean;
  tokenName: string | null;
  maxPagesPerSearch: number;
};

export type ConsoleSkill = {
  slug: string;
  title: string;
  purpose: string;
  byteSize: number;
  updatedAt: string;
  cron: string | null;
};

export type ResearchConsoleProps = {
  heartbeat: ConsoleHeartbeat;
  spend: ConsoleSpend;
  policy: ConsolePolicy;
  stats: ConsoleStats;
  pipeline: ConsolePipelineStage[];
  stalePagesDue: number;
  coverage: ConsoleCoverageRow[];
  queue: ConsoleQueueRow[];
  defects: ConsoleDefectRow[];
  decisions: ConsoleDecisionRow[];
  inventory: ConsoleInventory;
  entity: ConsoleEntityCounts;
  adLibrary: ConsoleAdLibrary;
  officialMetaApi: ConsoleOfficialMetaApi;
  skills: ConsoleSkill[];
  nowIso: string;
};

const SECTIONS = [
  { key: "overview", label: "Overview", icon: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z", group: "Monitor" },
  { key: "pipeline", label: "Pipeline", icon: "M4 17l6-6-4-4M12 19h8", group: "Monitor" },
  { key: "coverage", label: "Coverage", icon: "M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", group: "Monitor" },
  { key: "queue", label: "Queue", icon: "M4 6h16M4 12h16M4 18h16", group: "Monitor" },
  { key: "defects", label: "Defects", icon: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", group: "Operate" },
  { key: "decisions", label: "Decisions", icon: "M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11", group: "Operate" },
  { key: "data", label: "Data & files", icon: "M12 3c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3zM3 6v12c0 1.66 4.03 3 9 3s9-1.34 9-3V6", group: "Operate" },
  { key: "skills", label: "Skills", icon: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2 2.8-2.8z", group: "Operate" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

type QueueFilter = "all" | "claimed" | "pending" | "blocked" | "failed" | "stale";

export function ResearchConsole(props: ResearchConsoleProps) {
  const [section, setSection] = useState<SectionKey>("overview");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const [openDecision, setOpenDecision] = useState<string | null>(null);

  const { heartbeat, spend, policy, stats, pipeline, stalePagesDue, coverage, queue, defects, decisions, inventory, entity, adLibrary, officialMetaApi, skills } = props;

  const spendPercent = spend.cap > 0 ? Math.min(100, Math.round((spend.today / spend.cap) * 100)) : 0;
  const heartbeatTone = heartbeat.ageSeconds === null ? "bad" : heartbeat.ageSeconds < 60 ? "" : heartbeat.ageSeconds < 600 ? "warn" : "bad";
  const heartbeatLabel = heartbeat.ageSeconds === null ? "no events" : `tick ${formatSeconds(heartbeat.ageSeconds)} ago`;
  const openDefects = defects.filter((defect) => defect.status === "open" || defect.status === "blocked" || defect.status === "investigating");
  const attentionJobs = queue.filter((job) => job.status === "failed" || job.status === "blocked" || job.isStale).slice(0, 5);
  const filteredQueue = queue.filter((job) => {
    if (queueFilter === "all") return true;
    if (queueFilter === "stale") return job.isStale;
    return job.status === queueFilter;
  });

  return (
    <div className="rops">
      <style>{CONSOLE_STYLES}</style>
      <div className="rops-topbar">
        <span className="rops-mark">B</span>
        <h1>Blockwise</h1>
        <span className="rops-divider" />
        <span className="rops-crumb">Research ops</span>
        <span className="rops-meta">
          <span className={`rops-dot ${heartbeatTone}`.trim()} /> {heartbeatLabel} · {heartbeat.mode}
        </span>
        <span className="rops-meta">
          ${spend.today.toFixed(2)}
          <span className="rops-spendbar">
            <span style={{ width: `${spendPercent}%` }} />
          </span>
          ${spend.cap.toFixed(0)}
        </span>
        <div className="rops-topactions">
          <form method="post" action="/api/operator/research/refresh-now">
            <select className="rops-select" name="scope" defaultValue="postcode" aria-label="Refresh scope">
              <option value="postcode">postcode</option>
              <option value="advertiser_page">page</option>
            </select>
            <input className="rops-input" name="value" defaultValue="" placeholder="6011" style={{ width: 76 }} aria-label="Refresh target" required />
            <button className="rops-btn primary" type="submit">Refresh now</button>
          </form>
          <form method="post" action="/api/operator/research/kill-switch">
            <input type="hidden" name="paused" value={policy.paused ? "false" : "true"} />
            <button className={`rops-btn danger${policy.paused ? " on" : ""}`} type="submit">
              {policy.paused ? "Scheduler paused — resume" : "Kill switch"}
            </button>
          </form>
        </div>
      </div>

      <div className="rops-body">
        <nav className="rops-rail" aria-label="Research sections">
          {(["Monitor", "Operate"] as const).map((group) => (
            <div key={group}>
              <p className="rops-rail-label">{group}</p>
              {SECTIONS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rops-navb${section === item.key ? " on" : ""}`}
                  onClick={() => setSection(item.key)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={item.icon} />
                  </svg>
                  {item.label}
                  {item.key === "queue" ? <span className="rops-cnt">{stats.activeJobs}</span> : null}
                  {item.key === "coverage" ? <span className="rops-cnt">{coverage.length}</span> : null}
                  {item.key === "defects" && openDefects.length > 0 ? <span className="rops-cnt bad">{openDefects.length}</span> : null}
                  {item.key === "skills" ? <span className="rops-cnt">{skills.length}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="rops-main">
          {section === "overview" ? (
            <>
              <div className="rops-stat-grid">
                <StatCard label="health" value={stats.needsAttention === 0 ? "Healthy" : `${stats.needsAttention} items`} tone={stats.needsAttention === 0 ? undefined : "warn"} />
                <StatCard label="active jobs" value={String(stats.activeJobs)} />
                <StatCard label="coverage" value={`${stats.coveragePercent}%`} />
                <StatCard label="live ads" value={stats.liveAds.toLocaleString()} />
                <StatCard label="official api" value={officialMetaApi.configured ? "Ready" : "Missing token"} tone={officialMetaApi.configured ? undefined : "warn"} />
                <StatCard label="spend 24h" value={`$${spend.today.toFixed(2)}`} />
              </div>
              <section className="rops-card">
                <h3>Needs attention</h3>
                <table className="rops-table">
                  <tbody>
                    {attentionJobs.map((job) => (
                      <tr key={job.id}>
                        <td style={{ width: "54%" }}>
                          <span className={`rops-pill ${job.isStale ? "warn" : "bad"}`}>{job.isStale ? "stale" : job.status}</span>{" "}
                          {compactJobType(job.jobType)} — {job.subject}
                        </td>
                        <td style={{ width: "14%", color: "var(--muted)" }}>{formatRelativeTime(job.updatedAt)}</td>
                        <td className="r" style={{ width: "32%" }}>
                          <RequeueForm jobId={job.id} />
                        </td>
                      </tr>
                    ))}
                    {openDefects.slice(0, 3).map((defect) => (
                      <tr key={defect.id}>
                        <td style={{ width: "54%" }}>
                          <span className="rops-pill bad">defect</span> {defect.notes.slice(0, 80)}
                        </td>
                        <td style={{ width: "14%", color: "var(--muted)" }}>{formatRelativeTime(defect.createdAt)}</td>
                        <td className="r" style={{ width: "32%" }}>
                          <InvestigateForm defectId={defect.id} disabled={defect.status === "investigating"} />
                        </td>
                      </tr>
                    ))}
                    {attentionJobs.length === 0 && openDefects.length === 0 ? (
                      <tr>
                        <td>Nothing needs attention right now.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                <p className="rops-src">research.v_operator_work_queue_diagnostics · v_missing_competitors</p>
              </section>
              <section className="rops-card">
                <h3>Pipeline at a glance</h3>
                <div className="rops-glance">
                  {pipeline.map((stage) => {
                    const active = stage.pending + stage.claimed;
                    const trouble = stage.failed + stage.blocked;
                    return (
                      <div key={stage.key}>
                        {stage.label}
                        <b>{active}</b>
                        <span className={`rops-pill ${trouble > 0 ? "bad" : "ok"}`} style={{ marginTop: 3 }}>
                          {trouble > 0 ? `${trouble} blk` : "ok"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          ) : null}

          {section === "pipeline" ? (
            <>
              <div className="rops-pipe-grid">
                {pipeline.map((stage, index) => (
                  <section className="rops-card" key={stage.key}>
                    <p className="ttl">{index + 1} · {stage.label}</p>
                    <p>
                      queued {stage.pending} · running {stage.claimed}
                      <br />
                      failed {stage.failed} · blocked {stage.blocked}
                    </p>
                  </section>
                ))}
              </div>
              <section className="rops-card">
                <h3>Scheduler</h3>
                <table className="rops-table">
                  <tbody>
                    <tr>
                      <td style={{ width: "44%" }}>Supervisor heartbeat</td>
                      <td style={{ width: "30%", color: "var(--muted)" }}>tick every 10 s</td>
                      <td className="r"><span className={`rops-pill ${heartbeatTone === "" ? "ok" : heartbeatTone === "warn" ? "warn" : "bad"}`}>{heartbeatLabel}</span></td>
                    </tr>
                    <tr>
                      <td>Refresh policies</td>
                      <td style={{ color: "var(--muted)" }}>{policy.active}/{policy.total} active</td>
                      <td className="r">
                        {policy.paused ? <span className="rops-pill bad">paused</span> : <span className="rops-pill ok">running</span>}
                      </td>
                    </tr>
                    <tr>
                      <td>Next due policy</td>
                      <td style={{ color: "var(--muted)" }}>{policy.nextRefreshAt ? formatRelativeTime(policy.nextRefreshAt) : "—"}</td>
                      <td className="r"><span className="rops-pill info">auto</span></td>
                    </tr>
                    <tr>
                      <td>Stale advertiser pages</td>
                      <td style={{ color: "var(--muted)" }}>6 h refresh interval</td>
                      <td className="r"><span className={`rops-pill ${stalePagesDue > 0 ? "warn" : "ok"}`}>{stalePagesDue} due</span></td>
                    </tr>
                    <tr>
                      <td>Census cron (priority 1)</td>
                      <td style={{ color: "var(--muted)" }}>Mon 03:00 · Perth</td>
                      <td className="r"><span className="rops-pill info">hermes.toml</span></td>
                    </tr>
                    <tr>
                      <td>Coverage audit cron</td>
                      <td style={{ color: "var(--muted)" }}>Mon 05:00 · Perth</td>
                      <td className="r"><span className="rops-pill info">hermes.toml</span></td>
                    </tr>
                  </tbody>
                </table>
                <p className="rops-src">refresh_policies · ingest_events heartbeat · advertiser_pages.last_checked_at</p>
              </section>
            </>
          ) : null}

          {section === "coverage" ? (
            <section className="rops-card">
              <h3>Coverage by postcode</h3>
              <table className="rops-table">
                <thead>
                  <tr>
                    <th style={{ width: "21%" }}>postcode</th>
                    <th style={{ width: "17%" }}>score</th>
                    <th style={{ width: "9%" }}>ads</th>
                    <th style={{ width: "11%" }}>pages</th>
                    <th style={{ width: "20%" }}>next refresh</th>
                    <th style={{ width: "22%" }} />
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((row) => (
                    <tr key={`${row.state}-${row.postcode}`}>
                      <td>{row.postcode} {row.state}</td>
                      <td>
                        <span className="rops-bar">
                          <span style={{ width: `${row.score}%` }} />
                        </span>
                      </td>
                      <td>{row.activeAds}</td>
                      <td>{row.advertiserPages}</td>
                      <td>
                        {!row.policyActive ? (
                          <span className="rops-pill bad">paused</span>
                        ) : row.nextRefreshAt && new Date(row.nextRefreshAt).getTime() < Date.now() ? (
                          <span className="rops-pill warn">due now</span>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>{row.nextRefreshAt ? formatRelativeTime(row.nextRefreshAt) : "—"}</span>
                        )}
                      </td>
                      <td className="r">
                        <form className="rops-actform" method="post" action="/api/operator/research/refresh-now">
                          <input type="hidden" name="scope" value="postcode" />
                          <input type="hidden" name="value" value={row.postcode} />
                          <button className="rops-act" type="submit">Refresh</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {coverage.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No postcodes configured yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className="rops-src">research.v_coverage_status</p>
            </section>
          ) : null}

          {section === "queue" ? (
            <section className="rops-card">
              <div className="rops-cardhead">
                <h3>Work queue</h3>
                <span className="rops-qtabs">
                  {(["all", "claimed", "pending", "blocked", "failed", "stale"] as QueueFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`rops-qtab${queueFilter === filter ? " on" : ""}`}
                      onClick={() => setQueueFilter(filter)}
                    >
                      {filter === "claimed" ? "running" : filter === "pending" ? "queued" : filter}{" "}
                      {filter === "all"
                        ? queue.length
                        : filter === "stale"
                          ? stats.staleJobs
                          : queue.filter((job) => job.status === filter).length}
                    </button>
                  ))}
                </span>
              </div>
              <table className="rops-table">
                <thead>
                  <tr>
                    <th style={{ width: "16%" }}>job</th>
                    <th style={{ width: "19%" }}>type</th>
                    <th style={{ width: "18%" }}>subject</th>
                    <th style={{ width: "7%" }}>pri</th>
                    <th style={{ width: "8%" }}>att</th>
                    <th style={{ width: "16%" }}>status</th>
                    <th style={{ width: "16%" }} />
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.slice(0, 25).map((job) => (
                    <tr key={job.id} title={job.blockedReason ?? job.lastError ?? undefined}>
                      <td>{shortId(job.id)}</td>
                      <td>{compactJobType(job.jobType)}</td>
                      <td>{job.subject}</td>
                      <td>{job.priority}</td>
                      <td>{job.attempts}/{job.maxAttempts}</td>
                      <td>
                        <span className={`rops-pill ${jobPillTone(job)}`}>
                          {job.isStale ? "stale" : job.status}
                        </span>
                      </td>
                      <td className="r">
                        {job.status === "failed" || job.status === "blocked" || job.isStale ? (
                          <RequeueForm jobId={job.id} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No jobs match this filter.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className="rops-src">research.v_operator_work_queue_diagnostics · requeue resets attempts and clears the claim</p>
            </section>
          ) : null}

          {section === "defects" ? (
            <section className="rops-card">
              <h3>Coverage defects</h3>
              <table className="rops-table">
                <tbody>
                  {defects.map((defect) => (
                    <tr key={defect.id}>
                      <td className="wrap" style={{ width: "54%" }}>
                        <span className={`rops-pill ${defect.status === "open" ? "warn" : defect.status === "investigating" ? "info" : "bad"}`}>{defect.status}</span>{" "}
                        {defect.notes.slice(0, 110)}
                      </td>
                      <td style={{ width: "12%", color: "var(--muted)" }}>{formatRelativeTime(defect.createdAt)}</td>
                      <td className="r" style={{ width: "34%" }}>
                        <InvestigateForm defectId={defect.id} disabled={defect.status === "investigating"} />{" "}
                        <form className="rops-actform" method="post" action={`/api/operator/research/defects/${defect.id}/dismiss`}>
                          <button className="rops-act" type="submit" disabled={defect.status === "dismissed" || defect.status === "resolved"}>Dismiss</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {defects.length === 0 ? (
                    <tr>
                      <td>No open defects. Coverage is clean.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className="rops-src">research.coverage_defects · investigate queues blockwise-defect-investigator</p>
            </section>
          ) : null}

          {section === "decisions" ? (
            <section className="rops-card">
              <h3>Decision log</h3>
              <table className="rops-table">
                <thead>
                  <tr>
                    <th style={{ width: "13%" }}>when</th>
                    <th style={{ width: "26%" }}>type</th>
                    <th style={{ width: "29%" }}>subject</th>
                    <th style={{ width: "14%" }}>conf</th>
                    <th style={{ width: "18%" }}>model</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((decision) => (
                    <DecisionRows
                      key={decision.id}
                      decision={decision}
                      open={openDecision === decision.id}
                      onToggle={() => setOpenDecision(openDecision === decision.id ? null : decision.id)}
                    />
                  ))}
                  {decisions.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No decisions recorded yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className="rops-src">research.agent_decisions — every write in the system lands here</p>
            </section>
          ) : null}

          {section === "data" ? (
            <>
              <div className="rops-stat-grid">
                <StatCard label="source docs" value={inventory.sourceDocuments.toLocaleString()} />
                <StatCard label="media assets" value={inventory.mediaAssets.toLocaleString()} tone={inventory.mediaFailed > 0 ? "warn" : undefined} />
                <StatCard label="decisions" value={inventory.decisionCount.toLocaleString()} />
                <StatCard label="run reports" value={inventory.buildRunReports.toLocaleString()} />
              </div>
              <section className="rops-card">
                <h3>Inventory</h3>
                <table className="rops-table">
                  <tbody>
                    <tr>
                      <td style={{ width: "55%" }}>Verified agents / advertiser pages</td>
                      <td style={{ color: "var(--muted)" }}>{entity.agents} / {entity.advertiserPages}</td>
                    </tr>
                    <tr>
                      <td>Customer-visible ad cards</td>
                      <td style={{ color: "var(--muted)" }}>{adLibrary.activeCards} active of {adLibrary.totalCards} ({adLibrary.cardsWithStoredMedia} with media)</td>
                    </tr>
                    <tr>
                      <td>Official Meta API</td>
                      <td style={{ color: "var(--muted)" }}>
                        <span className={`rops-pill ${officialMetaApi.configured ? "ok" : "warn"}`}>
                          {officialMetaApi.configured ? "ready" : "missing token"}
                        </span>{" "}
                        {officialMetaApi.configured
                          ? `${officialMetaApi.tokenName} · ${officialMetaApi.maxPagesPerSearch} validation pages/search`
                          : "required for paginated exhaustive collection"}
                      </td>
                    </tr>
                    <tr>
                      <td>Failed media captures</td>
                      <td style={{ color: "var(--muted)" }}>{inventory.mediaFailed}</td>
                    </tr>
                    <tr>
                      <td>Evidence files API</td>
                      <td>
                        <a href="/api/operator/research/files" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>
                          /api/operator/research/files
                        </a>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="rops-src">source_documents · media_assets · build_run_reports · v_customer_meta_ad_library_cards</p>
              </section>
            </>
          ) : null}

          {section === "skills" ? (
            <div className="rops-skill-grid">
              {skills.map((skill) => (
                <section className="rops-card" key={skill.slug}>
                  <p className="ttl">
                    {skill.title}
                    {skill.cron ? <span className="rops-pill info" style={{ marginLeft: 6 }}>{skill.cron}</span> : null}
                  </p>
                  <p className="desc">{skill.purpose.slice(0, 110)}</p>
                  <p className="desc" style={{ color: "#94a3b8" }}>{formatBytes(skill.byteSize)} · {formatRelativeTime(skill.updatedAt)}</p>
                  <a className="rops-act" style={{ textDecoration: "none", display: "inline-block", marginRight: 6 }} href={`/api/operator/research/skills/${skill.slug}`} target="_blank" rel="noreferrer">Open</a>
                  <a className="rops-act" style={{ textDecoration: "none", display: "inline-block" }} href={`/api/operator/research/skills/${skill.slug}?mode=edit`} target="_blank" rel="noreferrer">Edit</a>
                </section>
              ))}
              {skills.length === 0 ? <p>No Hermes skill files found.</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rops-statusbar">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className={`rops-dot ${heartbeatTone}`.trim()} /> Live
        </span>
        <span>AWST {new Date(props.nowIso).toLocaleTimeString("en-AU", { timeZone: "Australia/Perth", hour: "2-digit", minute: "2-digit" })}</span>
        <span>Mode {heartbeat.mode}</span>
        <span>Spend 24h ${spend.today.toFixed(2)}</span>
        <a href="https://hermes.blockwise.sale" target="_blank" rel="noreferrer" style={{ marginLeft: "auto" }}>
          Open Hermes workspace
        </a>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className="rops-card" style={{ padding: "12px 14px" }}>
      <p className="rops-stat">{label}</p>
      <p className={`rops-stv${tone ? ` ${tone}` : ""}`}>{value}</p>
    </div>
  );
}

function RequeueForm({ jobId }: { jobId: string }) {
  return (
    <form className="rops-actform" method="post" action={`/api/operator/research/jobs/${jobId}/requeue`}>
      <button className="rops-act" type="submit">Requeue</button>
    </form>
  );
}

function InvestigateForm({ defectId, disabled }: { defectId: string; disabled?: boolean }) {
  return (
    <form className="rops-actform" method="post" action={`/api/operator/research/defects/${defectId}/investigate`}>
      <button className="rops-act" type="submit" disabled={disabled}>Investigate</button>
    </form>
  );
}

function DecisionRows({ decision, open, onToggle }: { decision: ConsoleDecisionRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="click" onClick={onToggle}>
        <td>{formatRelativeTime(decision.decidedAt)}</td>
        <td>{decision.decisionType}</td>
        <td>{decision.subjectType} {shortId(decision.subjectId)}</td>
        <td>conf {Math.round(decision.confidence)}</td>
        <td>
          <span className={`rops-pill ${decision.model === "deterministic" ? "info" : decision.skill === "operator-console" ? "ok" : "info"}`}>
            {decision.model ?? decision.skill ?? "—"}
          </span>
        </td>
      </tr>
      {open ? (
        <tr>
          <td className="wrap" colSpan={5} style={{ color: "var(--muted)", fontSize: 12 }}>
            {decision.rationale ?? "No rationale recorded."} {decision.skill ? `· skill ${decision.skill}` : ""}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function jobPillTone(job: ConsoleQueueRow): string {
  if (job.isStale) return "warn";
  if (job.status === "failed" || job.status === "blocked") return "bad";
  if (job.status === "claimed") return "info";
  if (job.status === "complete") return "ok";
  return "info";
}

function compactJobType(value: string): string {
  return value.replace(/^blockwise-/u, "");
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 4)}…${value.slice(-6)}` : value;
}

function formatSeconds(value: number): string {
  if (value < 90) return `${Math.round(value)} s`;
  if (value < 5400) return `${Math.round(value / 60)} m`;
  return `${Math.round(value / 3600)} h`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

function formatRelativeTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const abs = Math.abs(diffMs);
  const suffix = diffMs >= 0 ? "ago" : "away";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} m ${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ${suffix}`;
  return `${Math.round(hours / 24)} d ${suffix}`;
}
