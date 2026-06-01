import { Bot, ShieldAlert, TimerReset, Workflow } from "lucide-react";

import { MetricCard } from "@/ui/metric-card";
import { PageHeading } from "@/ui/page-heading";
import { StatusPill } from "@/ui/status-pill";
import { AGENT_DEFINITIONS, HUMAN_APPROVAL_ACTIONS } from "@/modules/ai-workforce/permissions";
import { requirePageSurfaceAccess } from "@/modules/auth/page-guards";
import { listAgentRunRows } from "@/modules/product/live-data";

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
        <h2>Agent Runs</h2>
        <table className="table">
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
