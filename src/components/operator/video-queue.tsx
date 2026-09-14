"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The operator's queue.
 *
 * Every row leads with the commitment already made to the customer, because
 * that is the thing an editor is working against. Operator actions are plain
 * controls; this is a work tool, not a customer surface.
 */

export type VideoQueueRow = {
  orderId: string;
  workspaceId: string;
  projectId: string;
  projectTitle: string;
  stateLabel: string;
  urgencyLabel: string;
  urgency: string;
  firstDraftDueAt: string | null;
  dueTimezone: string;
  sourceCount: number;
  draftCount: number;
  revisionEntitlement: number;
  revisionsUsed: number;
  assignedOperator: string | null;
  unclaimedHours: number | null;
  amountMinor: number;
  currency: string;
};

const URGENCY_TONE: Record<string, string> = {
  unclaimed: "border-(--warning) text-(--warning)",
  overdue: "border-(--destructive) text-(--destructive)",
  at_risk: "border-(--warning) text-(--warning)",
  due_soon: "border-(--line)",
  on_track: "border-(--line)",
  waiting_on_customer: "border-(--line)",
};

function formatDue(iso: string | null, timezone: string): string {
  if (!iso) return "No deadline recorded";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(minor / 100);
}

export function VideoQueue({ orders }: { orders: VideoQueueRow[] }) {
  const [pending, startTransition] = useTransition();
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(orderId: string, action: "claim" | "draft" | "deliver", assetId?: string) {
    setBusyOrder(orderId);
    setError(null);
    try {
      const response = await fetch("/api/operator/video-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, orderId, assetId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "That action failed.");
        return;
      }
      // Reload so the row reflects the recorded state rather than an
      // optimistic guess about what the server did.
      startTransition(() => window.location.reload());
    } catch {
      setError("That action failed.");
    } finally {
      setBusyOrder(null);
    }
  }

  const busy = (orderId: string) => busyOrder === orderId || pending;

  return (
    <div className="grid gap-3">
      {error ? (
        <p role="alert" className="text-sm text-(--destructive)">
          {error}
        </p>
      ) : null}

      <ul className="grid gap-2">
        {orders.map((order) => (
          <li key={order.orderId}>
            <Card className="grid gap-3 rounded-(--r-card) border border-(--line) bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-0.5">
                  <p className="text-sm font-semibold">{order.projectTitle}</p>
                  <p className="text-xs text-(--muted-foreground)">
                    {order.stateLabel} · {formatMoney(order.amountMinor, order.currency)} ·{" "}
                    {order.sourceCount} source{order.sourceCount === 1 ? "" : "s"} ·{" "}
                    {order.revisionsUsed}/{order.revisionEntitlement} revisions used
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold",
                    URGENCY_TONE[order.urgency] ?? "border-(--line)",
                  )}
                >
                  {order.urgencyLabel}
                </span>
              </div>

              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-(--muted-foreground)">Draft due</dt>
                  <dd className="font-semibold">{formatDue(order.firstDraftDueAt, order.dueTimezone)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-(--muted-foreground)">Assigned</dt>
                  <dd className="font-semibold">
                    {order.assignedOperator ? "Claimed" : `Nobody${order.unclaimedHours !== null ? ` · ${Math.round(order.unclaimedHours)}h waiting` : ""}`}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                {!order.assignedOperator ? (
                  <Button
                    type="button"
                    disabled={busy(order.orderId)}
                    onClick={() => void run(order.orderId, "claim")}
                  >
                    {busy(order.orderId) ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    Claim
                  </Button>
                ) : (
                  <>
                    <label className="grid gap-1 text-xs">
                      <span className="text-(--muted-foreground)">Draft file</span>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        className="text-xs"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadThen(order.orderId, "draft", file);
                        }}
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      <span className="text-(--muted-foreground)">Final file</span>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        className="text-xs"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadThen(order.orderId, "deliver", file);
                        }}
                      />
                    </label>
                  </>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );

  /**
   * Upload the file through the same inspected, resumable path the customer
   * uses, then attach it to the order. The asset must be ready before the
   * order records it, so an order never points at a half-uploaded file.
   */
  async function uploadThen(orderId: string, kind: "draft" | "deliver", file: File) {
    setBusyOrder(orderId);
    setError(null);
    try {
      const order = orders.find((row) => row.orderId === orderId);
      if (!order) return;

      const started = await fetch("/api/operator/video-orders/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: order.workspaceId,
          projectId: order.projectId,
          fileName: file.name,
          declaredBytes: file.size,
          declaredMime: file.type || "video/mp4",
          kind: kind === "draft" ? "draft" : "final",
        }),
      });
      const startBody = (await started.json().catch(() => ({}))) as {
        uploadId?: string;
        chunkBytes?: number;
        offset?: number;
        error?: string;
      };
      if (!started.ok || !startBody.uploadId) {
        setError(startBody.error ?? "That upload could not be started.");
        return;
      }

      const chunkBytes = startBody.chunkBytes ?? 8 * 1024 * 1024;
      let offset = startBody.offset ?? 0;
      while (offset < file.size) {
        const slice = file.slice(offset, Math.min(offset + chunkBytes, file.size));
        const response = await fetch(
          `/api/operator/video-orders/upload?uploadId=${encodeURIComponent(startBody.uploadId)}&offset=${offset}`,
          { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: slice },
        );
        const payload = (await response.json().catch(() => ({}))) as { offset?: number; error?: string };
        if (!response.ok && response.status !== 409) {
          setError(payload.error ?? "That upload failed.");
          return;
        }
        if (typeof payload.offset !== "number") {
          setError("That upload failed.");
          return;
        }
        offset = payload.offset;
      }

      const finalised = await fetch(
        `/api/operator/video-orders/upload?uploadId=${encodeURIComponent(startBody.uploadId)}&finalise=1`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ totalBytes: file.size }) },
      );
      const finalBody = (await finalised.json().catch(() => ({}))) as { state?: string; error?: string };
      if (!finalised.ok || finalBody.state !== "ready") {
        setError(finalBody.error ?? "That file was not accepted.");
        return;
      }

      await run(orderId, kind, startBody.uploadId);
    } catch {
      setError("That upload failed.");
    } finally {
      setBusyOrder(null);
    }
  }
}
