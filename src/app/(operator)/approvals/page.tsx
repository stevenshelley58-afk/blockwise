import { ClipboardCheck, MailCheck, ShieldAlert, WalletCards } from "lucide-react";

import { ApprovalActions } from "@/components/approvals/approval-actions";
import { MetricCard } from "@/components/metric-card";
import { PageHeading } from "@/components/page-heading";
import { StatusPill } from "@/components/status-pill";
import { HUMAN_APPROVAL_ACTIONS } from "@/lib/agents/permissions";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { listApprovalRows } from "@/lib/product/live-data";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("approvals");
  const approvalQueue = await listApprovalRows(supabase, access.workspaceId);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Human gates"
        title="Approvals"
        description="Review high-risk actions before campaigns publish, budgets change, client-facing sends go out, or lead PII leaves the workspace."
      />

      <section className="grid cols-4">
        <MetricCard icon={ClipboardCheck} label="Open" value={String(approvalQueue.length)} note="Operator and client review queue" />
        <MetricCard icon={ShieldAlert} label="Policy actions" value={String(HUMAN_APPROVAL_ACTIONS.length)} note={HUMAN_APPROVAL_ACTIONS.join(", ")} />
        <MetricCard icon={WalletCards} label="Budget changes" value="1" note="Blocked until operator approval" />
        <MetricCard icon={MailCheck} label="Client sends" value="0" note="No sends without approval record" />
      </section>

      <section className="panel">
        <h2>Approval Queue</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Workspace</th>
              <th>Risk</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {approvalQueue.map((item) => (
              <tr key={item.id}>
                <td>{item.title}</td>
                <td>{item.workspace}</td>
                <td>{item.risk}</td>
                <td>
                  <StatusPill tone="amber">{item.status}</StatusPill>
                </td>
                <td>
                  <ApprovalActions approvalId={item.id} workspaceId={access.workspaceId} status={item.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
