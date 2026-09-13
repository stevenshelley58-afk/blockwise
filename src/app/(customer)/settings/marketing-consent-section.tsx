"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { Feedback, Section, type Msg, type SB } from "./settings-shared";

export function MarketingConsentSection({
  supabase, workspaceId, emailVerified, initial,
}: { supabase: SB; workspaceId: string; emailVerified: boolean; initial: boolean }) {
  const [granted, setGranted] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const canChange = emailVerified || saved;

  async function save() {
    if (granted && !emailVerified) {
      setMessage({ tone: "error", text: "Verify your email before opting in." });
      return;
    }
    if (granted === saved) {
      setMessage({ tone: "success", text: "Marketing email preference is already saved." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("record_workspace_marketing_consent", {
        p_workspace_id: workspaceId, p_granted: granted,
      });
      if (error) {
        setMessage({ tone: "error", text: "Couldn't save marketing email preference." });
        return;
      }
      setSaved(granted);
      setMessage({ tone: "success", text: "Marketing email preference saved." });
    } catch {
      setMessage({ tone: "error", text: "Couldn't save marketing email preference." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="marketing-consent" title="Marketing emails" description="Optional. Separate from account and service notices.">
      <div className="flex items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <Label htmlFor="marketing-consent">Occasional product updates</Label>
          <p className="text-xs text-muted-foreground">You can change this any time.</p>
        </div>
        <Switch id="marketing-consent" checked={granted} disabled={busy || !canChange} onCheckedChange={setGranted} />
      </div>
      {!emailVerified && !saved ? <p className="text-xs font-semibold text-muted-foreground">Verify your email to opt in.</p> : null}
      <Feedback message={message} />
      <Button type="button" onClick={save} disabled={busy || !canChange}>{busy ? "Saving" : "Save marketing preference"}</Button>
    </Section>
  );
}