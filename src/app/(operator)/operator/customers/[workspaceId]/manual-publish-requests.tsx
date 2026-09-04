"use client";

import { useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import type { ManualPublishRequest, ManualPublishStatus } from "@/lib/adstudio/manual-publish";

type PublishSummary = {
  target?: string | null;
  budgetMode?: string | null;
  budget?: number | string | null;
  audience?: string | null;
  placements?: string | null;
  schedule?: string | null;
  destination?: string | null;
  variants?: number | string | null;
  fulfilment?: string | null;
  activationConfirmation?: string | null;
  usesExistingAdSetSettings?: boolean | null;
};

type DisplayRequest = ManualPublishRequest & { publishSummary?: PublishSummary | null };

const STATUS_LABELS: Record<ManualPublishStatus, string> = {
  requested: "Requested",
  in_progress: "In progress",
  completed: "Operator marked complete",
  cancelled: "Cancelled",
};

const STATUS_TONES: Record<ManualPublishStatus, StatusTone> = {
  requested: "amber",
  in_progress: "blue",
  completed: "green",
  cancelled: "rose",
};

export function ManualPublishRequests({ requests }: { requests: DisplayRequest[] }) {
  const [items, setItems] = useState(requests);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function updateStatus(request: ManualPublishRequest, status: ManualPublishStatus) {
    const reason = reasons[request.requestId]?.trim() ?? "";
    if (!reason) {
      setMessage({ tone: "error", text: "Add a reason before changing the request status." });
      return;
    }
    setPending(request.requestId);
    setMessage(null);
    try {
      const response = await fetch(`/api/operator/manual-publish/${encodeURIComponent(request.requestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason }),
      });
      const payload = (await response.json()) as { error?: string; request?: ManualPublishRequest };
      if (!response.ok || !payload.request) throw new Error(payload.error || "The request could not be updated.");
      setItems((current) => current.map((item) => item.requestId === request.requestId ? payload.request! : item));
      setReasons((current) => ({ ...current, [request.requestId]: "" }));
      setMessage({
        tone: "success",
        text: status === "completed"
          ? "Marked as fulfilled manually. This does not connect Meta or publish through Blockwise."
          : `Request marked ${STATUS_LABELS[status].toLowerCase()}.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The request could not be updated." });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel customer-ops-detail-section" id="manual-publishing" aria-labelledby="manual-publishing-title">
      <div className="row-between">
        <div>
          <h2 id="manual-publishing-title">Manual Meta publishing requests</h2>
          <p className="item-meta">Review the customer’s saved creative, then update the handoff as you complete it in Meta manually.</p>
        </div>
        <StatusPill tone="blue">Operator queue</StatusPill>
      </div>
      <p className="item-meta" role="note"><strong>Important:</strong> “Operator marked complete” only records that you finished the manual handoff. It never changes the customer’s Meta connection status.</p>

      {!items.length ? <p className="customer-ops-empty">No manual publishing requests have been submitted for this customer.</p> : null}
      <div className="grid cols-2">
        {items.map((request) => {
          const canStart = request.status === "requested";
          const canFinish = request.status === "in_progress";
          const canCancel = canStart || canFinish;
          const isPending = pending === request.requestId;
          return (
            <article className="item-card" key={request.requestId}>
              <div className="row-between">
                <div>
                  <h3>{request.adName || "Unnamed ad"}</h3>
                  <p className="item-meta">Revision {request.revisionNumber} · Requested {formatDate(request.createdAt)}</p>
                </div>
                <StatusPill tone={STATUS_TONES[request.status]}>{STATUS_LABELS[request.status]}</StatusPill>
              </div>
              {request.notes ? <p>{request.notes}</p> : <p className="item-meta">No customer note was provided.</p>}
              {request.publishSummary ? <PublishSummaryDetails summary={request.publishSummary} /> : null}
              {Object.keys(request.publishControls).length > 0 ? (
                <details className="item-meta" open>
                  <summary><strong>Captured publish controls</strong></summary>
                  <p>These are the exact customer-confirmed controls for the manual handoff, including IDs and fulfilment settings.</p>
                  <pre>{JSON.stringify(request.publishControls, null, 2)}</pre>
                </details>
              ) : null}
              <div className="actions" aria-label={`Preview files for ${request.adName || "this ad"}`}>
                {request.feedPngPath ? <a className="button secondary" href={mediaHref(request.requestId, request.feedPngPath, request.workspaceId)} target="_blank" rel="noreferrer">Open Feed preview</a> : null}
                {request.storyPngPath ? <a className="button secondary" href={mediaHref(request.requestId, request.storyPngPath, request.workspaceId)} target="_blank" rel="noreferrer">Open Story preview</a> : null}
              </div>
              <dl className="item-meta">
                <div><dt>Document hash</dt><dd>{request.documentHash}</dd></div>
                {request.statusReason ? <div><dt>Last status reason</dt><dd>{request.statusReason}</dd></div> : null}
              </dl>
              {canCancel ? (
                <div>
                  <label htmlFor={`manual-reason-${request.requestId}`}>Reason for this update</label>
                  <textarea id={`manual-reason-${request.requestId}`} value={reasons[request.requestId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [request.requestId]: event.target.value }))} maxLength={1000} rows={2} placeholder="What did you verify or complete?" disabled={isPending} />
                  <div className="actions">
                    {canStart ? <button className="button" type="button" disabled={isPending} onClick={() => void updateStatus(request, "in_progress")}>{isPending ? "Updating…" : "Start manual handoff"}</button> : null}
                    {canFinish ? <button className="button" type="button" disabled={isPending} onClick={() => void updateStatus(request, "completed")}>{isPending ? "Updating…" : "Mark manually fulfilled"}</button> : null}
                    <button className="button secondary" type="button" disabled={isPending} onClick={() => void updateStatus(request, "cancelled")}>Cancel request</button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {message ? <p className={message.tone === "success" ? "form-success" : "form-error"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}

function PublishSummaryDetails({ summary }: { summary: PublishSummary }) {
  const entries: Array<[string, string | null | undefined]> = [
    ["Target", summary.target],
    ["Budget", [summary.budgetMode, summary.budget].filter(Boolean).join(" · ")],
    ["Audience", summary.audience],
    ["Placements", summary.placements],
    ["Schedule", summary.schedule],
    ["Destination", summary.destination],
    ["Variants", summary.variants == null ? null : String(summary.variants)],
    ["Fulfillment", summary.fulfilment],
    ["Activation", summary.activationConfirmation],
    ["Ad set settings", summary.usesExistingAdSetSettings == null ? null : summary.usesExistingAdSetSettings ? "Use existing settings" : "New settings"],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (!entries.length) return null;
  return (
    <div className="item-meta" aria-label="Publish setup summary">
      <strong>Publish setup captured from customer</strong>
      <dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
  );
}

function mediaHref(requestId: string, path: string, workspaceId: string) {
  return `/api/operator/manual-publish/${encodeURIComponent(requestId)}/media?path=${encodeURIComponent(path)}&workspaceId=${encodeURIComponent(workspaceId)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
