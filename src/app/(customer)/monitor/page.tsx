import { Activity, BadgeCheck, CircleDollarSign, MousePointerClick } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { competitorSignals, workspace } from "@/lib/product/demo-data";
import { listProviderSyncSummaries, listReportingSnapshots } from "@/lib/providers/mock-adapters";

function currency(value: number) {
  return `$${value.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
}

export default async function MonitorPage() {
  const [syncSummaries, snapshots] = await Promise.all([
    listProviderSyncSummaries(workspace.id),
    listReportingSnapshots(workspace.id),
  ]);
  const totals = snapshots.reduce(
    (acc, snapshot) => ({
      spendAud: acc.spendAud + snapshot.metrics.spendAud,
      clicks: acc.clicks + snapshot.metrics.clicks,
      leads: acc.leads + snapshot.metrics.leads,
      validLeadRate: acc.validLeadRate + snapshot.metrics.validLeadRate / snapshots.length,
    }),
    { spendAud: 0, clicks: 0, leads: 0, validLeadRate: 0 },
  );
  const blendedCpl = totals.leads > 0 ? totals.spendAud / totals.leads : 0;

  return (
    <main className="content">
      <PageHeading
        eyebrow="Customer product"
        title="Monitor"
        description="A zero-safe reporting dashboard for connected ad accounts, lead quality, competitor snapshots, sync health, recommendations, and alerts."
      />

      <section className="grid cols-4" aria-label="Monitor metrics">
        <MetricCard icon={CircleDollarSign} label="Spend" value={currency(totals.spendAud)} note="Last 30 days across Meta and Google" />
        <MetricCard icon={BadgeCheck} label="Leads" value={String(totals.leads)} note={`${Math.round(totals.validLeadRate * 100)}% valid lead rate`} />
        <MetricCard icon={MousePointerClick} label="Clicks" value={totals.clicks.toLocaleString("en-AU")} note="Provider reporting mocks are deterministic" />
        <MetricCard icon={Activity} label="Blended CPL" value={`$${blendedCpl.toFixed(2)}`} note="Safe when zero leads are present" />
      </section>

      <section className="split">
        <div className="panel">
          <h2>Provider Reporting</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Spend</th>
                <th>Leads</th>
                <th>CPL</th>
                <th>Top Campaign</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.provider}>
                  <td>{snapshot.provider === "meta" ? "Meta" : "Google"}</td>
                  <td>{currency(snapshot.metrics.spendAud)}</td>
                  <td>{snapshot.metrics.leads}</td>
                  <td>${snapshot.metrics.cplAud.toFixed(2)}</td>
                  <td>{snapshot.topCampaign.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Sync Health</h2>
          <div className="stack">
            {syncSummaries.map((summary) => (
              <article className="item-card" key={summary.provider}>
                <h3>{summary.provider === "meta" ? "Meta" : "Google"}</h3>
                <StatusPill tone={summary.status === "connected" ? "green" : "amber"}>{summary.status.replace("_", " ")}</StatusPill>
                <p className="item-meta" style={{ marginTop: 8 }}>
                  {summary.issue ?? `Last synced ${summary.lastSyncAt}`}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Competitor Snapshot</h2>
        <div className="grid cols-3">
          {competitorSignals.map((signal) => (
            <article className="item-card" key={signal.competitor}>
              <h3>{signal.competitor}</h3>
              <p>{signal.signal}</p>
              <p className="item-meta">{signal.evidence} · confidence {signal.confidence}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
