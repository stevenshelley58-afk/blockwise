"use client";

import { useEffect, useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { logCaught } from "@/lib/log";

import { Feedback, REGION_CURRENCY, Section, type Connection, type Msg, type RT, type SB } from "./settings-shared";

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
  error?: string;
};

const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType[] = ["manual", "webhook", "crm"];

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

  const providers: Array<{ key: string; label: string; connectHref: string; enabled: boolean }> = [
    { key: "meta", label: "Meta (Facebook & Instagram)", connectHref: metaConnectHref, enabled: true },
    { key: "google", label: "Google Ads", connectHref: googleConnectHref, enabled: googleAdsEnabled },
  ];

  async function disconnect(provider: string, label: string) {
    setBusyProvider(provider);
    setMessage(null);
    if (provider === "meta") {
      // Use the server-side route so the Meta app grant is also revoked.
      const res = await fetch("/api/integrations/meta/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      setBusyProvider(null);
      if (!res.ok) {
        const data = (await res.json().catch(logCaught("settings: meta disconnect response parse failed", {}))) as { error?: string };
        setMessage({ tone: "error", text: data.error ?? `Couldn't disconnect ${label}.` });
        return;
      }
    } else {
      const { error } = await supabase
        .from("provider_connections")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .eq("provider", provider);
      setBusyProvider(null);
      if (error) {
        setMessage({ tone: "error", text: `Couldn't disconnect ${label}.` });
        return;
      }
    }
    setMessage({ tone: "success", text: `${label} disconnected.` });
    router.refresh();
  }

  return (
    <Section id="connections" title="Ad & API connections" description="Connect the ad platforms Blockwise reads and publishes through.">
      {providers.map((prov) => {
        const conn = connections.find((c) => c.provider === prov.key);
        const connected = conn && conn.status !== "revoked" && conn.status !== "not_connected";
        return (
          <div className="stack" key={prov.key} style={{ gap: 10 }}>
            <div className="wizard-connect-row">
              <div>
              <strong>{prov.label}</strong>
              <div className="item-meta">
                {conn?.accountName ? `${conn.accountName} · ` : ""}
                {conn ? <StatusPill tone={statusTone(conn.status)}>{STATUS_LABELS[conn.status] ?? conn.status.replace(/_/g, " ")}</StatusPill> : <StatusPill tone="blue">Not connected</StatusPill>}
              </div>
              </div>
              {!prov.enabled ? (
              <button className="button secondary" type="button" disabled>
                Not enabled yet
              </button>
            ) : !canManage ? (
              <StatusPill tone="blue">Owner/admin only</StatusPill>
            ) : connected ? (
              <div style={{ display: "flex", gap: 8 }}>
                <a className="button secondary" href={prov.connectHref}>Reconnect</a>
                <button className="button secondary" type="button" onClick={() => disconnect(prov.key, prov.label)} disabled={busyProvider === prov.key}>
                  {busyProvider === prov.key ? "Working" : "Disconnect"}
                </button>
              </div>
            ) : (
              <a className="button" href={prov.connectHref}>Connect</a>
              )}
            </div>
            {prov.key === "meta" && connected ? (
              <MetaSetupForm workspaceId={workspaceId} canManage={canManage} />
            ) : null}
            {prov.key === "meta" && !connected ? (
              <p className="wizard-skip-note">Connect Meta first, then choose the ad account, Page, lead destination, and privacy policy used for publishing.</p>
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
  const [blockers, setBlockers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/integrations/meta/setup?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((res) => res.json().catch(logCaught("settings: meta setup response parse failed", {})) as Promise<MetaSetupResponse>)
      .then((data) => {
        if (!active) return;
        if (data.setup) setSetup(data.setup);
        setAssets(data.assets ?? null);
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
      const data = (await res.json().catch(logCaught("settings: meta setup save response parse failed", {}))) as MetaSetupResponse;
      setBusy(false);
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Couldn't save Meta setup." });
        return;
      }
      if (data.setup) setSetup(data.setup);
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

  const selectedAccount = assets?.adAccounts.find((account) => account.id === setup.metaAdAccountId);
  const availableInstagramActors = assets?.instagramActors.filter((actor) => !actor.pageId || actor.pageId === setup.pageId) ?? [];

  return (
    <form className="stack" onSubmit={save} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14 }}>
      <div className="wizard-connect-row" style={{ padding: 0, border: 0 }}>
        <span>
          <strong>Meta publishing setup</strong>
          <div className="item-meta">Required assets for paused Meta lead campaigns.</div>
        </span>
        <StatusPill tone={blockers.length === 0 ? "green" : "amber"}>{blockers.length === 0 ? "ready" : "missing setup"}</StatusPill>
      </div>

      {loading ? (
        <p className="wizard-skip-note">Loading Meta assets.</p>
      ) : <>
      <div className="grid cols-2">
        <label className="wizard-field">
          <span className="wizard-label">Meta ad account</span>
          {assets?.adAccounts.length ? (
            <select
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
            <input value={setup.metaAdAccountId} onChange={(e) => updateSetup({ metaAdAccountId: e.target.value })} disabled={!canManage} required />
          )}
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Meta Page</span>
          {assets?.pages.length ? (
            <select value={setup.pageId} onChange={(e) => updateSetup({ pageId: e.target.value, instagramActorId: null })} disabled={!canManage} required>
              <option value="">Choose a Page</option>
              {assets.pages.map((page) => (
                <option key={page.id} value={page.id}>{page.name} ({page.id})</option>
              ))}
            </select>
          ) : (
            <input value={setup.pageId} onChange={(e) => updateSetup({ pageId: e.target.value })} disabled={!canManage} required />
          )}
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Instagram account (optional)</span>
          {availableInstagramActors.length ? (
            <select value={setup.instagramActorId ?? ""} onChange={(e) => updateSetup({ instagramActorId: e.target.value || null })} disabled={!canManage}>
              <option value="">None</option>
              {availableInstagramActors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.username} ({actor.id})</option>
              ))}
            </select>
          ) : (
            <input value={setup.instagramActorId ?? ""} onChange={(e) => updateSetup({ instagramActorId: e.target.value || null })} disabled={!canManage} />
          )}
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Pixel</span>
          {assets?.pixels.length ? (
            <select value={setup.pixelId ?? ""} onChange={(e) => updateSetup({ pixelId: e.target.value || null })} disabled={!canManage}>
              <option value="">None</option>
              {assets.pixels.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>{pixel.name} ({pixel.id})</option>
              ))}
            </select>
          ) : (
            <input value={setup.pixelId ?? ""} onChange={(e) => updateSetup({ pixelId: e.target.value || null })} disabled={!canManage} />
          )}
        </label>
      </div>

      <div className="grid cols-2">
        <label className="wizard-field">
          <span className="wizard-label">Lead destination type</span>
          <select value={setup.leadDestination.type} onChange={(e) => updateLeadDestination({ type: e.target.value as MetaLeadDestinationType })} disabled={!canManage}>
            {META_LEAD_DESTINATION_TYPES.map((type) => (
              <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Lead destination label</span>
          <input value={setup.leadDestination.label} onChange={(e) => updateLeadDestination({ label: e.target.value })} disabled={!canManage} required />
        </label>
      </div>

      {setup.leadDestination.type !== "manual" ? (
        <label className="wizard-field">
          <span className="wizard-label">Lead destination endpoint</span>
          <input
            value={setup.leadDestination.config?.endpoint ?? ""}
            onChange={(e) => updateLeadDestination({ config: { endpoint: e.target.value } })}
            placeholder="https://example.com/meta-leads"
            disabled={!canManage}
            required
          />
        </label>
      ) : null}

      <div className="grid cols-3">
        <label className="wizard-field">
          <span className="wizard-label">Privacy policy URL</span>
          <input type="url" value={setup.privacyPolicyUrl} onChange={(e) => updateSetup({ privacyPolicyUrl: e.target.value })} disabled={!canManage} required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Currency</span>
          <select value={setup.currency} onChange={(e) => updateSetup({ currency: e.target.value })} disabled={!canManage} required>
            <option value="">Select currency</option>
            {Object.values(REGION_CURRENCY).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Timezone</span>
          <input value={setup.timezone} onChange={(e) => updateSetup({ timezone: e.target.value })} placeholder={selectedAccount?.timezone ?? "Australia/Perth"} disabled={!canManage} required />
        </label>
      </div>

      {blockers.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          {blockers.map((blocker) => (
            <p className="wizard-status error" key={blocker}>{blocker}</p>
          ))}
        </div>
      ) : null}
      <Feedback message={message} />
      <div className="wizard-actions">
        <button className="button" type="submit" disabled={!canManage || busy || loading}>
          {busy ? "Saving" : "Save Meta setup"}
        </button>
      </div>
      </>}
    </form>
  );
}
