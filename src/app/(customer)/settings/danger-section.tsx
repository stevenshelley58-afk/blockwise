"use client";

import { useState } from "react";

import { logCaught } from "@/lib/log";

import { Feedback, Section, type Msg, type RT, type SB } from "./settings-shared";

export function DangerSection({ supabase, router, workspaceId }: { supabase: SB; router: RT; workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    await supabase.auth.signOut({ scope: "global" });
    router.replace("/login");
    router.refresh();
  }

  async function requestDeletion() {
    setConfirmDeleteOpen(true);
  }

  async function confirmDeletion() {
    setConfirmDeleteOpen(false);
    setDelBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/account/delete-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = (await res.json().catch(logCaught("settings: account deletion response parse failed", {}))) as { error?: string };
      setDelBusy(false);
      setMessage(
        res.ok
          ? { tone: "success", text: "Deletion request received. We'll be in touch to confirm." }
          : { tone: "error", text: data.error ?? "Couldn't submit the request." },
      );
    } catch {
      setDelBusy(false);
      setMessage({ tone: "error", text: "Couldn't submit the request." });
    }
  }

  return (
    <Section id="danger" title="Danger zone" description="Account-level actions.">
      <div className="wizard-connect-row">
        <span>
          <strong>Sign out of all devices</strong>
          <div className="item-meta">Ends every active session for your account.</div>
        </span>
        <button className="button secondary" type="button" onClick={signOutEverywhere} disabled={busy}>
          {busy ? "Signing out" : "Sign out everywhere"}
        </button>
      </div>
      <div className="wizard-connect-row">
        <span>
          <strong>Delete account & workspace data</strong>
          <div className="item-meta">Submits a deletion request for review.</div>
        </span>
        <button className="button secondary" type="button" onClick={requestDeletion} disabled={delBusy}>
          {delBusy ? "Submitting" : "Request deletion"}
        </button>
      </div>
      <Feedback message={message} />

      {confirmDeleteOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", padding: 24 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-account-delete-title"
        >
          <div style={{ background: "var(--surface, #fff)", borderRadius: 12, padding: "28px 32px", maxWidth: 440, width: "100%", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }}>
            <h2 id="confirm-account-delete-title" style={{ margin: "0 0 8px", fontSize: 18 }}>Delete your account?</h2>
            <p style={{ margin: "0 0 24px", color: "var(--text-2, #666)" }}>This will permanently delete your account and all data. This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="button secondary" type="button" onClick={() => setConfirmDeleteOpen(false)}>Cancel</button>
              <button className="button" type="button" onClick={confirmDeletion} style={{ background: "var(--destructive, #dc2626)", color: "#fff", borderColor: "transparent" }}>Delete my account</button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
