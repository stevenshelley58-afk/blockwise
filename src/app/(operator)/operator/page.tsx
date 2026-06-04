import { AlertTriangle, Bot, CheckCircle2, CircleDollarSign, UsersRound } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { agentRuns, approvalQueue, operatorMetrics, workspaceRows } from "@/lib/product/demo-data";

export default function OperatorConsolePage() {
  return (
    <main className="content">
      <PageHeading
        eyebrow="Internal control plane"
        title="Operator Console"
        description="Manage workspaces, sync health, AI spend, agent work, approval gates, blocked generations, and managed-service actions from one reviewable surface."
      />

      <section className="grid cols-4" aria-label="Operator metrics">
        <MetricCard icon={UsersRound} label={operatorMetrics[0].label} value={operatorMetrics[0].value} note={operatorMetrics[0].note} />
        <MetricCard icon={CircleDollarSign} label={operatorMetrics[1].label} value={operatorMetrics[1].value} note={operatorMetrics[1].note} />
        <MetricCard icon={Bot} label={operatorMetrics[2].label} value={operatorMetrics[2].value} note={operatorMetrics[2].note} />
        <MetricCard icon={AlertTriangle} label={operatorMetrics[3].label} value={operatorMetrics[3].value} note={operatorMetrics[3].note} />
      </section>

      <section className="split">
        <div className="panel">
          <h2>Workspace Oversight</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Mode</th>
                <th>Plan</th>
                <th>Sync</th>
                <th>AI Spend</th>
              </tr>
            </thead>
            <tbody>
              {workspaceRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{row.mode}</td>
                  <td>{row.plan}</td>
                  <td>
                    <StatusPill tone={row.statusTone}>{row.sync}</StatusPill>
                  </td>
                  <td>{row.spend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Approval Queue</h2>
          <div className="stack">
            {approvalQueue.map((item) => (
              <article className="item-card" key={item.title}>
                <h3>{item.title}</h3>
                <p className="item-meta">{item.workspace}</p>
                <p className="item-meta">{item.risk}</p>
                <StatusPill tone="amber">{item.status}</StatusPill>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Agent Runs Needing Attention</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Workspace</th>
              <th>Task</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {agentRuns.slice(0, 5).map((run) => (
              <tr key={`${run.agent}-${run.workspace}`}>
                <td>{run.agent}</td>
                <td>{run.workspace}</td>
                <td>{run.task}</td>
                <td>
                  <StatusPill tone={run.status === "Complete" ? "green" : run.status === "Running" ? "blue" : "amber"}>
                    {run.status}
                  </StatusPill>
                </td>
                <td>{run.cost}</td>
                <td>{run.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Safety Gates</h2>
        <div className="grid cols-3">
          {["Publishing", "Budget changes", "PII exports"].map((gate) => (
            <article className="item-card" key={gate}>
              <CheckCircle2 aria-hidden color="#2f7d32" size={20} />
              <h3>{gate}</h3>
              <p className="item-meta">Human approval is required before this action can leave Blockwise.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
