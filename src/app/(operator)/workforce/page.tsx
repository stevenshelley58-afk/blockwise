import { Bot, ShieldAlert, TimerReset, Workflow } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { HUMAN_APPROVAL_ACTIONS, WORKFORCE_AGENTS } from "@/lib/workforce/permissions";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listAgentRunRows } from "@/lib/operator/overview";

export const dynamic = "force-dynamic";

export default async function AgentWorkforcePage() {
  const { supabase, access } = await requirePageSurfaceAccess("operator");
  const workspaceId = access.isOperator ? undefined : access.workspaceId;
  let openRunsQuery = supabase
    .from("agent_runs")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "running", "needs_review"]);
  let enabledSchedulesQuery = supabase
    .from("agent_schedules")
    .select("id", { count: "exact", head: true })
    .eq("enabled", true);

  if (workspaceId) {
    openRunsQuery = openRunsQuery.eq("workspace_id", workspaceId);
    enabledSchedulesQuery = enabledSchedulesQuery.eq("workspace_id", workspaceId);
  }

  const [agentRuns, { count: openRuns }, { count: enabledSchedules }] = await Promise.all([
    listAgentRunRows(supabase, workspaceId),
    openRunsQuery,
    enabledSchedulesQuery,
  ]);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Agent Workforce"
        title="Agent Workforce"
        description="Research, classification, drafting, QA, reporting, support, and cost-control workers run with strict permissions and reviewable artifacts."
      />

      <section className="grid cols-4">
        <MetricCard icon={Bot} label="Definitions" value={String(WORKFORCE_AGENTS.length)} note="Native first, external runtimes later" />
        <MetricCard icon={Workflow} label="Open runs" value={String(openRuns ?? 0)} note="Queued, running, or needs review" />
        <MetricCard icon={ShieldAlert} label="Approval actions" value={String(HUMAN_APPROVAL_ACTIONS.length)} note="Publish, budget, sends, PII export" />
        <MetricCard icon={TimerReset} label="Schedules" value={String(enabledSchedules ?? 0)} note="Enabled agent schedules" />
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
              <tr key={run.id}>
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
          {WORKFORCE_AGENTS.slice(0, 6).map((agent) => (
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
