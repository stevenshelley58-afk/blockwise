"use client";

import { useState } from "react";

import { StatusPill, type StatusTone } from "@/components/status-pill";
import type {
  MetaPartnerAccessRequest,
  MetaPartnerAccessRequestStatus,
} from "@/lib/providers/meta-partner-access-requests";

const LABELS: Record<MetaPartnerAccessRequestStatus, string> = {
  requested: "Waiting for verification",
  verifying: "Verification in progress",
  ready_for_manual_publishing: "Verified for manual publishing",
  needs_changes: "Customer action needed",
  cancelled: "Cancelled",
};
const TONES: Record<MetaPartnerAccessRequestStatus, StatusTone> = {
  requested: "amber",
  verifying: "blue",
  ready_for_manual_publishing: "green",
  needs_changes: "rose",
  cancelled: "rose",
};

export function MetaPartnerAccessRequests({
  requests,
}: {
  requests: MetaPartnerAccessRequest[];
}) {
  const [items, setItems] = useState(requests);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);

  async function update(
    request: MetaPartnerAccessRequest,
    status: MetaPartnerAccessRequestStatus,
  ) {
    const reason = reasons[request.requestId]?.trim() ?? "";
    if (!reason) {
      setMessage({
        error: true,
        text: "Add a verification note before changing the request status.",
      });
      return;
    }
    setPending(request.requestId);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/operator/meta-partner-access/${encodeURIComponent(request.requestId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, reason }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        request?: MetaPartnerAccessRequest;
        error?: string;
      };
      if (!response.ok || !payload.request)
        throw new Error(payload.error ?? "The request could not be updated.");
      setItems((current) =>
        current.map((item) =>
          item.requestId === request.requestId ? payload.request! : item,
        ),
      );
      setReasons((current) => ({ ...current, [request.requestId]: "" }));
      setMessage({
        error: false,
        text:
          status === "ready_for_manual_publishing"
            ? "Partner access verified for manual publishing. Meta has not been marked API-connected."
            : `Request marked ${LABELS[status].toLowerCase()}.`,
      });
    } catch (error) {
      setMessage({
        error: true,
        text:
          error instanceof Error
            ? error.message
            : "The request could not be updated.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className="panel customer-ops-detail-section"
      id="meta-partner-access"
      aria-labelledby="meta-partner-access-title"
    >
      <div className="row-between">
        <div>
          <h2 id="meta-partner-access-title">Meta partner-access requests</h2>
          <p className="item-meta">
            Match the exact IDs against the assets visible to Blockwise in Meta
            Business Settings. This is a manual verification, not an API
            connection.
          </p>
        </div>
        <StatusPill tone="blue">Operator queue</StatusPill>
      </div>
      {!items.length ? (
        <p className="customer-ops-empty">
          No Meta partner-access requests have been submitted for this customer.
        </p>
      ) : null}
      <div className="grid cols-2">
        {items.map((request) => (
          <RequestCard
            key={request.requestId}
            request={request}
            reason={reasons[request.requestId] ?? ""}
            pending={pending === request.requestId}
            onReason={(value) =>
              setReasons((current) => ({
                ...current,
                [request.requestId]: value,
              }))
            }
            onUpdate={update}
          />
        ))}
      </div>
      {message ? (
        <p
          className={message.error ? "form-error" : "form-success"}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

function RequestCard({
  request,
  reason,
  pending,
  onReason,
  onUpdate,
}: {
  request: MetaPartnerAccessRequest;
  reason: string;
  pending: boolean;
  onReason: (value: string) => void;
  onUpdate: (
    request: MetaPartnerAccessRequest,
    status: MetaPartnerAccessRequestStatus,
  ) => Promise<void>;
}) {
  const actions: Array<[MetaPartnerAccessRequestStatus, string]> =
    request.status === "requested"
      ? [
          ["verifying", "Start verification"],
          ["needs_changes", "Request changes"],
          ["cancelled", "Cancel"],
        ]
      : request.status === "verifying"
        ? [
            ["ready_for_manual_publishing", "Verify partner access"],
            ["needs_changes", "Request changes"],
            ["cancelled", "Cancel"],
          ]
        : request.status === "needs_changes"
          ? [
              ["verifying", "Re-check corrected access"],
              ["cancelled", "Cancel"],
            ]
          : request.status === "ready_for_manual_publishing"
            ? [["cancelled", "Revoke verification"]]
            : [];
  return (
    <article className="item-card">
      <div className="row-between">
        <div>
          <h3>Partner access request</h3>
          <p className="item-meta">Submitted {formatDate(request.createdAt)}</p>
        </div>
        <StatusPill tone={TONES[request.status]}>
          {LABELS[request.status]}
        </StatusPill>
      </div>
      <dl className="item-meta">
        <div>
          <dt>Ad account ID</dt>
          <dd>{request.adAccountId}</dd>
        </div>
        <div>
          <dt>Facebook Page ID</dt>
          <dd>{request.pageId}</dd>
        </div>
        <div>
          <dt>Instagram account ID</dt>
          <dd>{request.instagramAccountId ?? "Not shared"}</dd>
        </div>
      </dl>
      {request.statusReason ? (
        <p>
          <strong>Latest operator note:</strong> {request.statusReason}
        </p>
      ) : null}
      {request.status === "ready_for_manual_publishing" ? (
        <p className="form-success">
          Verified for operator-assisted publishing only. Do not mark the
          provider connection as connected.
        </p>
      ) : null}
      {actions.length ? (
        <div>
          <label htmlFor={`meta-access-reason-${request.requestId}`}>
            Verification note
          </label>
          <textarea
            id={`meta-access-reason-${request.requestId}`}
            value={reason}
            onChange={(event) => onReason(event.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="What did you check, or what must the customer change?"
            disabled={pending}
          />
          <div className="actions">
            {actions.map(([status, label]) => (
              <button
                className={
                  status === "verifying" ||
                  status === "ready_for_manual_publishing"
                    ? "button"
                    : "button secondary"
                }
                type="button"
                key={status}
                disabled={pending}
                onClick={() => void onUpdate(request, status)}
              >
                {pending ? "Updating…" : label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown date"
    : new Intl.DateTimeFormat("en-AU", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
