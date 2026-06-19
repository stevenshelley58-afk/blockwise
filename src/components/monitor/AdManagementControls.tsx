"use client";

import { useState } from "react";

import { AlertTriangle, Check, Loader2 } from "lucide-react";

import type { MetaAdStatus } from "@/lib/meta-monitor/types";

type Phase = "idle" | "confirm" | "pushing" | "done" | "error";
type ManageAction = "pause" | "activate" | "export_leads";

const MANAGE_API = "/api/integrations/meta/manage";

/**
 * Inline, gated management for a single Meta ad: pause / resume / export leads.
 * Flow: choose action -> Approve -> "Pushing to Meta" -> confirmed (or error).
 * Each action becomes an approval-gated mutation that only touches the live ad
 * account when provider writes are enabled server-side. The workspace is
 * resolved from the session, matching the workspace the Results page renders.
 */
export function AdManagementControls({ adId, status }: { adId: string; status: MetaAdStatus }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<ManageAction | null>(null);
  const [message, setMessage] = useState("");
  const [localStatus, setLocalStatus] = useState<MetaAdStatus>(status);

  const isActive = localStatus === "ACTIVE";

  function ask(action: ManageAction) {
    setPending(action);
    setMessage("");
    setPhase("confirm");
  }

  function reset() {
    setPhase("idle");
    setPending(null);
    setMessage("");
  }

  async function pollStatus(mutationId: string): Promise<{ status: string; lastError: string | null }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 600 : 1200));
      const res = await fetch(`${MANAGE_API}?mutationId=${encodeURIComponent(mutationId)}`, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const next = data.mutation?.status as string | undefined;
      if (next === "applied" || next === "failed") {
        return { status: next, lastError: (data.mutation?.lastError as string | null) ?? null };
      }
    }
    return { status: "applying", lastError: null };
  }

  async function run() {
    if (!pending) return;
    const action = pending;
    setPhase("pushing");

    try {
      const body: Record<string, unknown> = { action };
      if (action === "pause" || action === "activate") body.adIds = [adId];

      const createRes = await fetch(MANAGE_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(created.error ?? "Could not create the change.");

      const approvalId = created.mutation?.approvalRequestId as string | undefined;
      const mutationId = created.mutation?.mutationId as string | undefined;
      if (!approvalId || !mutationId) throw new Error("Unexpected response from the server.");

      const approveRes = await fetch(`/api/approvals/${approvalId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!approveRes.ok) {
        const err = await approveRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Approval could not be queued.");
      }

      const final = await pollStatus(mutationId);
      if (final.status === "applied") {
        if (action === "pause") setLocalStatus("PAUSED");
        if (action === "activate") setLocalStatus("ACTIVE");
        setMessage(action === "export_leads" ? "Export started" : action === "pause" ? "Paused" : "Resumed");
        setPhase("done");
      } else if (final.status === "failed") {
        setMessage(final.lastError ?? "Meta rejected the change.");
        setPhase("error");
      } else {
        setMessage("Still applying — refresh shortly.");
        setPhase("done");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setPhase("error");
    } finally {
      setPending(null);
    }
  }

  if (phase === "pushing") {
    return (
      <span className="mm-mgmt-state mm-mgmt-pushing">
        <Loader2 size={13} className="mm-spin" aria-hidden /> Pushing to Meta…
      </span>
    );
  }

  if (phase === "done") {
    return (
      <span className="mm-mgmt-state mm-mgmt-done">
        <Check size={13} aria-hidden /> {message}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="mm-mgmt-row">
        <span className="mm-mgmt-state mm-mgmt-error">
          <AlertTriangle size={13} aria-hidden /> {message}
        </span>
        <button type="button" className="button secondary mm-mgmt-btn" onClick={reset}>
          Dismiss
        </button>
      </span>
    );
  }

  if (phase === "confirm") {
    const label = pending === "pause" ? "Pause this ad?" : pending === "activate" ? "Resume this ad?" : "Export leads now?";
    return (
      <span className="mm-mgmt-row mm-mgmt-confirm">
        <span className="mm-mgmt-confirm-text">{label}</span>
        <button type="button" className="button mm-mgmt-btn mm-mgmt-approve" onClick={run}>
          Approve
        </button>
        <button type="button" className="button secondary mm-mgmt-btn" onClick={reset}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="mm-mgmt-row">
      {isActive ? (
        <button type="button" className="button secondary mm-mgmt-btn mm-mgmt-danger" onClick={() => ask("pause")}>
          Pause
        </button>
      ) : (
        <button type="button" className="button secondary mm-mgmt-btn" onClick={() => ask("activate")}>
          Resume
        </button>
      )}
      <button type="button" className="button secondary mm-mgmt-btn" onClick={() => ask("export_leads")}>
        Export leads
      </button>
    </span>
  );
}
