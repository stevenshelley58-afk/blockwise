import { AlertTriangle, CheckCircle2, ClipboardCheck, RadioTower, UsersRound } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill, type StatusTone } from "@/components/status-pill";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadOperatorOverview } from "@/lib/operator/overview";

export const dynamic = "force-dynamic";

export default async function OperatorConsolePage() {
  const { supabase } = await requirePageSurfaceAccess("operator");
  const overview = await loadOperatorOverview(supabase);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal control plane"
        title="Operator Console"
        description="Manage workspace readiness, provider health, lead volume, approval gates, and recent operational activity from one reviewable surface."
      />

      <section className="grid cols-4" aria-label="Operator metrics">
        <MetricCard icon={UsersRound} label="Workspaces" value={overview.metrics.workspaces} note="Live operator-visible workspaces" />
        <MetricCard icon={RadioTower} label="Provider issues" value={overview.metrics.providerIssues} note="Connections needing attention" />
        <MetricCard icon={ClipboardCheck} label="Pending approvals" value={overview.metrics.pendingApprovals} note="Human gates awaiting review" />
        <MetricCard icon={AlertTriangle} label="Leads" value={overview.metrics.leads} note="Live lead records across workspaces" />
      </section>

      <section className="split">
        <div className="panel">
          <h2>Workspace Oversight</h2>
          <table className="table responsive-card-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Mode</th>
                <th>Plan</th>
                <th>Service</th>
                <th>Provider Health</th>
                <th>Last Sync</th>
              </tr>
            </thead>
            <tbody>
              {overview.workspaceRows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Workspace">{row.name}</td>
                  <td data-label="Mode">{row.mode}</td>
                  <td data-label="Plan">{row.plan}</td>
                  <td data-label="Service">{row.managedService}</td>
                  <td data-label="Provider Health">
                    <StatusPill tone={row.providerTone as StatusTone}>{row.providerHealth}</StatusPill>
                  </td>
                  <td data-label="Last Sync">{row.lastSync}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Provider Health</h2>
          <div className="stack">
            {overview.providerHealthRows.length === 0 ? (
              <article className="item-card">
                <h3>No provider issues</h3>
                <p className="item-meta">Live connections are currently healthy or no issue rows are visible.</p>
                <StatusPill tone="green">Healthy</StatusPill>
              </article>
            ) : null}
            {overview.providerHealthRows.slice(0, 5).map((item) => (
              <article className="item-card" key={item.id}>
                <h3>{item.provider}</h3>
                <p className="item-meta">{item.workspace}</p>
                <p className="item-meta">{item.account}</p>
                <p className="item-meta">{item.lastSync}</p>
                <StatusPill tone={item.tone as StatusTone}>{item.status}</StatusPill>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Approval Queue</h2>
        <table className="table responsive-card-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Workspace</th>
              <th>Risk</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {overview.approvalRows.map((item) => (
              <tr key={item.id}>
                <td data-label="Request">{item.title}</td>
                <td data-label="Workspace">{item.workspace}</td>
                <td data-label="Risk">{item.risk}</td>
                <td data-label="Status">
                  <StatusPill tone={item.status === "approved" ? "green" : item.status === "rejected" ? "rose" : "amber"}>{item.status}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recent Activity</h2>
        <div className="grid cols-3">
          {overview.recentActivity.map((item) => (
            <article className="item-card" key={`${item.title}-${item.id}`}>
              <h3>{item.title}</h3>
              <p className="item-meta">{item.workspace}</p>
              <p className="item-meta">{item.detail}</p>
              <StatusPill tone={item.tone as StatusTone}>{item.at ? new Date(item.at).toLocaleString("en-AU") : "Latest"}</StatusPill>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Safety Gates</h2>
        <div className="grid cols-3">
          {["Publishing", "Budget changes", "PII exports"].map((gate) => (
            <article className="item-card" key={gate}>
              <CheckCircle2 aria-hidden color="#31c46f" size={20} />
              <h3>{gate}</h3>
              <p className="item-meta">Human approval is required before this action can leave Blockwise.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
