"use client";

import { useState } from "react";

import { Feedback, Section, type Msg, type SB } from "./settings-shared";

const NOTIFICATION_OPTIONS: Array<{ key: string; label: string; description: string; fallback: boolean }> = [
  { key: "approvalRequests", label: "Approval requests", description: "When something needs review before publishing.", fallback: true },
  { key: "leadAlerts", label: "New leads", description: "When a new lead arrives from Meta or Google.", fallback: true },
  { key: "weeklyDigest", label: "Weekly digest", description: "A weekly summary of spend, leads, and results.", fallback: false },
  { key: "productUpdates", label: "Product updates", description: "Occasional news about new Blockwise features.", fallback: false },
];

export function NotificationsSection({ supabase, userId, initial }: { supabase: SB; userId: string; initial: Record<string, boolean> }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const seeded: Record<string, boolean> = {};
    for (const opt of NOTIFICATION_OPTIONS) {
      seeded[opt.key] = typeof initial[opt.key] === "boolean" ? initial[opt.key] : opt.fallback;
    }
    return seeded;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from("profiles")
      .update({ notification_preferences: prefs, updated_at: new Date().toISOString() })
      .eq("id", userId);
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't save notification preferences." });
      return;
    }
    setMessage({ tone: "success", text: "Notification preferences saved." });
  }

  return (
    <Section id="notifications" title="Notifications" description="Choose which emails Blockwise sends you.">
      {NOTIFICATION_OPTIONS.map((opt) => (
        <label className="wizard-connect-row" key={opt.key} style={{ cursor: "pointer" }}>
          <span>
            <strong>{opt.label}</strong>
            <div className="item-meta">{opt.description}</div>
          </span>
          <input
            type="checkbox"
            checked={prefs[opt.key] ?? opt.fallback}
            onChange={(e) => setPrefs((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
          />
        </label>
      ))}
      <Feedback message={message} />
      <div className="wizard-actions">
        <button className="button" type="button" onClick={save} disabled={busy}>
          {busy ? "Saving" : "Save preferences"}
        </button>
      </div>
    </Section>
  );
}
