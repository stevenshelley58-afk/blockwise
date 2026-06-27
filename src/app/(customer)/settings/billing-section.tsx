"use client";

import { useState, type FormEvent } from "react";

import { StatusPill } from "@/components/status-pill";
import { logCaught } from "@/lib/log";

import { Feedback, Section, type Msg, type Plan, type RT, type SB, type SettingsViewProps } from "./settings-shared";

function planFeatureTitle(plan: NonNullable<Plan>): string {
  if (plan.key === "trial" || plan.maxAgentRunsPerMonth <= 0) {
    return "10 free ad packs included";
  }

  return `Up to ${plan.maxAgentRunsPerMonth} agent runs / mo`;
}

export function BillingSection({
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
      const data = (await res.json().catch(logCaught("settings: billing portal response parse failed", {}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage({ tone: "error", text: data.error ?? "Billing isn't connected yet." });
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
          <div className="wizard-connect-row">
            <span>Manage payment method & invoices</span>
            <button className="button" type="button" onClick={openPortal} disabled={portalBusy}>
              {portalBusy ? "Opening" : "Manage billing"}
            </button>
          </div>
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
