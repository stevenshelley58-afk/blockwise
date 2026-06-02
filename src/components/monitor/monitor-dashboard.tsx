"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Link2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  type MonitorDashboardBundle,
  type MonitorPerformanceRow,
  type MonitorProvider,
  type MonitorRange,
} from "@/lib/monitor/dashboard-data";

type MonitorDashboardProps = {
  initialBundle: MonitorDashboardBundle;
};

type TabKey = "overview" | "ads" | "leads";
type MetaSetup = {
  metaAdAccountId: string;
  pageId: string;
  instagramActorId?: string | null;
  pixelId?: string | null;
  leadDestination: {
    type: "webhook" | "crm" | "email" | "manual";
    label: string;
    config: {
      endpoint?: string;
    };
  };
  privacyPolicyUrl: string;
  currency: string;
  timezone: string;
};

type MetaSetupResponse = {
  connected: boolean;
  setup: MetaSetup | null;
  blockers: string[];
  ready?: boolean;
  health?: { status: string; message: string | null } | null;
  assets?: {
    adAccounts: Array<{ id: string; name: string; currency: string; timezone: string }>;
    pages: Array<{ id: string; name: string }>;
    instagramActors: Array<{ id: string; username: string; pageId?: string }>;
    pixels: Array<{ id: string; name: string }>;
  } | null;
};

const RANGE_OPTIONS: Array<{ value: MonitorRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7", label: "Last 7" },
  { value: "last_30", label: "Last 30" },
];

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "ads", label: "Ads" },
  { key: "leads", label: "Leads" },
];

export function MonitorDashboard({ initialBundle }: MonitorDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [range, setRange] = useState<MonitorRange>(initialBundle.range.key);
  const [bundle, setBundle] = useState(initialBundle);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    void refreshBundle(range, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  async function refreshBundle(nextRange = range, manual = true) {
    setIsRefreshing(true);
    setError(null);

    try {
      const response = await fetch(`/api/monitor-dashboard?range=${nextRange}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Dashboard refresh failed with ${response.status}.`);
      }

      setBundle((await response.json()) as MonitorDashboardBundle);
    } catch (refreshError) {
      if (manual) {
        setError(refreshError instanceof Error ? refreshError.message : "Dashboard refresh failed.");
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function copyReport() {
    const report = buildReportText(bundle);

    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <main className="content monitor-dashboard">
      <section className="monitor-header" aria-label="Monitor controls">
        <div>
          <p className="eyebrow">Monitor</p>
          <h1>Ads dashboard</h1>
          <p className="lead">
            {bundle.range.label} · {formatDate(bundle.range.since)} to {formatDate(bundle.range.until)}
          </p>
        </div>

        <div className="monitor-controls">
          <label className="monitor-select-label">
            <span>Date range</span>
            <select
              className="monitor-select"
              value={range}
              onChange={(event) => setRange(event.target.value as MonitorRange)}
            >
              {RANGE_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary" type="button" onClick={() => void refreshBundle(range)} disabled={isRefreshing}>
            <RefreshCw aria-hidden size={17} />
            {isRefreshing ? "Refreshing" : "Refresh data"}
          </button>
          <button className="button secondary" type="button" onClick={() => void copyReport()}>
            <Clipboard aria-hidden size={17} />
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy report"}
          </button>
        </div>
      </section>

      <ProviderStatusStrip bundle={bundle} />

      {error ? (
        <div className="monitor-alert rose">
          <AlertTriangle aria-hidden size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <nav className="monitor-tabs" aria-label="Monitor dashboard tabs">
        {TABS.map((tab) => (
          <button
            className={tab.key === activeTab ? "active" : ""}
            type="button"
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" ? <OverviewTab bundle={bundle} /> : null}
      {activeTab === "ads" ? <AdsTab bundle={bundle} /> : null}
      {activeTab === "leads" ? <LeadsTab bundle={bundle} /> : null}
    </main>
  );
}

function OverviewTab({ bundle }: { bundle: MonitorDashboardBundle }) {
  return (
    <div className="monitor-tab-panel">
      <section className="monitor-kpi-grid" aria-label="Primary ad metrics">
        <DashboardMetric label="Spend" value={formatCurrency(bundle.totals.spendAud)} note={`${formatNumber(bundle.totals.impressions)} impressions`} spark={{ data: bundle.daily, dataKey: "spendAud" }} />
        <DashboardMetric label="Leads" value={formatNumber(bundle.totals.leads)} note={`${formatNumber(bundle.totals.clicks)} clicks`} spark={{ data: bundle.daily, dataKey: "leads" }} />
        <DashboardMetric label="Valid leads" value={formatNumber(bundle.totals.validLeads)} note={`${formatPercent(bundle.totals.validLeadRate)} valid rate`} spark={{ data: bundle.daily, dataKey: "validLeads" }} />
        <DashboardMetric label="Valid CPL" value={formatCurrency(bundle.totals.validCplAud)} note="Spend divided by valid leads" spark={{ data: bundle.validCplTrend, dataKey: "validCplAud" }} />
      </section>

      <section className="panel monitor-panel">
        <SectionTitle title="Top ads and campaigns" detail="Sorted by spend" />
        <PerformanceTable rows={bundle.topRows} compact />
      </section>

      <section className="monitor-chart-grid">
        <div className="panel monitor-panel">
          <SectionTitle title="Spend vs valid leads" />
          <div className="monitor-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bundle.daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1f3a6e" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#1f3a6e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e7eaf1" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={22} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={{ stroke: "#e7eaf1" }} tickLine={false} />
                <YAxis yAxisId="left" tickFormatter={(value) => `$${Number(value)}`} width={54} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" width={40} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={chartTooltipFormatter} labelFormatter={chartLabelFormatter} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Area yAxisId="left" type="monotone" dataKey="spendAud" name="Spend (A$)" stroke="#1f3a6e" strokeWidth={2} fill="url(#spendFill)" dot={false} activeDot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="validLeads" name="Valid leads" stroke="#1d4ed8" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel monitor-panel">
          <SectionTitle title="Valid CPL trend" />
          <div className="monitor-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bundle.validCplTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="cplFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1f3a6e" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#1f3a6e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e7eaf1" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={22} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={{ stroke: "#e7eaf1" }} tickLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value)}`} width={54} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={chartTooltipFormatter} labelFormatter={chartLabelFormatter} />
                <Area type="monotone" dataKey="validCplAud" name="Valid CPL" stroke="#1f3a6e" strokeWidth={2} fill="url(#cplFill)" dot={false} activeDot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="monitor-recommendations" aria-label="Recommendations and alerts">
        {bundle.recommendations.map((recommendation) => (
          <article className={`monitor-alert ${recommendation.tone}`} key={recommendation.title}>
            {recommendation.tone === "green" ? <CheckCircle2 aria-hidden size={18} /> : <AlertTriangle aria-hidden size={18} />}
            <span>
              <strong>{recommendation.title}</strong>
              {recommendation.detail}
            </span>
          </article>
        ))}
      </section>
    </div>
  );
}

function AdsTab({ bundle }: { bundle: MonitorDashboardBundle }) {
  const [metaSetupResponse, setMetaSetupResponse] = useState<MetaSetupResponse | null>(null);
  const [metaSetup, setMetaSetup] = useState<MetaSetup | null>(null);
  const [metaSetupMessage, setMetaSetupMessage] = useState("");
  const [metaSetupTone, setMetaSetupTone] = useState<"info" | "success" | "error">("info");
  const [isSavingMetaSetup, setIsSavingMetaSetup] = useState(false);

  useEffect(() => {
    void refreshMetaSetup();
  }, []);

  async function refreshMetaSetup() {
    try {
      const response = await fetch("/api/integrations/meta/setup", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as MetaSetupResponse | { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : `Meta setup failed with ${response.status}.`);
      }

      const setupPayload = payload as MetaSetupResponse;
      setMetaSetupResponse(setupPayload);
      setMetaSetup(setupPayload.setup);
      setMetaSetupTone("info");
      setMetaSetupMessage(setupPayload.connected ? "" : "Connect Meta before configuring publish assets.");
    } catch (error) {
      setMetaSetupTone("error");
      setMetaSetupMessage(error instanceof Error ? error.message : "Meta setup could not be loaded.");
    }
  }

  async function saveMetaSetup() {
    if (!metaSetup) return;

    setIsSavingMetaSetup(true);
    setMetaSetupTone("info");
    setMetaSetupMessage("Saving Meta setup...");

    try {
      const response = await fetch("/api/integrations/meta/setup", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setup: metaSetup }),
      });
      const payload = (await response.json().catch(() => null)) as MetaSetupResponse | { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error : `Meta setup save failed with ${response.status}.`);
      }

      const saved = payload as MetaSetupResponse;
      setMetaSetup(saved.setup);
      setMetaSetupResponse((current) => ({ ...(current ?? saved), ...saved }));
      setMetaSetupTone(saved.blockers.length ? "info" : "success");
      setMetaSetupMessage(saved.blockers.length ? `Saved with blockers: ${saved.blockers.join(", ")}` : "Meta setup saved and ready.");
    } catch (error) {
      setMetaSetupTone("error");
      setMetaSetupMessage(error instanceof Error ? error.message : "Meta setup save failed.");
    } finally {
      setIsSavingMetaSetup(false);
    }
  }

  function patchMetaSetup(patch: Partial<MetaSetup>) {
    setMetaSetup((current) => (current ? { ...current, ...patch } : current));
  }

  function patchLeadDestination(patch: Partial<MetaSetup["leadDestination"]>) {
    setMetaSetup((current) =>
      current
        ? {
            ...current,
            leadDestination: {
              ...current.leadDestination,
              ...patch,
              config: {
                ...(current.leadDestination.config ?? {}),
                ...(patch.config ?? {}),
              },
            },
          }
        : current,
    );
  }

  return (
    <div className="monitor-tab-panel">
      <section className="monitor-provider-grid" aria-label="Provider connections">
        {bundle.providers.map((provider) => (
          <article className="panel monitor-provider-card" key={provider.provider}>
            <div>
              <p className="eyebrow">{provider.provider === "meta" ? "Meta" : "Google"}</p>
              <h2>{provider.accountName}</h2>
              <p className="item-meta">{provider.issue ?? `Last synced ${provider.lastSyncAt ? formatDateTime(provider.lastSyncAt) : "not yet"}`}</p>
            </div>
            <div className="monitor-provider-actions">
              <StatusBadge status={provider.status} source={provider.source} />
              <a className="button secondary" href={`/api/integrations/${provider.provider}/connect`}>
                <Link2 aria-hidden size={17} />
                {provider.status === "not_connected" ? "Connect" : "Reconnect"}
              </a>
            </div>
          </article>
        ))}
      </section>

      <section className="panel monitor-panel">
        <SectionTitle title="Meta publish setup" detail="Required before campaign generation and publishing" />
        {metaSetup ? (
          <div className="monitor-form-grid">
            <label>
              <span>Ad account</span>
              <select value={metaSetup.metaAdAccountId} onChange={(event) => patchMetaSetup({ metaAdAccountId: event.target.value })}>
                <option value={metaSetup.metaAdAccountId}>{metaSetup.metaAdAccountId || "Select ad account"}</option>
                {metaSetupResponse?.assets?.adAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} ({account.id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Facebook Page</span>
              <select value={metaSetup.pageId} onChange={(event) => patchMetaSetup({ pageId: event.target.value })}>
                <option value={metaSetup.pageId}>{metaSetup.pageId || "Select Page"}</option>
                {metaSetupResponse?.assets?.pages.map((page) => (
                  <option value={page.id} key={page.id}>
                    {page.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Instagram account</span>
              <select value={metaSetup.instagramActorId ?? ""} onChange={(event) => patchMetaSetup({ instagramActorId: event.target.value || null })}>
                <option value="">None selected</option>
                {metaSetupResponse?.assets?.instagramActors.map((actor) => (
                  <option value={actor.id} key={actor.id}>
                    @{actor.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Pixel / dataset</span>
              <select value={metaSetup.pixelId ?? ""} onChange={(event) => patchMetaSetup({ pixelId: event.target.value || null })}>
                <option value="">None selected</option>
                {metaSetupResponse?.assets?.pixels.map((pixel) => (
                  <option value={pixel.id} key={pixel.id}>
                    {pixel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Lead destination</span>
              <select
                value={metaSetup.leadDestination.type}
                onChange={(event) => patchLeadDestination({ type: event.target.value as MetaSetup["leadDestination"]["type"] })}
              >
                <option value="manual">Manual review</option>
                <option value="webhook">Webhook</option>
                <option value="crm">CRM</option>
                <option value="email">Email</option>
              </select>
            </label>
            <label>
              <span>Destination label</span>
              <input value={metaSetup.leadDestination.label} onChange={(event) => patchLeadDestination({ label: event.target.value })} />
            </label>
            <label>
              <span>Destination endpoint</span>
              <input
                value={metaSetup.leadDestination.config.endpoint ?? ""}
                onChange={(event) => patchLeadDestination({ config: { endpoint: event.target.value } })}
                placeholder="https://crm.example.com/leads"
              />
            </label>
            <label>
              <span>Privacy policy URL</span>
              <input value={metaSetup.privacyPolicyUrl} onChange={(event) => patchMetaSetup({ privacyPolicyUrl: event.target.value })} />
            </label>
            <label>
              <span>Currency</span>
              <input value={metaSetup.currency} onChange={(event) => patchMetaSetup({ currency: event.target.value })} />
            </label>
            <label>
              <span>Timezone</span>
              <input value={metaSetup.timezone} onChange={(event) => patchMetaSetup({ timezone: event.target.value })} />
            </label>
          </div>
        ) : (
          <p className="item-meta">{metaSetupMessage || "Meta setup is loading."}</p>
        )}
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => void refreshMetaSetup()}>
            <RefreshCw aria-hidden size={17} />
            Refresh Meta assets
          </button>
          <button className="button" type="button" onClick={() => void saveMetaSetup()} disabled={!metaSetup || isSavingMetaSetup}>
            Save Meta setup
          </button>
        </div>
        <p className={`monitor-setup-status ${metaSetupTone}`} role="status" aria-live="polite">
          {metaSetupMessage}
        </p>
      </section>

      <section className="monitor-kpi-grid provider" aria-label="Provider KPIs">
        {bundle.providers.map((provider) => (
          <DashboardMetric
            key={`${provider.provider}-spend`}
            label={`${provider.provider === "meta" ? "Meta" : "Google"} spend`}
            value={formatCurrency(provider.metrics.spendAud)}
            note={`${formatNumber(provider.metrics.validLeads)} valid leads · ${formatCurrency(provider.metrics.validCplAud)} valid CPL`}
          />
        ))}
      </section>

      <section className="panel monitor-panel">
        <SectionTitle title="Ad performance" detail="Click a row for secondary metrics" />
        <PerformanceTable rows={bundle.providers.flatMap((provider) => provider.rows)} />
      </section>

      <section className="monitor-chart-grid">
        <div className="panel monitor-panel">
          <SectionTitle title="Daily ad spend" />
          <div className="monitor-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bundle.daily}>
                <CartesianGrid stroke="#e7eaf1" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tickFormatter={formatShortDate} minTickGap={22} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={{ stroke: "#e7eaf1" }} tickLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value)}`} width={54} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={chartTooltipFormatter} labelFormatter={chartLabelFormatter} />
                <Bar dataKey="spendAud" name="Spend" fill="#1f3a6e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel monitor-panel">
          <SectionTitle title="Spend by campaign" />
          <div className="monitor-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bundle.spendByCampaign} layout="vertical" margin={{ left: 12, right: 16 }}>
                <CartesianGrid stroke="#e7eaf1" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => `$${Number(value)}`} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={{ stroke: "#e7eaf1" }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={138} tick={{ fontSize: 12, fill: "#5b6678" }} axisLine={false} tickLine={false} />
                <Tooltip formatter={chartTooltipFormatter} />
                <Bar dataKey="spendAud" name="Spend" fill="#1d4ed8" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="panel monitor-panel">
        <SectionTitle title="Meta creative previews" />
        <div className="monitor-creative-grid">
          {bundle.providers
            .find((provider) => provider.provider === "meta")
            ?.creativePreviews.map((creative) => (
              <article className="monitor-creative-card" key={creative.id}>
                <div className="monitor-creative-visual">
                  {creative.imageUrl ? <img src={creative.imageUrl} alt="" /> : <BarChart3 aria-hidden size={32} />}
                </div>
                <div>
                  <h3>{creative.title}</h3>
                  <p>{creative.body}</p>
                  <p className="item-meta">
                    {creative.status} · {formatCurrency(creative.spendAud)} · {formatNumber(creative.validLeads)} valid leads
                  </p>
                </div>
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

function LeadsTab({ bundle }: { bundle: MonitorDashboardBundle }) {
  return (
    <div className="monitor-tab-panel">
      <section className="monitor-kpi-grid" aria-label="Lead metrics">
        <DashboardMetric label="Lead volume" value={formatNumber(bundle.totals.leads)} note={`${bundle.range.label}`} />
        <DashboardMetric label="Valid rate" value={formatPercent(bundle.totals.validLeadRate)} note={`${formatNumber(bundle.totals.validLeads)} valid leads`} />
        <DashboardMetric label="Duplicates" value={formatNumber(bundle.leads.duplicateCount)} note={bundle.leads.dedupeSummary} />
        <DashboardMetric label="Source count" value={String(bundle.leads.sourceSplit.filter((source) => source.leads > 0).length)} note={bundle.leads.sourceSplit.filter((source) => source.leads > 0).map((source) => source.source).join(", ") || "No leads yet"} />
      </section>

      <section className="monitor-chart-grid compact">
        <div className="panel monitor-panel">
          <SectionTitle title="Lead source split" />
          <div className="monitor-chart small">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bundle.leads.sourceSplit}>
                <CartesianGrid stroke="#d9e0dc" strokeDasharray="3 3" />
                <XAxis dataKey="source" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="leads" name="Leads" fill="#087f7a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="validLeads" name="Valid leads" fill="#2364aa" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel monitor-panel">
          <SectionTitle title="Duplicates merged" />
          <div className="monitor-dedupe">
            <strong>{bundle.leads.duplicateCount}</strong>
            <span>{bundle.leads.dedupeSummary}</span>
          </div>
        </div>
      </section>

      <section className="panel monitor-panel">
        <SectionTitle title="Lead inbox" detail="Quality labels and attribution" />
        <div className="table-wrap">
          <table className="table monitor-leads-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Suburb</th>
                <th>Source</th>
                <th>Quality</th>
                <th>Attribution</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {bundle.leads.rows.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.name}</td>
                  <td>{lead.suburb}</td>
                  <td>{lead.source}</td>
                  <td>
                    <span className={`monitor-quality ${lead.quality.toLowerCase()}`}>{lead.quality}</span>
                  </td>
                  <td>{lead.attribution}</td>
                  <td>{formatDateTime(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function PerformanceTable({ rows, compact = false }: { rows: MonitorPerformanceRow[]; compact?: boolean }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "spendAud", desc: true }]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const columns = useMemo<ColumnDef<MonitorPerformanceRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="monitor-row-title">
            <strong>{row.original.name}</strong>
            <span>{row.original.campaignName}</span>
          </div>
        ),
      },
      {
        accessorKey: "provider",
        header: "Provider",
        cell: ({ row }) => formatProvider(row.original.provider),
      },
      {
        accessorKey: "spendAud",
        header: "Spend",
        cell: ({ row }) => formatCurrency(row.original.spendAud),
      },
      {
        accessorKey: "leads",
        header: "Leads",
      },
      {
        accessorKey: "validLeads",
        header: "Valid",
      },
      {
        accessorKey: "validCplAud",
        header: "Valid CPL",
        cell: ({ row }) => formatCurrency(row.original.validCplAud),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <span className="monitor-quality valid">{row.original.status}</span>,
      },
    ],
    [],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="table-wrap">
      <table className={`table monitor-performance-table ${compact ? "compact" : ""}`}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.column.getCanSort() ? (
                    <button type="button" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              ))}
              <th className="monitor-expand-col">
                <span className="sr-only">Expand row</span>
              </th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const isExpanded = expandedRowId === row.original.id;

            return (
              <tr
                key={row.id}
                className={isExpanded ? "monitor-expandable expanded" : "monitor-expandable"}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => setExpandedRowId(isExpanded ? null : row.original.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedRowId(isExpanded ? null : row.original.id);
                  }
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
                <td className="monitor-expand-toggle" aria-hidden="true">
                  <ChevronDown size={16} className="monitor-expand-chevron" />
                </td>
                <td className="monitor-mobile-details">
                  <span>{formatNumber(row.original.impressions)} impressions</span>
                  <span>{formatPercent(row.original.ctr)} CTR</span>
                  <span>{formatCurrency(row.original.cpcAud)} CPC</span>
                  <span>{row.original.insight}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProviderStatusStrip({ bundle }: { bundle: MonitorDashboardBundle }) {
  return (
    <section className="monitor-provider-strip" aria-label="Ad account connection status">
      {bundle.providers.map((provider) => (
        <div className={`monitor-provider-status ${statusTone(provider.status)}`} key={provider.provider}>
          <div className="monitor-provider-status-meta">
            <span>{formatProvider(provider.provider)}</span>
            <small>{provider.lastSyncAt ? formatDateTime(provider.lastSyncAt) : "No live sync"}</small>
          </div>
          <StatusBadge status={provider.status} source={provider.source} />
        </div>
      ))}
    </section>
  );
}

function DashboardMetric({
  label,
  value,
  note,
  spark,
}: {
  label: string;
  value: string;
  note: string;
  spark?: { data: unknown[]; dataKey: string };
}) {
  return (
    <article className="metric-card monitor-metric">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-note">{note}</p>
      {spark && spark.data.length > 1 ? (
        <div className="metric-spark">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark.data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${spark.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1f3a6e" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#1f3a6e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey={spark.dataKey}
                stroke="#1f3a6e"
                strokeWidth={1.75}
                fill={`url(#spark-${spark.dataKey})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </article>
  );
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {detail ? <p className="item-meta">{detail}</p> : null}
    </div>
  );
}

function statusTone(status: string) {
  return status === "connected" ? "green" : status === "not_connected" ? "blue" : "amber";
}

function StatusBadge({ status, source }: { status: string; source: string }) {
  const label = status === "not_connected" && source === "demo" ? "Sample data" : status.replace("_", " ");

  return <span className={`status ${statusTone(status)}`}>{label}</span>;
}

function buildReportText(bundle: MonitorDashboardBundle): string {
  return [
    `Blockwise ads report · ${bundle.range.label}`,
    `Spend: ${formatCurrency(bundle.totals.spendAud)}`,
    `Leads: ${formatNumber(bundle.totals.leads)}`,
    `Valid leads: ${formatNumber(bundle.totals.validLeads)} (${formatPercent(bundle.totals.validLeadRate)})`,
    `Valid CPL: ${formatCurrency(bundle.totals.validCplAud)}`,
    "",
    "Top activity:",
    ...bundle.topRows.slice(0, 5).map((row) => `- ${row.name}: ${formatCurrency(row.spendAud)}, ${row.validLeads} valid leads, ${formatCurrency(row.validCplAud)} valid CPL`),
    "",
    "Recommendations:",
    ...bundle.recommendations.map((recommendation) => `- ${recommendation.title}: ${recommendation.detail}`),
  ].join("\n");
}

function chartTooltipFormatter(value: unknown, name: unknown) {
  const label = String(name);
  const numeric = Number(value);

  if (label.toLowerCase().includes("spend") || label.toLowerCase().includes("cpl")) {
    return [formatCurrency(numeric), label];
  }

  return [formatNumber(numeric), label];
}

function chartLabelFormatter(value: unknown) {
  return typeof value === "string" ? formatDate(value) : String(value ?? "");
}

function formatProvider(provider: MonitorProvider) {
  return provider === "meta" ? "Meta" : "Google";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
