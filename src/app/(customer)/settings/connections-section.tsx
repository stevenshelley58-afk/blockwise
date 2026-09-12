"use client";

import { useEffect, useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import { Feedback, REGION_CURRENCY, Section, selectClass, type Connection, type Msg, type RT } from "./settings-shared";

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

const META_PROVIDER_LABEL = "Meta (Facebook & Instagram)";

export function ConnectionsSection({
  router,
  canManage,
  workspaceId,
  connections,
  metaConnectHref,
}: {
  router: RT;
  canManage: boolean;
  workspaceId: string;
  connections: Connection[];
  metaConnectHref: string;
}) {
  const [message, setMessage] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const conn = connections.find((c) => c.provider === "meta");
  const connected = conn && conn.status !== "revoked" && conn.status !== "not_connected";

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      // Use the server-side route so the Meta app grant is also revoked.
      const res = await fetch("/api/integrations/meta/disconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Couldn't disconnect ${META_PROVIDER_LABEL}.`);
      }
      setMessage({ tone: "success", text: `${META_PROVIDER_LABEL} disconnected.` });
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : `Couldn't disconnect ${META_PROVIDER_LABEL}.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="connections" title={niche.copy.settings.sections.connections}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <strong className="text-sm font-medium">{META_PROVIDER_LABEL}</strong>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {conn?.accountName ? <span>{conn.accountName} ·</span> : null}
              {conn ? <StatusPill tone={statusTone(conn.status)}>{STATUS_LABELS[conn.status] ?? conn.status.replace(/_/g, " ")}</StatusPill> : null}
            </div>
          </div>
          {!canManage ? (
            <Button variant="outline" type="button" disabled>
              Owner or admin connects this
            </Button>
          ) : connected ? (
            <Button variant="outline" type="button" onClick={disconnect} disabled={busy}>
              {busy ? "Working" : "Disconnect"}
            </Button>
          ) : (
            <Button asChild>
              <a href={metaConnectHref}>Connect your Meta account</a>
            </Button>
          )}
        </div>
        {/* Nothing is configured until an account is connected, so the
            empty state stays one button and one line instead of a form
            full of fields that cannot be saved yet. */}
        {connected && canManage ? <MetaSetupForm workspaceId={workspaceId} canManage={canManage} /> : null}
        {connected && !canManage ? (
          <p className="text-sm text-muted-foreground">An owner or admin can view and change Meta publishing assets.</p>
        ) : null}
        {!connected ? (
          <p className="text-sm text-muted-foreground">Connect to publish lead ads from your own ad account and Facebook Page.</p>
        ) : null}
      </div>
      <Feedback message={message} />
    </Section>
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

function emptyMetaSetup(): MetaSetup {
  // No invented currency or timezone: both are read from the ad account the
  // owner picks, and Meta re-checks them live at publish time. A blank value
  // shows as an empty field instead of a wrong one.
  return {
    metaAdAccountId: "",
    pageId: "",
    instagramActorId: null,
    pixelId: null,
    leadDestination: { type: "manual", label: "Manual review", config: { endpoint: "" } },
    privacyPolicyUrl: "",
    currency: "",
    timezone: "",
  };
}

function MetaSetupForm({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [setup, setSetup] = useState<MetaSetup>(() => emptyMetaSetup());
  const [assets, setAssets] = useState<MetaAssetCatalog | null>(null);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  // Each picker saves itself. The snapshot holds what the server last
  // confirmed, so switching three dropdowns in a row does not replay the first
  // change three times.
  const [savedSetup, setSavedSetup] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/integrations/meta/setup?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((res) => res.json().catch(() => ({})) as Promise<MetaSetupResponse>)
      .then((data) => {
        if (!active) return;
        const next = data.setup ? normalizeMetaSetupForForm(data.setup) : emptyMetaSetup();
        setSetup(next);
        setSavedSetup(JSON.stringify(next));
        setAssets(data.assets ?? null);
        setAssetsError(data.assetsError ?? null);
        setBlockers(data.blockers ?? []);
        setMessage(data.error ? { tone: "error", text: data.error } : null);
      })
      .catch(() => {
        if (active) setMessage({ tone: "error", text: "Couldn't load your Meta assets." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Selecting an ad account or Page is the whole interaction: the asset list
  // comes from Meta, so there is nothing to type and nothing to save by hand.
  useEffect(() => {
    if (loading || !canManage || savedSetup === null) return;
    const snapshot = JSON.stringify(setup);
    if (snapshot === savedSetup) return;

    let active = true;
    setSaving(true);
    setMessage(null);
    fetch(`/api/integrations/meta/setup?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, setup }),
    })
      .then(async (res) => ({ res, data: (await res.json().catch(() => ({}))) as MetaSetupResponse }))
      .then(({ res, data }) => {
        if (!active) return;
        if (!res.ok) {
          setMessage({ tone: "error", text: data.error ?? "Couldn't save that choice. Try again." });
          return;
        }
        const confirmed = data.setup ? normalizeMetaSetupForForm(data.setup) : setup;
        setSetup(confirmed);
        setSavedSetup(JSON.stringify(confirmed));
        setBlockers(data.blockers ?? []);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      })
      .catch(() => {
        if (active) setMessage({ tone: "error", text: "Couldn't save that choice. Check your connection and try again." });
      })
      .finally(() => {
        if (active) setSaving(false);
      });

    return () => {
      active = false;
    };
  }, [setup, savedSetup, loading, canManage, workspaceId]);

  const availableInstagramActors = assets?.instagramActors.filter((actor) => !actor.pageId || actor.pageId === setup.pageId) ?? [];

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading your Meta assets…</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-(--r-card) border border-(--line) bg-(--surface-subtle)/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <strong className="text-sm font-medium">Publishing assets</strong>
          <span className="text-sm text-muted-foreground">Pulled directly from Meta. Nothing to type.</span>
        </div>
        {blockers.length > 0 || saving || saved ? (
          <div className="flex items-center gap-2">
            {saving ? <span className="text-xs text-muted-foreground" aria-live="polite">Saving…</span> : null}
            {saved && !saving ? <span className="text-xs text-muted-foreground" aria-live="polite">Saved</span> : null}
            {blockers.length > 0 ? <StatusPill tone="amber">missing setup</StatusPill> : null}
          </div>
        ) : null}
      </div>

      {assetsError ? (
        <p className="text-sm text-destructive">Couldn't load your Meta assets ({assetsError}). Reconnect Meta, or ask an operator to check the shared assets.</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="meta-meta-ad-account">Ad account</Label>
          {assets?.adAccounts.length ? (
            <select id="meta-meta-ad-account"
              className={selectClass}
              value={setup.metaAdAccountId}
              onChange={(e) => {
                const account = assets.adAccounts.find((item) => item.id === e.target.value);
                setSetup((prev) => ({
                  ...prev,
                  metaAdAccountId: e.target.value,
                  currency: account?.currency || prev.currency,
                  timezone: account?.timezone || prev.timezone,
                }));
              }}
              disabled={!canManage}
            >
              <option value="">Choose an ad account</option>
              {assets.adAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name} ({account.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-meta-ad-account" value={setup.metaAdAccountId} onChange={(e) => setSetup((prev) => ({ ...prev, metaAdAccountId: e.target.value }))} disabled={!canManage} />
          )}
          {assets?.adAccounts.length === 1 ? (
            <p className="text-xs text-muted-foreground">This is the only ad account you shared, so it is already selected.</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-meta-page">Facebook Page</Label>
          {assets?.pages.length ? (
            <select id="meta-meta-page" className={selectClass} value={setup.pageId} onChange={(e) => setSetup((prev) => ({ ...prev, pageId: e.target.value, instagramActorId: null }))} disabled={!canManage}>
              <option value="">Choose a Page</option>
              {assets.pages.map((page) => (
                <option key={page.id} value={page.id}>{page.name} ({page.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-meta-page" value={setup.pageId} onChange={(e) => setSetup((prev) => ({ ...prev, pageId: e.target.value }))} disabled={!canManage} />
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-instagram-account-optional">Instagram account (optional)</Label>
          {availableInstagramActors.length ? (
            <select id="meta-instagram-account-optional" className={selectClass} value={setup.instagramActorId ?? ""} onChange={(e) => setSetup((prev) => ({ ...prev, instagramActorId: e.target.value || null }))} disabled={!canManage}>
              <option value="">None</option>
              {availableInstagramActors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.username} ({actor.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-instagram-account-optional" value={setup.instagramActorId ?? ""} onChange={(e) => setSetup((prev) => ({ ...prev, instagramActorId: e.target.value || null }))} disabled={!canManage} />
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="meta-pixel">Pixel (optional)</Label>
          {assets?.pixels.length ? (
            <select id="meta-pixel" className={selectClass} value={setup.pixelId ?? ""} onChange={(e) => setSetup((prev) => ({ ...prev, pixelId: e.target.value || null }))} disabled={!canManage}>
              <option value="">None</option>
              {assets.pixels.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>{pixel.name} ({pixel.id})</option>
              ))}
            </select>
          ) : (
            <Input id="meta-pixel" value={setup.pixelId ?? ""} onChange={(e) => setSetup((prev) => ({ ...prev, pixelId: e.target.value || null }))} disabled={!canManage} />
          )}
        </div>
      </div>

      {blockers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {blockers.map((blocker) => (
            <p className="text-sm text-destructive" key={blocker}>{blocker}</p>
          ))}
        </div>
      ) : null}
      {/* Privacy policy, currency, timezone and the lead destination live on the
          Workspace card; currency and timezone follow the ad account picked here. */}
      <p className="text-xs text-muted-foreground">
        Lead handling and the privacy policy live in Workspace settings.
      </p>
      <Feedback message={message} />
    </div>
  );
}

