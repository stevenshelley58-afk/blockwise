"use client";

import { useMemo, useState } from "react";

import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { isPlausibleDailyBudgetDollars } from "@/lib/meta-monitor/budget";
import type { ResultsHierarchyStatus } from "@/lib/meta-monitor/results-hierarchy";

type Phase = "idle" | "confirm" | "pushing" | "done" | "error";
type ManageAction = "pause" | "activate" | "export_leads";

type ManageTarget =
  | { kind: "campaign"; campaignId: string }
  | { kind: "adset"; adSetId: string }
  | { kind: "ad"; adId: string };

const MANAGE_API = "/api/integrations/meta/manage";

export function AdManagementControls({
  target,
  status,
  showExport = false,
  disabledReason,
}: {
  target: ManageTarget;
  status: ResultsHierarchyStatus;
  showExport?: boolean;
  disabledReason?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState<ManageAction | null>(null);
  const [message, setMessage] = useState("");
  const [localStatus, setLocalStatus] = useState<ResultsHierarchyStatus>(status);
  const canRun = !disabledReason && hasTargetId(target);
  const statusIsActive = localStatus === "ACTIVE";
  const statusIsMixed = localStatus === "MIXED";

  function ask(action: ManageAction) {
    if (!canRun) return;
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
      const body = buildActionBody(target, action);
      const created = await createAndApproveMutation(body);
      const final = await pollStatus(created.mutationId);

      if (final.status === "applied") {
        if (action === "pause") setLocalStatus("PAUSED");
        if (action === "activate") setLocalStatus("ACTIVE");
        setMessage(action === "export_leads" ? "Export started" : action === "pause" ? "Paused" : "Resumed");
        setPhase("done");
      } else if (final.status === "failed") {
        setMessage(final.lastError ?? "Meta rejected the change.");
        setPhase("error");
      } else {
        setMessage("Still applying - refresh shortly.");
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
        <Loader2 size={13} className="mm-spin" aria-hidden /> Pushing to Meta...
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
    return (
      <span className="mm-mgmt-row mm-mgmt-confirm">
        <span className="mm-mgmt-confirm-text">{confirmLabel(pending)}</span>
        <button type="button" className="button mm-mgmt-btn mm-mgmt-approve" onClick={run}>
          Approve
        </button>
        <button type="button" className="button secondary mm-mgmt-btn" onClick={reset}>
          Cancel
        </button>
      </span>
    );
  }

  if (!canRun) {
    return <span className="mm-mgmt-disabled">{disabledReason ?? "Missing Meta id"}</span>;
  }

  return (
    <span className="mm-mgmt-row">
      {statusIsActive || statusIsMixed ? (
        <button type="button" className="button secondary mm-mgmt-btn mm-mgmt-danger" onClick={() => ask("pause")}>
          {statusIsMixed ? "Pause all" : "Pause"}
        </button>
      ) : null}
      {!statusIsActive || statusIsMixed ? (
        <button type="button" className="button secondary mm-mgmt-btn" onClick={() => ask("activate")}>
          {statusIsMixed ? "Resume all" : "Resume"}
        </button>
      ) : null}
      {showExport ? (
        <button type="button" className="button secondary mm-mgmt-btn" onClick={() => ask("export_leads")}>
          Export leads
        </button>
      ) : null}
    </span>
  );
}

export function BudgetManagementControl({
  adSetId,
  dailyBudgetDollars,
  disabledReason,
}: {
  adSetId: string;
  dailyBudgetDollars: number | null;
  disabledReason?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState(dailyBudgetDollars);
  const [draft, setDraft] = useState(dailyBudgetDollars == null ? "" : String(Math.round(dailyBudgetDollars)));
  const [message, setMessage] = useState("");
  const nextBudget = useMemo(() => Number(draft), [draft]);
  const changed = Number.isFinite(nextBudget) && current !== null && Math.round(nextBudget * 100) !== Math.round(current * 100);
  const canApply = !disabledReason && adSetId && changed && isPlausibleDailyBudgetDollars(nextBudget);

  function reset() {
    setPhase("idle");
    setMessage("");
    setDraft(current == null ? "" : String(Math.round(current)));
  }

  async function run() {
    if (!canApply) return;
    setPhase("pushing");

    try {
      const created = await createAndApproveMutation({
        action: "increase_budget",
        adSetId,
        dailyBudgetDollars: nextBudget,
      });
      const final = await pollBudgetStatus(created.mutationId);

      if (final.status === "failed") {
        setMessage(final.lastError ?? "Meta rejected the budget.");
        setPhase("error");
        return;
      }

      setCurrent(nextBudget);
      setMessage("Budget updated");
      setPhase("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.");
      setPhase("error");
    }
  }

  if (disabledReason) {
    return <span className="muted">{disabledReason}</span>;
  }

  if (!adSetId) {
    return <span className="muted">-</span>;
  }

  if (phase === "confirm") {
    return (
      <span className="mm-mgmt-row mm-mgmt-confirm">
        <span className="mm-mgmt-confirm-text">Approve ${nextBudget.toLocaleString("en-AU")}/day?</span>
        <button type="button" className="button mm-mgmt-btn mm-mgmt-approve" onClick={run}>
          Approve
        </button>
        <button type="button" className="button secondary mm-mgmt-btn" onClick={reset}>
          Cancel
        </button>
      </span>
    );
  }

  if (phase === "pushing") {
    return (
      <span className="mm-mgmt-state mm-mgmt-pushing">
        <Loader2 size={13} className="mm-spin" aria-hidden /> Updating...
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

  return (
    <span className="mm-budget-control">
      <span aria-hidden>$</span>
      <input
        aria-label="Daily budget dollars"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" className="button secondary mm-mgmt-btn" disabled={!canApply} onClick={() => setPhase("confirm")}>
        Apply
      </button>
    </span>
  );
}

function confirmLabel(action: ManageAction | null): string {
  if (action === "pause") return "Approve pause?";
  if (action === "activate") return "Approve resume?";
  if (action === "export_leads") return "Export leads now?";

  return "Approve change?";
}

function hasTargetId(target: ManageTarget): boolean {
  if (target.kind === "campaign") return Boolean(target.campaignId);
  if (target.kind === "adset") return Boolean(target.adSetId);

  return Boolean(target.adId);
}

function buildActionBody(target: ManageTarget, action: ManageAction): Record<string, unknown> {
  const body: Record<string, unknown> = { action };
  if (action === "export_leads") return body;
  if (target.kind === "campaign") body.campaignId = target.campaignId;
  if (target.kind === "adset") body.adSetIds = [target.adSetId];
  if (target.kind === "ad") body.adIds = [target.adId];

  return body;
}

async function createAndApproveMutation(body: Record<string, unknown>): Promise<{ mutationId: string }> {
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

  return { mutationId };
}

async function pollBudgetStatus(mutationId: string): Promise<{ status: string; lastError: string | null }> {
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
