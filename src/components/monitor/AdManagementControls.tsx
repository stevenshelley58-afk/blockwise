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

const mgmtButton =
  "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-(--line) bg-(--surface) px-2.5 text-[11px] font-bold transition-[background,border-color,color] duration-150 hover:border-(--line-heavy) hover:bg-(--surface-subtle)";
const mgmtDanger = `${mgmtButton} border-error/25 text-error hover:border-error/40 hover:bg-error-soft`;
const mgmtApprove =
  "inline-flex h-7 cursor-pointer items-center rounded-full border border-transparent bg-(--ink) px-3 text-[11px] font-bold text-white transition-opacity duration-150 hover:opacity-85";

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
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
        <Loader2 size={12} className="animate-spin" aria-hidden /> Pushing to Meta...
      </span>
    );
  }

  if (phase === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success">
        <Check size={12} aria-hidden /> {message}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-error">
          <AlertTriangle size={12} aria-hidden /> {message}
        </span>
        <button type="button" className={mgmtButton} onClick={reset}>
          Dismiss
        </button>
      </span>
    );
  }

  if (phase === "confirm") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold">{confirmLabel(pending)}</span>
        <button type="button" className={mgmtApprove} onClick={run}>
          Approve
        </button>
        <button type="button" className={mgmtButton} onClick={reset}>
          Cancel
        </button>
      </span>
    );
  }

  if (!canRun) {
    return <span className="text-[11px] font-medium text-(--faint)">{disabledReason ?? "Missing Meta id"}</span>;
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {statusIsActive || statusIsMixed ? (
        <button type="button" className={mgmtDanger} onClick={() => ask("pause")}>
          {statusIsMixed ? "Pause all" : "Pause"}
        </button>
      ) : null}
      {!statusIsActive || statusIsMixed ? (
        <button type="button" className={mgmtButton} onClick={() => ask("activate")}>
          {statusIsMixed ? "Resume all" : "Resume"}
        </button>
      ) : null}
      {showExport ? (
        <button type="button" className={mgmtButton} onClick={() => ask("export_leads")}>
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
    return <span className="text-[11px] font-medium text-(--faint)">{disabledReason}</span>;
  }

  if (!adSetId) {
    return <span className="text-[11px] font-medium text-(--faint)">-</span>;
  }

  if (phase === "confirm") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold">Approve ${nextBudget.toLocaleString("en-AU")}/day?</span>
        <button type="button" className={mgmtApprove} onClick={run}>
          Approve
        </button>
        <button type="button" className={mgmtButton} onClick={reset}>
          Cancel
        </button>
      </span>
    );
  }

  if (phase === "pushing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
        <Loader2 size={12} className="animate-spin" aria-hidden /> Updating...
      </span>
    );
  }

  if (phase === "done") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success">
        <Check size={12} aria-hidden /> {message}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-error">
          <AlertTriangle size={12} aria-hidden /> {message}
        </span>
        <button type="button" className={mgmtButton} onClick={reset}>
          Dismiss
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="text-[11px] font-bold text-(--faint)">
        $
      </span>
      <input
        aria-label="Daily budget dollars"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="h-7 w-[68px] rounded-lg border border-(--line) bg-(--surface) px-2 text-[11.5px] font-semibold tabular-nums outline-none focus:border-(--ink)"
      />
      <button type="button" className={`${mgmtButton} disabled:cursor-default disabled:opacity-45`} disabled={!canApply} onClick={() => setPhase("confirm")}>
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
