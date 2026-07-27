"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import {
  Feedback,
  REGION_CURRENCY,
  REGION_NAMES,
  Section,
  selectClass,
  type Msg,
  type RT,
  type SB,
  type SettingsViewProps,
} from "./settings-shared";

export function WorkspaceSection({
  supabase,
  router,
  workspace,
}: {
  supabase: SB;
  router: RT;
  workspace: SettingsViewProps["workspace"];
}) {
  const [name, setName] = useState(workspace.name);
  const [region, setRegion] = useState(workspace.region);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: name.trim() || workspace.name,
        region: region.trim() || "AU",
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't save workspace settings." });
      return;
    }
    setMessage({ tone: "success", text: "Workspace settings saved." });
    router.refresh();
  }

  return (
    <Section id="workspace" title={niche.copy.settings.sections.workspace}>
      <form className="grid gap-4" onSubmit={save}>
        <div className="grid gap-2">
          <Label htmlFor="workspace-name">Workspace name</Label>
          <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="workspace-region">Region</Label>
          <select id="workspace-region" className={selectClass} value={region} onChange={(e) => setRegion(e.target.value)} required>
            {Object.keys(REGION_CURRENCY).map((r) => (
              <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-medium">Publishing review</strong>
          <span className="text-sm text-muted-foreground">All campaigns are reviewed before going live during early access.</span>
        </div>
        <Feedback message={message} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving" : "Save workspace"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
