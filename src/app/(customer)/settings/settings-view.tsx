"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const REGION_CURRENCY: Record<string, string> = { AU: "AUD", NZ: "NZD", GB: "GBP", US: "USD", CA: "CAD" };

const REGION_NAMES: Record<string, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
};

type Msg = { tone: "success" | "error"; text: string } | null;

type Connection = {
  id: string;
  provider: string;
  status: string;
  accountName: string | null;
  healthStatus: string;
  lastSyncAt: string | null;
};

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

type Member = {
  profileId: string;
  role: string;
  fullName: string | null;
  email: string | null;
  isOperator: boolean;
};

type Plan = {
  name: string;
  key: string;
  monthlyAiBudgetCents: number;
  maxWorkspaces: number;
  maxAgentRunsPerMonth: number;
} | null;

type SettingsViewProps = {
  user: { id: string; email: string };
  profile: { fullName: string; notificationPreferences: Record<string, boolean> };
  workspace: {
    id: string;
    name: string;
    region: string;
    approvalRequiredByDefault: boolean;
    billingEmail: string;
    stripeCustomerId: string | null;
    subscriptionStatus: string | null;
  };
  plan: Plan;
  connections: Connection[];
  members: Member[];
  role: string;
  isOperator: boolean;
  canManage: boolean;
  googleAdsEnabled: boolean;
  metaConnectHref: string;
  googleConnectHref: string;
};

const NOTIFICATION_OPTIONS: Array<{ key: string; label: string; description: string; fallback: boolean }> = [
  { key: "approvalRequests", label: "Approval requests", description: "When something needs review before publishing.", fallback: true },
  { key: "leadAlerts", label: "New leads", description: "When a new lead arrives from Meta or Google.", fallback: true },
  { key: "weeklyDigest", label: "Weekly digest", description: "A weekly summary of spend, leads, and results.", fallback: false },
  { key: "productUpdates", label: "Product updates", description: "Occasional news about new Blockwise features.", fallback: false },
];

const ASSIGNABLE_ROLES = ["owner", "admin", "member", "viewer"];
const META_LEAD_DESTINATION_TYPES: MetaLeadDestinationType[] = ["manual", "webhook", "crm"];

function Feedback({ message }: { message: Msg }) {
  if (!message) return null;
  return <p className={`wizard-status ${message.tone}`}>{message.text}</p>;
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="panel" id={id} style={{ scrollMarginTop: 84 }}>
      <h2>{title}</h2>
      {description ? <p className="item-meta">{description}</p> : null}
      <div className="stack" style={{ marginTop: 14 }}>
        {children}
      </div>
    </section>
  );
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents / 100);
}

function planFeatureTitle(plan: NonNullable<Plan>): string {
  if (plan.key === "trial" || plan.maxAgentRunsPerMonth <= 0) {
    return "10 free ad packs included";
  }

  return `Up to ${plan.maxAgentRunsPerMonth} agent runs / mo`;
}

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

export function SettingsView(props: SettingsViewProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const navItems: Array<{ href: string; label: string }> = [
    { href: "#account", label: "Account" },
    { href: "#connections", label: "Connections" },
    { href: "#security", label: "Password" },
    { href: "#billing", label: "Billing" },
    ...(props.canManage ? [{ href: "#workspace", label: "Workspace" }, { href: "#team", label: "Team" }] : []),
    { href: "#notifications", label: "Notifications" },
    { href: "#danger", label: "Danger zone" },
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <nav aria-label="Settings sections" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {navItems.map((item) => (
          <a key={item.href} className="button secondary" href={item.href} style={{ padding: "6px 12px", fontSize: 13 }}>
            {item.label}
          </a>
        ))}
      </nav>

      <AccountSection supabase={supabase} router={router} user={props.user} fullName={props.profile.fullName} />
      <ConnectionsSection
        supabase={supabase}
        router={router}
        canManage={props.canManage}
        workspaceId={props.workspace.id}
        connections={props.connections}
        googleAdsEnabled={props.googleAdsEnabled}
        metaConnectHref={props.metaConnectHref}
        googleConnectHref={props.googleConnectHref}
      />
      <PasswordSection supabase={supabase} />
      <BillingSection
        supabase={supabase}
        router={router}
        canManage={props.canManage}
        workspace={props.workspace}
        plan={props.plan}
      />
      {props.canManage ? (
        <WorkspaceSection supabase={supabase} router={router} workspace={props.workspace} />
      ) : null}
      {props.canManage ? (
        <TeamSection
          supabase={supabase}
          router={router}
          workspaceId={props.workspace.id}
          currentUserId={props.user.id}
          members={props.members}
        />
      ) : null}
      <NotificationsSection supabase={supabase} userId={props.user.id} initial={props.profile.notificationPreferences} />
      <DangerSection supabase={supabase} router={router} workspaceId={props.workspace.id} />
    </div>
  );
}

type SB = ReturnType<typeof createSupabaseBrowserClient>;
type RT = ReturnType<typeof useRouter>;

function AccountSection({ supabase, router, user, fullName }: { supabase: SB; router: RT; user: { id: string; email: string }; fullName: string }) {
  const [name, setName] = useState(fullName);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), updated_at: new Date().toISOString() }).eq("id", user.id);
    let emailMsg = "";
    if (!error && email.trim() && email.trim() !== user.email) {
      const { error: emailError } = await supabase.auth.updateUser({ email: email.trim() });
      emailMsg = emailError ? ` Name saved, but email change failed: ${emailError.message}` : " Check your new inbox to confirm the email change.";
    }
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't save your account details." });
      return;
    }
    setMessage({ tone: "success", text: `Account updated.${emailMsg}` });
    router.refresh();
  }

  return (
    <Section id="account" title="Account" description="Your name and sign-in email.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save changes"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function PasswordSection({ supabase }: { supabase: SB }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (pw.length < 8) {
      setMessage({ tone: "error", text: "Use at least 8 characters." });
      return;
    }
    if (pw !== confirm) {
      setMessage({ tone: "error", text: "Passwords don't match." });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: error.message });
      return;
    }
    setPw("");
    setConfirm("");
    setMessage({ tone: "success", text: "Password updated." });
  }

  return (
    <Section id="security" title="Password" description="Change the password for this account.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">New password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Confirm new password</span>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Updating" : "Update password"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function BillingSection({
  supabase,
  router,
  canManage,
  workspace,
  plan,
}: {
  supabase: SB;
  router: RT;
  canManage: boolean;
  workspace: SettingsViewProps["workspace"];
  plan: Plan;
}) {
  const [billingEmail, setBillingEmail] = useState(workspace.billingEmail);
  const [busy, setBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);

  async function saveBillingEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await supabase
      .from("workspaces")
      .update({ billing_email: billingEmail.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", workspace.id);
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't save the billing email." });
      return;
    }
    setMessage({ tone: "success", text: "Billing email saved." });
    router.refresh();
  }

  async function openPortal() {
    setPortalBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: workspace.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage({ tone: "error", text: data.message ?? data.error ?? "Billing isn't connected yet." });
    } catch {
      setMessage({ tone: "error", text: "Couldn't open billing right now." });
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <Section id="billing" title="Billing & plan" description="Your subscription, payment method, and invoices.">
      <div className="grid cols-3">
        <div className="item-card">
          <span className="item-meta">Current plan</span>
          <h3 style={{ margin: "4px 0" }}>{plan?.name ?? "No plan"}</h3>
          <StatusPill tone={workspace.subscriptionStatus === "active" ? "green" : "blue"}>
            {workspace.subscriptionStatus ?? "Trial / unbilled"}
          </StatusPill>
        </div>
        <div className="item-card">
          <span className="item-meta">Plan features</span>
          <h3 style={{ margin: "4px 0" }}>{plan ? planFeatureTitle(plan) : "—"}</h3>
          <span className="item-meta">{plan ? `Up to ${plan.maxWorkspaces} workspace${plan.maxWorkspaces === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div className="item-card">
          <span className="item-meta">Payment method</span>
          <h3 style={{ margin: "4px 0" }}>{workspace.stripeCustomerId ? "Card on file" : "No card on file"}</h3>
          <span className="item-meta">Invoices appear here once billing is connected.</span>
        </div>
      </div>

      {canManage ? (
        <>
          {workspace.stripeCustomerId ? (
            <div className="wizard-connect-row">
              <span>Manage payment method & invoices</span>
              <button className="button" type="button" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? "Opening" : "Manage billing"}
              </button>
            </div>
          ) : (
            <p className="wizard-skip-note">Billing management will appear here after your first paid plan is active.</p>
          )}
          <form className="stack" onSubmit={saveBillingEmail}>
            <label className="wizard-field">
              <span className="wizard-label">Billing email</span>
              <input type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="accounts@yourcompany.com" />
            </label>
            <div className="wizard-actions">
              <button className="button secondary" type="submit" disabled={busy}>
                {busy ? "Saving" : "Save billing email"}
              </button>
            </div>
          </form>
          <div className="stack" style={{ gap: "4px" }}>
            <h4 style={{ margin: 0 }}>Upgrade your plan</h4>
            <p className="wizard-skip-note" style={{ margin: 0 }}>
              Want early access to a paid plan? Email us at{" "}
              <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a> and we&apos;ll get you set up.
            </p>
          </div>
        </>
      ) : (
        <p className="wizard-skip-note">Only an owner or admin can manage billing.</p>
      )}
      <Feedback message={message} />
    </Section>
  );
}

function ConnectionsSection({
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
        const data = (await res.json().catch(() => ({}))) as { error?: string };
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
      .then((res) => res.json().catch(() => ({})) as Promise<MetaSetupResponse>)
      .then((data) => {
        if (!active) return;
        if (data.setup) setSetup(normalizeMetaSetupForForm(data.setup));
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
              <option key={type} value={type}>{formatLeadDestinationType(type)}</option>
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

function WorkspaceSection({ supabase, router, workspace }: { supabase: SB; router: RT; workspace: SettingsViewProps["workspace"] }) {
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
    <Section id="workspace" title="Workspace" description="Settings for this workspace.">
      <form className="stack" onSubmit={save}>
        <label className="wizard-field">
          <span className="wizard-label">Workspace name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="wizard-field">
          <span className="wizard-label">Region</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} required>
            {Object.keys(REGION_CURRENCY).map((r) => (
              <option key={r} value={r}>{REGION_NAMES[r] ?? r}</option>
            ))}
          </select>
        </label>
        <div className="wizard-connect-row">
          <span>
            <strong>Publishing review</strong>
            <div className="item-meta">All campaigns are reviewed before going live during early access.</div>
          </span>
        </div>
        <Feedback message={message} />
        <div className="wizard-actions">
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Saving" : "Save workspace"}
          </button>
        </div>
      </form>
    </Section>
  );
}

function TeamSection({
  supabase,
  router,
  workspaceId,
  currentUserId,
  members,
}: {
  supabase: SB;
  router: RT;
  workspaceId: string;
  currentUserId: string;
  members: Member[];
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Msg>(null);

  async function changeRole(profileId: string, role: string) {
    setRowBusy(profileId);
    setMessage(null);
    const { error } = await supabase.from("workspace_members").update({ role }).eq("workspace_id", workspaceId).eq("profile_id", profileId);
    setRowBusy(null);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't update that member's role." });
      return;
    }
    router.refresh();
  }

  async function remove(profileId: string) {
    setRowBusy(profileId);
    setMessage(null);
    const { error } = await supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("profile_id", profileId);
    setRowBusy(null);
    if (error) {
      setMessage({ tone: "error", text: "Couldn't remove that member." });
      return;
    }
    setMessage({ tone: "success", text: "Member removed." });
    router.refresh();
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setBusy(false);
      if (!res.ok) {
        setMessage({ tone: "error", text: data.error ?? "Couldn't send that invite." });
        return;
      }
      setInviteEmail("");
      setMessage({ tone: "success", text: data.message ?? "Invitation sent." });
      router.refresh();
    } catch {
      setBusy(false);
      setMessage({ tone: "error", text: "Couldn't send that invite." });
    }
  }

  return (
    <Section id="team" title="Team members" description="People with access to this workspace.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.profileId === currentUserId;
              return (
                <tr key={m.profileId}>
                  <td>
                    <strong>{m.fullName ?? m.email ?? "Unknown"}</strong>
                    {isSelf ? <span className="item-meta"> (you)</span> : null}
                    <div className="item-meta">{m.email}</div>
                  </td>
                  <td>
                    {m.isOperator ? (
                      <StatusPill tone="blue">operator</StatusPill>
                    ) : isSelf ? (
                      <StatusPill tone="green">{m.role}</StatusPill>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.profileId, e.target.value)}
                        disabled={rowBusy === m.profileId}
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!isSelf && !m.isOperator ? (
                      <button className="button secondary" type="button" onClick={() => remove(m.profileId)} disabled={rowBusy === m.profileId}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="wizard-connect-row" onSubmit={invite} style={{ flexWrap: "wrap", gap: 10 }}>
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="teammate@email.com"
          required
          style={{ flex: "1 1 220px" }}
        />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          {ASSIGNABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Inviting" : "Invite"}
        </button>
      </form>
      <Feedback message={message} />
    </Section>
  );
}

function NotificationsSection({ supabase, userId, initial }: { supabase: SB; userId: string; initial: Record<string, boolean> }) {
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

function DangerSection({ supabase, router, workspaceId }: { supabase: SB; router: RT; workspaceId: string }) {
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
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
