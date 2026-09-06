"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { niche } from "@/config/niche";

import { Feedback, Section, type Msg, type Plan, type RT, type SB, type SettingsViewProps } from "./settings-shared";

function PlanTile({ label, value, foot }: { label: string; value: string; foot?: ReactNode }) {
  return (
    // Flat-first: these tiles sit inside a Section card, so they use a tonal
    // layer rather than a nested border+shadow.
    <article className="rounded-(--r-card) bg-(--surface-subtle) px-[18px] pt-[17px] pb-[15px]">
      <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">{label}</p>
      <p className="mt-[6px] font-display text-[17px] font-extrabold tracking-[-0.02em]">{value}</p>
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
  usage,
  bookingState,
}: {
  supabase: SB;
  router: RT;
  canManage: boolean;
  workspace: SettingsViewProps["workspace"];
  plan: Plan;
  usage: SettingsViewProps["usage"];
  bookingState: SettingsViewProps["bookingState"];
}) {
  const [billingEmail, setBillingEmail] = useState(workspace.billingEmail);
  const [busy, setBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [message, setMessage] = useState<Msg>(null);
  const packEstimate = usage.remaining == null ? null : Math.floor(usage.remaining / 2);
  const currencyMark = workspace.currency === "USD" ? "US$" : "A$";

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

  async function startCheckout() {
    setCheckoutBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          product: "self_serve",
          clientMutationId: crypto.randomUUID(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setMessage({ tone: "error", text: data.error ?? "Couldn't start Checkout right now." });
    } catch {
      setMessage({ tone: "error", text: "Couldn't start Checkout right now." });
    } finally {
      setCheckoutBusy(false);
    }
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
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <PlanTile
          label="Current plan"
          value={workspace.billingAccessState === "paid" ? "Self-serve paid" : plan?.name ?? "Free trial"}
          foot={
            <span className="flex flex-col items-start gap-1.5">
              <StatusPill tone={workspace.billingAccessState === "paid" ? "green" : workspace.billingAccessState === "payment_recovery" ? "rose" : "blue"}>
                {trialFoot(workspace)}
              </StatusPill>
            </span>
          }
        />
        <PlanTile
          label="Render credits"
          value={usage.remaining == null ? "Not issued yet" : `${usage.remaining} remaining`}
          foot={packEstimate == null ? "Issued with your entitlement" : `Up to ${packEstimate} complete Feed + Story packs`}
        />
        <PlanTile
          label="Current invoice"
          value={
            workspace.latestInvoiceAmountPaid == null
              ? "No invoice yet"
              : formatMoney(workspace.latestInvoiceAmountPaid, workspace.currency)
          }
          foot={workspace.latestInvoiceStatus ?? "The first month is charged after your launch trigger."}
        />
        <PlanTile
          label={workspace.cancelAtPeriodEnd ? "Access ends" : "Next renewal"}
          value={workspace.billingPeriodEnd ? formatDate(workspace.billingPeriodEnd) : "Not scheduled"}
          foot={
            workspace.cancelAtPeriodEnd
              ? "Already-paid credits remain until this date."
              : `${currencyMark}249 each following month`
          }
        />
      </div>

      <div className="rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-bold">Usage this period</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {usage.granted == null
                ? "Credit usage will appear when the wallet is issued."
                : `${usage.granted} granted · ${usage.used} used · ${usage.reserved} reserved`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {usage.periodStart && usage.periodEnd
              ? `${formatDate(usage.periodStart)} – ${formatDate(usage.periodEnd)}`
              : "Billing period pending"}
          </p>
        </div>
        {usage.granted != null && usage.remaining != null ? (
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-data-track"
            role="progressbar"
            aria-label="Render credits remaining"
            aria-valuemin={0}
            aria-valuemax={usage.granted}
            aria-valuenow={usage.remaining}
          >
            <div
              className="h-full rounded-full bg-data"
              style={{ width: `${usage.granted > 0 ? Math.min(100, (usage.remaining / usage.granted) * 100) : 0}%` }}
            />
          </div>
        ) : null}
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Credits expire at period end and do not roll over or transfer. Failed or cancelled provider work is refunded automatically.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-card) border border-(--line) p-4">
        <div>
          <h3 className="text-[13px] font-bold">Onboarding call</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {bookingState === "completed"
              ? "Your onboarding call is complete."
              : bookingState === "booked"
                ? "Your onboarding call is booked. Use the provider link to reschedule."
                : "Book after Checkout, or use the hosted fallback if calendar sync is unavailable."}
          </p>
        </div>
        <StatusPill tone={bookingState === "completed" ? "green" : bookingState === "booked" ? "blue" : "amber"}>
          {bookingState.replaceAll("_", " ")}
        </StatusPill>
      </div>

      {canManage ? (
        <>
          {workspace.billingAccessState !== "paid" && workspace.billingAccessState !== "trialing" ? (
            <div className="rounded-(--r-card) border border-(--line) bg-(--surface-subtle) p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-bold">Subscribe — A$249/month</h3>
                  <p className="mt-1 max-w-[560px] text-[11.5px]/[15px] text-muted-foreground">
                    Recurring A$249 monthly until you cancel in the billing portal. Includes 50 complete
                    Feed + Story ad packs monthly, one business or brand, one Meta ad account, and up to five
                    members. Meta advertising spend is separate and paid directly to Meta.
                  </p>
                </div>
                <Button type="button" onClick={startCheckout} disabled={checkoutBusy}>
                  {checkoutBusy ? "Opening Checkout" : "Subscribe — A$249/month"}
                </Button>
              </div>
            </div>
          ) : null}
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
            <h4 className="text-sm font-semibold">Need managed service?</h4>
            <p className="text-sm text-muted-foreground">
              Compare managed service scope and regional starting prices.{" "}
              <Link href="/pricing" className="font-semibold text-foreground underline underline-offset-4">
                View managed service
              </Link>
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

function trialFoot(workspace: { billingAccessState: string; trialState: string | null; trialEndsAt: string | null }): string {
  const stateLabel = workspace.billingAccessState.replaceAll("_", " ");
  if (workspace.billingAccessState !== "unbilled" || !workspace.trialState) return stateLabel;
  if (workspace.trialState === "pending_delivery") {
    return `${stateLabel} · trial starts when your first ad delivers`;
  }
  if (workspace.trialEndsAt) {
    return `${stateLabel} · trial ends ${formatDate(workspace.trialEndsAt)}`;
  }
  return stateLabel;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-AU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Pending";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
