"use client";

import { useEffect, useState } from "react";

type Assignment = {
  ad_account_id: string;
  ad_account_name: string;
  page_id: string;
  currency: string;
  timezone: string;
};

export function MetaPartnerAssignment({ workspaceId }: { workspaceId: string }) {
  const [adAccountId, setAdAccountId] = useState("");
  const [pageId, setPageId] = useState("");
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const endpoint = `/api/operator/customers/${workspaceId}/meta-partner-assignment`;

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { assignment?: Assignment | null; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Meta assignment could not be loaded.");
        if (!active) return;
        setAssignment(payload.assignment ?? null);
        setAdAccountId(payload.assignment?.ad_account_id ?? "");
        setPageId(payload.assignment?.page_id ?? "");
      })
      .catch((error) => {
        if (active) setMessage({ tone: "error", text: error instanceof Error ? error.message : "Meta assignment could not be loaded." });
      });
    return () => { active = false; };
  }, [endpoint]);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId, pageId }),
      });
      const payload = (await response.json().catch(() => ({}))) as { assignment?: Assignment; error?: string };
      if (!response.ok || !payload.assignment) throw new Error(payload.error ?? "Meta assignment could not be saved.");
      setAssignment(payload.assignment);
      setAdAccountId(payload.assignment.ad_account_id);
      setPageId(payload.assignment.page_id);
      setMessage({ tone: "success", text: "Meta ad account and Page verified for this workspace." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Meta assignment could not be saved." });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Meta assignment could not be removed.");
      setAssignment(null);
      setAdAccountId("");
      setPageId("");
      setMessage({ tone: "success", text: "Meta assignment removed." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Meta assignment could not be removed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel customer-ops-actions" aria-labelledby="meta-partner-assignment-title">
      <div>
        <h2 id="meta-partner-assignment-title">Meta partner assignment</h2>
        <p className="item-meta">Verify the customer’s shared ad account and Page before they can connect or spend.</p>
      </div>
      <label htmlFor="meta-partner-ad-account">Ad account ID</label>
      <input id="meta-partner-ad-account" value={adAccountId} onChange={(event) => setAdAccountId(event.target.value)} placeholder="act_123456789" />
      <label htmlFor="meta-partner-page">Page ID</label>
      <input id="meta-partner-page" value={pageId} onChange={(event) => setPageId(event.target.value)} placeholder="123456789" />
      <div className="actions">
        <button className="button" type="button" disabled={pending || !adAccountId.trim() || !pageId.trim()} onClick={() => void save()}>
          {pending ? "Verifying…" : assignment ? "Re-verify assignment" : "Verify and assign"}
        </button>
        {assignment ? <button className="button secondary" type="button" disabled={pending} onClick={() => void remove()}>Remove assignment</button> : null}
      </div>
      {assignment ? <p className="item-meta">Assigned: {assignment.ad_account_name} · {assignment.ad_account_id} · Page {assignment.page_id}</p> : null}
      {message ? <p className={message.tone === "success" ? "form-success" : "form-error"} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
