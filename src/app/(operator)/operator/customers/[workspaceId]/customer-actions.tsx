"use client";

import { useState } from "react";

type OperatorAction = "adjust_credits" | "resend_booking" | "complete_onboarding";

export function CustomerActions({ workspaceId }: { workspaceId: string }) {
  const [reason, setReason] = useState("");
  const [creditDelta, setCreditDelta] = useState("10");
  const [pending, setPending] = useState<OperatorAction | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function run(action: OperatorAction) {
    if (!reason.trim()) {
      setMessage({ tone: "error", text: "Add a reason before running an audited action." });
      return;
    }
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/operator/customers/${workspaceId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          mutationId: crypto.randomUUID(),
          reason,
          creditDelta: action === "adjust_credits" ? Number(creditDelta) : undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: { delivery?: string; bookingUrl?: string };
      };
      if (!response.ok) throw new Error(payload.error || "Customer action failed.");
      const manualBooking = payload.result?.delivery === "manual" && payload.result.bookingUrl;
      setMessage({
        tone: "success",
        text: manualBooking
          ? `Booking link prepared for manual delivery: ${payload.result?.bookingUrl}`
          : action === "adjust_credits"
            ? "Credits adjusted and audited."
            : action === "resend_booking"
              ? payload.result?.delivery === "queued"
                ? "Booking link queued for delivery and audited."
                : "Booking link sent and audited."
              : "Onboarding marked completed and audited.",
      });
      setReason("");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Customer action failed." });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="panel customer-ops-actions" aria-labelledby="service-actions-title">
      <div>
        <h2 id="service-actions-title">Service actions</h2>
        <p className="item-meta">Every action is idempotent, attributed to you, and written to audit history.</p>
      </div>
      <label htmlFor="operator-action-reason">Reason</label>
      <textarea
        id="operator-action-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        placeholder="Why is this intervention needed?"
        rows={3}
      />
      <div className="customer-ops-credit-action">
        <label htmlFor="credit-adjustment">Credit adjustment</label>
        <input
          id="credit-adjustment"
          type="number"
          min="-10000"
          max="10000"
          step="1"
          value={creditDelta}
          onChange={(event) => setCreditDelta(event.target.value)}
        />
        <button className="button" type="button" disabled={Boolean(pending)} onClick={() => void run("adjust_credits")}>
          {pending === "adjust_credits" ? "Adjusting…" : "Adjust credits"}
        </button>
      </div>
      <div className="actions">
        <button className="button secondary" type="button" disabled={Boolean(pending)} onClick={() => void run("resend_booking")}>
          {pending === "resend_booking" ? "Preparing…" : "Resend booking link"}
        </button>
        <button className="button secondary" type="button" disabled={Boolean(pending)} onClick={() => void run("complete_onboarding")}>
          {pending === "complete_onboarding" ? "Completing…" : "Mark onboarding completed"}
        </button>
      </div>
      {message ? (
        <p className={message.tone === "success" ? "form-success" : "form-error"} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
