"use client";

import { useEffect, useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import { Feedback, REGION_CURRENCY, Section, selectClass, type Connection, type Msg, type RT, type SB } from "./settings-shared";

type MetaLeadDestinationType = "webhook" | "crm" | "manual";

type MetaSetup = {
  metaAdAccountId: string;
  pageId: string;
  instagramActorId: string | null;
  pixelId: string | null;
  leadDestination: {
    type: MetaLeadDestinationType;
    label: string;
    config?: {
      endpoint?: string;
      [key: string]: unknown;
    };
  };
  privacyPolicyUrl: string;
  currency: string;
  timezone: string;
};

type MetaAssetCatalog = {
  adAccounts: Array<{ id: string; name: string; currency: string; timezone: string }>;
  pages: Array<{ id: string; name: string }>;
  instagramActors: Array<{ id: string; username: string; pageId?: string }>;
  pixels: Array<{ id: string; name: string }>;
};

type MetaSetupResponse = {
  connected?: boolean;
  setup?: MetaSetup | null;
  blockers?: string[];
  ready?: boolean;
  assets?: MetaAssetCatalog | null;
  assetsError?: string | null;
  error?: string;
};

const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType[] = ["manual", "webhook", "crm"];

const FALLBACK_TIMEZONES = [
  "Australia/Perth",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "UTC",
];

const TIMEZONE_OPTIONS: string[] =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : FALLBACK_TIMEZONES;

const STATUS_LABELS: Record<string, string> = {
  connected: "Connected",
  needs_attention: "Needs attention",
  revoked: "Disconnected",
  not_connected: "Not connected",
};

function statusTone(status: string): "green" | "amber" | "rose" | "blue" {
  if (status === "connected") return "green";
  if (status === "needs_attention") return "amber";
  if (status === "revoked") return "rose";
  return "blue";
}

export function ConnectionsSection({
  supabase,
  router,
  canManage,
  workspaceId,
  connections,
  googleAdsEnabled,
  metaConnectHref,
  googleConnectHref,
}: {
  supabase: SB;
  router: RT;
  canManage: boolean;
  workspaceId: string;
  connections: Connection[];
  googleAdsEnabled: boolean;
  metaConnectHref: string;
  googleConnectHref: string;
}) {
  const [message, setMessage] = useState<Msg>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);

  const providers: Array<{ key: string; label: string; connectHref: string; enabled: boolean; startLabel?: string }> = [
    { key: "meta", label: "Meta (Facebook & Instagram)", connectHref: metaConnectHref, enabled: true, startLabel: "Share Meta assets" },
    { key: "google", label: "Google Ads", connectHref: googleConnectHref, enabled: googleAdsEnabled },
  ];

  async function disconnect(provider: string, label: string) {
    setBusyProvider(provider);
    setMessage(null);
    try {
      if (provider === "meta") {
        // Use the server-side route so the Meta app grant is also revoked.
        const res = await fetch("/api/integrations/meta/disconnect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Couldn't disconnect ${label}.`);
        }
      } else {
        const { error } = await supabase
          .from("provider_connections")
          .update({ status: "revoked", updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId)
          .eq("provider", provider);
        if (error) throw error;
      }
      setMessage({ tone: "success", text: `${label} disconnected.` });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : `Couldn't disconnect ${label}.`,
      });
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <Section id="connections" title={niche.copy.settings.sections.connections}>
      {providers.map((prov) => {
        const conn = connections.find((c) => c.provider === prov.key);
        const connected = conn && conn.status !== "revoked" && conn.status !== "not_connected";
        return (
          <div className="flex flex-col gap-3" key={prov.key}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <strong className="text-sm font-medium">{prov.label}</strong>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {conn?.accountName ? <span>{conn.accountName} ·</span> : null}
                  {conn ? <StatusPill tone={statusTone(conn.status)}>{STATUS_LABELS[conn.status] ?? conn.status.replace(/_/g, " ")}</StatusPill> : <StatusPill tone="blue">Not connected</StatusPill>}
                </div>
              </div>
              {!prov.enabled ? (
                <Button variant="outline" type="button" disabled>
                  Not enabled yet
                </Button>
              ) : !canManage ? (
                <StatusPill tone="blue">Owner/admin only</StatusPill>
              ) : connected ? (
                <div className="flex gap-2">
                  <Button variant="outline" asChild>
                    <a href={prov.connectHref}>Reconnect</a>
                  </Button>
                  <Button variant="outline" type="button" onClick={() => disconnect(prov.key, prov.label)} disabled={busyProvider === prov.key}>
                    {busyProvider === prov.key ? "Working" : "Disconnect"}
                  </Button>
                </div>
              ) : (
                <Button asChild>
                  <a href={prov.connectHref}>{prov.startLabel ?? "Connect"}</a>
                </Button>
              )}
            </div>
            {prov.key === "meta" && connected && canManage ? (
              <MetaSetupForm workspaceId={workspaceId} canManage={canManage} />
            ) : null}
            {prov.key === "meta" && connected && !canManage ? (
              <p className="text-sm text-muted-foreground">An owner or admin can view and change Meta publishing assets.</p>
            ) : null}
            {prov.key === "meta" && !connected ? (
              <p className="text-sm text-muted-foreground">Share your ad account, Facebook Page, and optional linked Instagram account with Blockwise for operator-assisted publishing while direct Meta app access is under review.</p>
            ) : null}
          </div>
        );
      })}
      <Feedback message={message} />
    </Section>
  );
}

function emptyMetaSetup(): MetaSetup {
  return {
    metaAdAccountId: "",
    pageId: "",
    instagramActorId: null,
    pixelId: null,
    leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
    privacyPolicyUrl: "",
    currency: "AUD",
    timezone: "Australia/Perth",
  };
}

function MetaSetupForm({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [setup, setSetup] = useState<MetaSetup>(() => emptyMetaSetup());
  const [assets, setAssets] = useState<MetaAssetCatalog | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/integrations/meta/setup?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((res) => res.json().catch(() => ({})) as Promise<MetaSetupResponse>)
      .then((data) => {
        if (!active) return;
        if (data.setup) setSetup(normalizeMetaSetupForForm(data.setup));
        setAssets(data.assets ?? null);
        setAssetsError(data.assetsError ?? null);
        setBlockers(data.blockers ?? []);
        setMessage(data.error ? { tone: "error", text: data.error } : null);
      })
      .catch(() => {
        if (active) setMessage({ tone: "error", text: "Couldn't load Meta setup." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  function updateSetup(patch: Partial<MetaSetup>) {
    setSetup((prev) => ({ ...prev, ...patch }));
  }

  function updateLeadDestination(patch: Partial<MetaSetup["leadDestination"]>) {
    setSetup((prev) => ({
      ...prev,
      leadDestination: {
        ...prev.leadDestination,
        ...patch,
        config: {
          ...(prev.leadDestination.config ?? {}),
          ...(patch.config ?? {}),
        },
      },
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/integrations/meta/setup?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, setup }),
      });
      const data = (await res.json().catch(() => ({}))) as MetaSetupResponse;
      setBusy(false);
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Couldn't save Meta setup." });
        return;
      }
      if (data.setup) setSetup(normalizeMetaSetupForForm(data.setup));
      setBlockers(data.blockers ?? []);
      setMessage({
        tone: data.ready ? "success" : "error",
        text: data.ready ? "Meta publishing setup is complete." : "Meta setup saved. Complete the missing requirements below.",
      });
    } catch {
      setBusy(false);
      setMessage({ tone: "error", text: "Couldn't save Meta setup." });
    }
  }

  const availableInstagramActors = assets?.instagramActors.filter((actor) => !actor.pageId || actor.pageId === setup.pageId) ?? [];
  const timezoneOptions = setup.timezone && !TIMEZONE_OPTIONS.includes(setup.timezone) ? [setup.timezone, ...TIMEZONE_OPTIONS] : TIMEZONE_OPTIONS;

  return (
    <form className="flex flex-col gap-4 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/40 p-4" onSubmit={save}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-medium">Meta publishing setup</strong>
          <span className="text-sm text-muted-foreground">Required assets for publishing Meta lead campaigns.</span>
        </div>
        <StatusPill tone={blockers.length === 0 ? "green" : "amber"}>{blockers.length === 0 ? "ready" : "missing setup"}</StatusPill>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading Meta assets.</p>
      ) : <>
      {assetsError ? (
        <p className="text-sm text-destructive">Couldn't load your Meta assets ({assetsError}). Reconnect Meta, or enter the IDs manually below.</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="meta-meta-ad-account">Meta ad account</Label>
          {assets?.adAccounts.length ? (
            <select id="meta-meta-ad-account"
              className={selectClass}
              value={setup.metaAdAccountId}
              onChange={(e) => {
                const account = assets.adAccounts.find((item) => item.id === e.target.value);
                updateSetup({
                  metaAdAccountId: e.target.value,
                  currency: account?.currency || setup.currency,
                  timezone: account?.timezone || setup.timezone,
                });
              }}
              disabled={!canManage}
              required
            >
              <option value="">Choose an ad account</option>
              {assets.adAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name} ({account.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-meta-ad-account" value={setup.metaAdAccountId} onChange={(e) => updateSetup({ metaAdAccountId: e.target.value })} disabled={!canManage} required />
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-meta-page">Meta Page</Label>
          {assets?.pages.length ? (
            <select id="meta-meta-page" className={selectClass} value={setup.pageId} onChange={(e) => updateSetup({ pageId: e.target.value, instagramActorId: null })} disabled={!canManage} required>
              <option value="">Choose a Page</option>
              {assets.pages.map((page) => (
                <option key={page.id} value={page.id}>{page.name} ({page.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-meta-page" value={setup.pageId} onChange={(e) => updateSetup({ pageId: e.target.value })} disabled={!canManage} required />
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-instagram-account-optional">Instagram account (optional)</Label>
          {availableInstagramActors.length ? (
            <select id="meta-instagram-account-optional" className={selectClass} value={setup.instagramActorId ?? ""} onChange={(e) => updateSetup({ instagramActorId: e.target.value || null })} disabled={!canManage}>
              <option value="">None</option>
              {availableInstagramActors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.username} ({actor.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-instagram-account-optional" value={setup.instagramActorId ?? ""} onChange={(e) => updateSetup({ instagramActorId: e.target.value || null })} disabled={!canManage} />
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-pixel">Pixel</Label>
          {assets?.pixels.length ? (
            <select id="meta-pixel" className={selectClass} value={setup.pixelId ?? ""} onChange={(e) => updateSetup({ pixelId: e.target.value || null })} disabled={!canManage}>
              <option value="">None</option>
              {assets.pixels.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>{pixel.name} ({pixel.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-pixel" value={setup.pixelId ?? ""} onChange={(e) => updateSetup({ pixelId: e.target.value || null })} disabled={!canManage} />
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="meta-lead-destination-type">Lead destination type</Label>
          <select id="meta-lead-destination-type" className={selectClass} value={setup.leadDestination.type} onChange={(e) => updateLeadDestination({ type: e.target.value as MetaLeadDestinationType })} disabled={!canManage}>
            {META_LEAD_DESTINATION_TYPES.map((type) => (
              <option key={type} value={type}>{formatLeadDestinationType(type)}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-lead-destination-label">Lead destination label</Label>
          <Input id="meta-lead-destination-label" value={setup.leadDestination.label} onChange={(e) => updateLeadDestination({ label: e.target.value })} disabled={!canManage} required />
        </div>
      </div>

      {setup.leadDestination.type !== "manual" ? (
        <div className="grid gap-2">
          <Label htmlFor="meta-lead-destination-endpoint">Lead destination endpoint</Label>
          <Input id="meta-lead-destination-endpoint"
            value={setup.leadDestination.config?.endpoint ?? ""}
            onChange={(e) => updateLeadDestination({ config: { endpoint: e.target.value } })}
            placeholder="https://example.com/meta-leads"
            disabled={!canManage}
            required
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="meta-privacy-policy-url">Privacy policy URL</Label>
          <Input id="meta-privacy-policy-url" type="url" value={setup.privacyPolicyUrl} onChange={(e) => updateSetup({ privacyPolicyUrl: e.target.value })} disabled={!canManage} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-currency">Currency</Label>
          <select id="meta-currency" className={selectClass} value={setup.currency} onChange={(e) => updateSetup({ currency: e.target.value })} disabled={!canManage} required>
            <option value="">Select currency</option>
            {Object.values(REGION_CURRENCY).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-timezone">Timezone</Label>
          <select id="meta-timezone" className={selectClass} value={setup.timezone} onChange={(e) => updateSetup({ timezone: e.target.value })} disabled={!canManage} required>
            {setup.timezone ? null : <option value="">Select timezone</option>}
            {timezoneOptions.map((timezone) => (
              <option key={timezone} value={timezone}>{timezone.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {blockers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {blockers.map((blocker) => (
            <p className="text-sm text-destructive" key={blocker}>{blocker}</p>
          ))}
        </div>
      ) : null}
      <Feedback message={message} />
      <div>
        <Button type="submit" disabled={!canManage || busy || loading}>
          {busy ? "Saving" : "Save Meta setup"}
        </Button>
      </div>
      </>}
    </form>
  );
}

function normalizeMetaSetupForForm(setup: MetaSetup): MetaSetup {
  return {
    ...setup,
    leadDestination: {
      ...setup.leadDestination,
      type: normalizeLeadDestinationType(setup.leadDestination.type),
    },
  };
}

function normalizeLeadDestinationType(type: string): MetaLeadDestinationType {
  return type === "crm" || type === "manual" ? type : "webhook";
}

function formatLeadDestinationType(type: MetaLeadDestinationType): string {
  if (type === "crm") return "CRM";
  if (type === "webhook") return "Webhook";
  return "Manual review";
}
