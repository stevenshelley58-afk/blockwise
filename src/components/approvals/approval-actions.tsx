"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";

type ApprovalActionsProps = {
  approvalId: string;
  workspaceId: string;
  status: string;
};

export function ApprovalActions({ approvalId, workspaceId, status }: ApprovalActionsProps) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const isResolved = currentStatus !== "requested";

  async function resolveApproval(nextStatus: "approved" | "rejected") {
    setIsBusy(true);
    setMessage(nextStatus === "approved" ? "Approving..." : "Rejecting...");

    try {
      const response = await fetch(`/api/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, status: nextStatus }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Approval update failed with ${response.status}.`);
      }

      const payload = (await response.json()) as {
        approval?: { status?: string };
        triggerRunId?: string | null;
      };
      setCurrentStatus(payload.approval?.status ?? nextStatus);
      setMessage(payload.triggerRunId ? "Approved and worker queued." : "Approval updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval update failed.");
    } finally {
      setIsBusy(false);
    }
  }

  if (isResolved) {
    return <span className="item-meta">Resolved</span>;
  }

  return (
    <div className="approval-actions">
      <button className="button secondary" type="button" onClick={() => void resolveApproval("rejected")} disabled={isBusy}>
        <X aria-hidden size={16} />
        Reject
      </button>
      <button className="button" type="button" onClick={() => void resolveApproval("approved")} disabled={isBusy}>
        <Check aria-hidden size={16} />
        Approve
      </button>
      {message ? <span className="item-meta" aria-live="polite">{message}</span> : null}
    </div>
  );
}
