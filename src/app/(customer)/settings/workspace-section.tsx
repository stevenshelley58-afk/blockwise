"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/status-pill";
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
  const [country, setCountry] = useState(workspace.country);
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspace.id);
    if (!error && country !== workspace.country) {
      const response = await fetch("/api/workspace/onboarding-market", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          country,
          websiteUrl: workspace.website,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setBusy(false);
        setMessage({ tone: "error", text: payload.error ?? "Couldn't change the workspace country." });
        return;
      }
    }
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
          <Label htmlFor="workspace-website">Primary website</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input className="min-w-[220px] flex-1" id="workspace-website" value={workspace.website} readOnly />
            <Button asChild variant="outline">
              <Link href="/ad-studio/brand">Review Brand Pack</Link>
            </Button>
          </div>
          <div>
            <StatusPill tone={workspace.brandPackStatus === "approved" ? "green" : "amber"}>
              {workspace.brandPackStatus?.replaceAll("_", " ") ?? "Brand Pack not started"}
            </StatusPill>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="workspace-region">Country</Label>
            <select
              id="workspace-region"
              className={selectClass}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              disabled={workspace.marketBound}
              required
            >
            {Object.keys(REGION_CURRENCY).map((r) => (
              <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>
            ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-currency">Billing currency</Label>
            <Input id="workspace-currency" value="AUD" readOnly />
          </div>
        </div>
        {workspace.marketBound ? (
          <p className="text-xs text-muted-foreground">
            Country and currency are bound after Checkout or Meta connection. Contact Blockwise for an assisted workspace migration.
          </p>
        ) : null}
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
