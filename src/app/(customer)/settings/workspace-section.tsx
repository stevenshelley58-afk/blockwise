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
  type LeadDestinationType,
  type Msg,
  type RT,
  type SB,
  type SettingsViewProps,
} from "./settings-shared";

const LEAD_DESTINATION_TYPES: Array<{ value: LeadDestinationType; label: string }> = [
  { value: "manual", label: "Manual review" },
  { value: "webhook", label: "Webhook" },
  { value: "crm", label: "CRM" },
];

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

  // Publishing details save themselves as they change, so nothing on this card
  // competes with the Connect button on the ad-accounts card.
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(workspace.privacyPolicyUrl ?? "");
  const [leadDestinationType, setLeadDestinationType] = useState<LeadDestinationType | "">(
    workspace.leadDestinationType ?? "",
  );
  const [leadDestinationLabel, setLeadDestinationLabel] = useState(workspace.leadDestinationLabel ?? "");
  const [leadDestinationEndpoint, setLeadDestinationEndpoint] = useState(workspace.leadDestinationEndpoint ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState<Msg>(null);

  async function savePublishingDetails(patch: Record<string, unknown>) {
    setSavingDetails(true);
    setDetailsMessage(null);
    try {
      const response = await fetch("/api/workspace/publishing-defaults", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id, ...patch }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setDetailsMessage({ tone: "error", text: payload.error ?? "Couldn't save publishing details." });
        return;
      }
      setDetailsMessage({ tone: "success", text: "Publishing details saved." });
      router.refresh();
    } catch {
      setDetailsMessage({ tone: "error", text: "Couldn't save publishing details. Check your connection and try again." });
    } finally {
      setSavingDetails(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    let nameSaved = false;
    try {
      const { data, error } = await supabase
        .from("workspaces")
        .update({ name: name.trim() || workspace.name, updated_at: new Date().toISOString() })
        .eq("id", workspace.id)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        setMessage({ tone: "error", text: "Couldn't save workspace settings. Check your access and try again." });
        return;
      }
      nameSaved = true;
      if (country !== workspace.country) {
        const response = await fetch("/api/workspace/onboarding-market", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: workspace.id, country, websiteUrl: workspace.website }),
        });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          setMessage({ tone: "error", text: `Workspace name saved, but country was not changed. ${payload.error ?? "Try again."}` });
          return;
        }
      }
      setMessage({ tone: "success", text: "Workspace settings saved." });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: nameSaved
        ? "Workspace name saved, but country was not changed. Check your connection and try again."
        : "Couldn't save workspace settings. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const needsEndpoint = leadDestinationType === "webhook" || leadDestinationType === "crm";

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
            <Input className="min-w-0 flex-1" id="workspace-website" value={workspace.website} readOnly />
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
            <Input id="workspace-currency" value={workspace.currency} readOnly />
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

      <div className="mt-2 grid gap-4 border-t border-(--line) pt-4">
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-medium">Lead form publishing</strong>
          <span className="text-sm text-muted-foreground">Used for every Meta lead ad this workspace publishes.</span>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="workspace-privacy-policy">Privacy policy URL</Label>
          <Input
            id="workspace-privacy-policy"
            type="url"
            value={privacyPolicyUrl}
            onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
            onBlur={() => void savePublishingDetails({ privacyPolicyUrl })}
            placeholder="https://example.com/privacy"
          />
          <p className="text-xs text-muted-foreground">Linked from your Meta lead forms.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="workspace-lead-destination-type">Lead destination</Label>
            <select
              id="workspace-lead-destination-type"
              className={selectClass}
              value={leadDestinationType}
              onChange={(e) => {
                const type = e.target.value as LeadDestinationType | "";
                setLeadDestinationType(type);
                void savePublishingDetails({
                  leadDestination: {
                    type,
                    label: leadDestinationLabel,
                    endpoint: leadDestinationEndpoint,
                  },
                });
              }}
            >
              <option value="">Choose a destination</option>
              {LEAD_DESTINATION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-lead-destination-label">Destination label</Label>
            <Input
              id="workspace-lead-destination-label"
              value={leadDestinationLabel}
              onChange={(e) => setLeadDestinationLabel(e.target.value)}
              onBlur={() =>
                void savePublishingDetails({
                  leadDestination: {
                    type: leadDestinationType,
                    label: leadDestinationLabel,
                    endpoint: leadDestinationEndpoint,
                  },
                })
              }
            />
          </div>
        </div>

        {needsEndpoint ? (
          <div className="grid gap-2">
            <Label htmlFor="workspace-lead-destination-endpoint">Destination endpoint</Label>
            <Input
              id="workspace-lead-destination-endpoint"
              value={leadDestinationEndpoint}
              onChange={(e) => setLeadDestinationEndpoint(e.target.value)}
              onBlur={() =>
                void savePublishingDetails({
                  leadDestination: {
                    type: leadDestinationType,
                    label: leadDestinationLabel,
                    endpoint: leadDestinationEndpoint,
                  },
                })
              }
              placeholder="https://example.com/meta-leads"
            />
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="workspace-publishing-currency">Currency</Label>
            <Input
              id="workspace-publishing-currency"
              value={workspace.publishingCurrency ?? ""}
              placeholder="Not synced yet"
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              {workspace.publishingCurrency
                ? "Pulled directly from your Meta ad account."
                : "This will be pulled from your Meta ad account once one is connected."}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="workspace-publishing-timezone">Timezone</Label>
            <Input
              id="workspace-publishing-timezone"
              value={workspace.publishingTimezone ?? ""}
              placeholder="Not synced yet"
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              {workspace.publishingTimezone
                ? "Pulled directly from your Meta ad account."
                : "This will be pulled from your Meta ad account once one is connected."}
            </p>
          </div>
        </div>

        {savingDetails ? (
          <p className="text-xs text-muted-foreground" aria-live="polite">Saving…</p>
        ) : null}
        <Feedback message={detailsMessage} />
      </div>
    </Section>
  );
}
