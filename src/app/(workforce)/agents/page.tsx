import { Bot, FileSearch, ShieldAlert, TimerReset, Workflow } from "lucide-react";
import Link from "next/link";

import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { AGENT_DEFINITIONS, HUMAN_APPROVAL_ACTIONS } from "@/lib/agents/permissions";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listAgentRunRows } from "@/lib/product/live-data";

export const dynamic = "force-dynamic";

export default async function AgentWorkforcePage() {
  const { supabase, access } = await requirePageSurfaceAccess("agents");
  const agentRuns = await listAgentRunRows(supabase, access.workspaceId);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Agent Workforce"
        title="Agent Workforce"
        description="Research, classification, drafting, QA, reporting, support, and cost-control workers run with strict permissions and reviewable artifacts."
      />

      <section className="grid cols-4">
        <MetricCard icon={Bot} label="Definitions" value={String(AGENT_DEFINITIONS.length)} note="Native first, external runtimes later" />
        <MetricCard icon={Workflow} label="Open runs" value="27" note="Run, step, artifact, and review states" />
        <MetricCard icon={ShieldAlert} label="Approval actions" value={String(HUMAN_APPROVAL_ACTIONS.length)} note="Publish, budget, sends, PII export" />
        <MetricCard icon={TimerReset} label="Schedules" value="6" note="Trigger.dev handles retries and schedules" />
      </section>

      <section className="panel">
        <div className="split">
          <div>
            <h2>Hermes Research Agent</h2>
            <p className="item-meta">
              Research build, Meta ad capture, media escrow, classification, and coverage checks run under the Hermes runtime.
            </p>
          </div>
          <div className="stack">
            <Link className="button" href="/operator/research">
              <FileSearch size={14} /> Research Ops
            </Link>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Agent Runs</h2>
        <table className="table responsive-card-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Workspace</th>
              <th>Result</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {agentRuns.map((run) => (
              <tr key={`${run.agent}-${run.status}`}>
                <td data-label="Agent">{run.agent}</td>
                <td data-label="Workspace">{run.workspace}</td>
                <td data-label="Result">{run.task}</td>
                <td data-label="Status">
                  <StatusPill tone={run.status === "Complete" ? "green" : run.status === "Running" ? "blue" : "amber"}>
                    {run.status}
                  </StatusPill>
                </td>
                <td data-label="Cost">{run.cost}</td>
                <td data-label="Confidence">{run.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Permission Model</h2>
        <div className="grid cols-3">
          {AGENT_DEFINITIONS.slice(0, 6).map((agent) => (
            <article className="item-card" key={agent.key}>
              <h3>{agent.label}</h3>
              <p className="item-meta">{agent.description}</p>
              <p className="item-meta">Allowed: {agent.allowedActions.join(", ")}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
