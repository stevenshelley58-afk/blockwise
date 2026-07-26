"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type SB } from "./settings-shared";

const NOTIFICATION_OPTIONS: Array<{ key: string; label: string; description: string; fallback: boolean }> = [
  { key: "approvalRequests", label: "Approval requests", description: "Something needs your review.", fallback: true },
  { key: "leadAlerts", label: "New leads", description: "A lead just arrived.", fallback: true },
  { key: "weeklyDigest", label: "Weekly digest", description: "Spend and leads, weekly.", fallback: false },
  { key: "productUpdates", label: "Product updates", description: "New features, occasionally.", fallback: false },
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
    <Section id="notifications" title={niche.copy.settings.sections.notifications}>
      {NOTIFICATION_OPTIONS.map((opt) => (
        <div className="flex items-center justify-between gap-4" key={opt.key}>
          <div className="grid gap-0.5">
            <Label htmlFor={`notif-${opt.key}`}>{opt.label}</Label>
            <p className="text-xs text-muted-foreground">{opt.description}</p>
          </div>
          <Switch
            id={`notif-${opt.key}`}
            checked={prefs[opt.key] ?? opt.fallback}
            onCheckedChange={(checked) => setPrefs((prev) => ({ ...prev, [opt.key]: checked }))}
          />
        </div>
      ))}
      <Feedback message={message} />
      <div>
        <Button type="button" onClick={save} disabled={busy}>
          {busy ? "Saving" : "Save preferences"}
        </Button>
      </div>
    </Section>
  );
}
