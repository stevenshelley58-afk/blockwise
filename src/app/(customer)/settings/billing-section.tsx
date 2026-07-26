"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type Plan, type RT, type SB, type SettingsViewProps } from "./settings-shared";

function planFeatureTitle(plan: NonNullable<Plan>): string {
  if (plan.key === "trial" || plan.maxAgentRunsPerMonth <= 0) {
    return "10 free ad packs included";
  }

  return `Up to ${plan.maxAgentRunsPerMonth} agent runs / mo`;
}

function PlanTile({ label, value, foot }: { label: string; value: string; foot?: ReactNode }) {
  return (
    <article className="rounded-(--r-card) border border-(--line) bg-(--surface) px-[18px] pt-[17px] pb-[15px] shadow-card">
      <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{label}</p>
      <p className="mt-[6px] font-display text-[18px] font-extrabold tracking-[-0.02em]">{value}</p>
      {foot ? <div className="mt-[7px] text-[10.5px]/[11.5px] text-muted-foreground">{foot}</div> : null}
    </article>
  );
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
    <Section id="billing" title={niche.copy.settings.sections.billing}>
      <div className="grid gap-3.5 sm:grid-cols-3">
        <PlanTile
          label="Current plan"
          value={plan?.name ?? "No plan"}
          foot={
            <StatusPill tone={workspace.subscriptionStatus === "active" ? "green" : "blue"}>
              {workspace.subscriptionStatus ?? "Trial / unbilled"}
            </StatusPill>
          }
        />
        <PlanTile
          label="Plan features"
          value={plan ? planFeatureTitle(plan) : "—"}
          foot={plan ? `Up to ${plan.maxWorkspaces} workspace${plan.maxWorkspaces === 1 ? "" : "s"}` : ""}
        />
        <PlanTile
          label="Payment method"
          value={workspace.stripeCustomerId ? "Card on file" : "No card on file"}
          foot="Invoices appear here once billing is connected."
        />
      </div>

      {canManage ? (
        <>
          {workspace.stripeCustomerId ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-sm font-medium">Manage payment method & invoices</span>
              <Button type="button" onClick={openPortal} disabled={portalBusy}>
                {portalBusy ? "Opening" : "Manage billing"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Billing management will appear here after your first paid plan is active.</p>
          )}
          <form className="grid gap-4" onSubmit={saveBillingEmail}>
            <div className="grid gap-2">
              <Label htmlFor="billing-email">Billing email</Label>
              <Input id="billing-email" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="accounts@yourcompany.com" />
            </div>
            <div>
              <Button variant="outline" type="submit" disabled={busy}>
                {busy ? "Saving" : "Save billing email"}
              </Button>
            </div>
          </form>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Upgrade your plan</h4>
            <p className="text-sm text-muted-foreground">
              Want early access to a paid plan? Email us at{" "}
              <a href="mailto:hello@blockwise.sale" className="underline">hello@blockwise.sale</a> and we&apos;ll get you set up.
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Only an owner or admin can manage billing.</p>
      )}
      <Feedback message={message} />
    </Section>
  );
}
