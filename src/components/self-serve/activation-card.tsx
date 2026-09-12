import { ArrowRight, Check, ChevronDown } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export type ActivationCardData = {
  activation: {
    currentStage: string;
    nextAction: string;
    resumePath: string;
    completed: number;
    total: number;
    milestones: Record<string, string | null>;
    foundationAvailable: boolean;
  };
  credits: {
    granted: number | null;
    used: number;
    reserved: number;
    remaining: number | null;
    entitlementType: string;
    periodStart: string | null;
    periodEnd: string | null;
  };
  plan: {
    accessState: string;
    currency: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    latestInvoiceStatus: string | null;
  };
  meta: {
    state: string;
    accountName: string | null;
  };
  booking: {
    state: "not_booked" | "booked" | "completed" | "unavailable";
  };
};

const DISPLAY_MILESTONES = [
  ["email_verified", "Email verified"],
  ["country_confirmed", "Country confirmed"],
  ["website_submitted", "Website added"],
  ["brand_pack_approved", "Brand Pack approved"],
  ["first_template_selected", "Template selected"],
  ["first_ad_pack_generated", "First ad created"],
  ["meta_connected", "Connection step completed"],
  ["checkout_completed", "Checkout completed"],
  ["first_campaign_live", "First ad live"],
  ["intro_invoice_paid", "First invoice paid"],
] as const;

export function ActivationCard({ data }: { data: ActivationCardData }) {
  const { activation } = data;
  const completedMilestones = DISPLAY_MILESTONES.filter(([key]) => activation.milestones[key]);
  const isComplete = activation.currentStage === "complete";
  const ctaLabel = isComplete ? "Create an ad" : activation.nextAction;
  const ctaHref = isComplete ? "/ad-studio" : activation.resumePath;

  return (
    <section aria-labelledby="activation-heading" className="border-y border-(--line) py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="activation-heading" className="text-[17px] font-extrabold tracking-[-0.015em]">
            {isComplete ? "Workspace setup complete" : "Next step"}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {activation.foundationAvailable ? `${activation.completed} of ${activation.total} setup steps complete` : "Workspace available"}
          </p>
        </div>
      </div>

      {activation.foundationAvailable ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-(--line)" role="progressbar" aria-valuemin={0} aria-valuemax={activation.total} aria-valuenow={activation.completed} aria-label={`${activation.completed} of ${activation.total} setup steps complete`}>
          <div className="h-full rounded-full bg-(--ink)" style={{ width: `${activation.total > 0 ? Math.min(100, Math.max(0, (activation.completed / activation.total) * 100)) : 0}%` }} />
        </div>
      ) : null}

      <Button asChild size="lg" className="mt-4 w-full md:w-auto md:min-w-[240px]">
        <Link href={ctaHref}>
          {ctaLabel}
          <ArrowRight size={15} aria-hidden />
        </Link>
      </Button>

      <details className="group mt-5 border-t border-(--line) pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span>Completed milestones</span>
          {completedMilestones.length > 0 ? <span className="font-normal text-muted-foreground">{completedMilestones.length} complete</span> : null}
          <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        {completedMilestones.length > 0 ? (
          <ul className="grid gap-2 pb-2 sm:grid-cols-2">
            {completedMilestones.map(([key, label]) => (
              <li key={key} className="flex min-h-8 items-center gap-2 text-[12px] font-semibold">
                <Check size={14} className="shrink-0 text-success" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        ) : <p className="pb-2 text-xs text-muted-foreground">Completed setup steps will appear here.</p>}
      </details>
    </section>
  );
}

export function WorkspaceDetails({
  credits,
  plan,
  meta,
  booking,
  packEstimate,
}: {
  credits: ActivationCardData["credits"];
  plan: ActivationCardData["plan"];
  meta: ActivationCardData["meta"];
  booking: ActivationCardData["booking"];
  packEstimate: number | null;
}) {
  return (
    <details className="group mt-3 border-t border-(--line) pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[12.5px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>Workspace details</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <dl className="divide-y divide-(--line) text-[12px]">
        <DetailRow label="Plan and billing" value={planLabel(plan.accessState)} foot={billingTiming(plan)} />
        <DetailRow label="Direct Meta connection" value={metaLabel(meta.state)} foot={meta.accountName ?? "Direct connection and assisted partner access are tracked separately."} />
        <DetailRow label="Onboarding call" value={bookingLabel(booking.state)} foot={bookingFoot(booking.state)} />
        <DetailRow label="Render credits" value={credits.remaining == null ? "Not issued yet" : `${credits.remaining} remaining`} foot={packEstimate == null ? "Credits appear after entitlement setup." : `Enough for up to ${packEstimate} complete Feed + Story ${packEstimate === 1 ? "pack" : "packs"}.`} />
      </dl>
    </details>
  );
}

function DetailRow({ label, value, foot }: { label: string; value: string; foot: string }) {
  return <div className="grid gap-0.5 py-3 sm:grid-cols-[180px_1fr] sm:gap-3"><dt className="font-semibold">{label}</dt><dd><span className="font-semibold">{value}</span><span className="mt-0.5 block text-muted-foreground">{foot}</span></dd></div>;
}

function planLabel(state: string): string {
  if (state === "paid") return "Self-serve paid";
  if (state === "trialing") return "Billing trial (legacy)";
  if (state === "payment_recovery") return "Payment needs attention";
  if (state === "canceled") return "Canceled";
  return "Free creation trial";
}

function billingTiming(plan: ActivationCardData["plan"]): string {
  if (plan.accessState === "unbilled") return "Subscribe for A$249 monthly when ready. Your free trial never requires a card.";
  if (!plan.periodEnd) return "Billing timing appears after Stripe confirms the subscription.";
  const date = formatDate(plan.periodEnd);
  if (plan.cancelAtPeriodEnd) return `Credits and access remain available until ${date}.`;
  return `Next A$249 renewal: ${date}.`;
}

function metaLabel(state: string): string {
  if (state === "connected") return "Connected";
  if (state === "needs_attention") return "Needs attention";
  return "Not connected";
}

function bookingLabel(state: ActivationCardData["booking"]["state"]): string {
  if (state === "completed") return "Completed";
  if (state === "booked") return "Booked";
  if (state === "unavailable") return "Hosted booking available";
  return "Not booked";
}

function bookingFoot(state: ActivationCardData["booking"]["state"]): string {
  if (state === "not_booked") return "Booking becomes available with your paid plan.";
  if (state === "unavailable") return "Use the hosted booking link in Settings.";
  return "Manage booking details in Settings.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date pending";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
