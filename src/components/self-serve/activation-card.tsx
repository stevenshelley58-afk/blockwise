import { ArrowRight, CalendarClock, Check, CircleDot, CreditCard, UsersRound } from "lucide-react";
import Link from "next/link";

import { StatusPill } from "@/components/status-pill";

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
  ["meta_connected", "Meta connected"],
  ["checkout_completed", "Payment method added"],
  ["first_campaign_live", "First campaign live"],
  ["intro_invoice_paid", "First invoice paid"],
] as const;

export function ActivationCard({ data }: { data: ActivationCardData }) {
  const { activation, credits, plan, meta, booking } = data;
  const completedMilestones = DISPLAY_MILESTONES.filter(([key]) => activation.milestones[key]);
  const packEstimate = credits.remaining;
  const isComplete = activation.currentStage === "complete";

  return (
    <section className="h-full rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">
            {isComplete ? "Workspace status" : "Next action"}
          </p>
          <h2 className="mt-1 font-display text-[20px] font-extrabold tracking-[-0.02em]">
            {activation.nextAction}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {isComplete
              ? "Your activation is complete. Create, publish, and manage the workspace from here."
              : "Continue from the last server-confirmed step. Completed work will not be repeated."}
          </p>
        </div>
        <StatusPill tone={isComplete ? "green" : "blue"}>
          {activation.foundationAvailable
            ? `${activation.completed} of ${activation.total} complete`
            : "Workspace available"}
        </StatusPill>
      </div>

      <Link
        href={activation.resumePath}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-(--ink) px-5 text-[12.5px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.98]"
      >
        {activation.nextAction}
        <ArrowRight size={15} aria-hidden />
      </Link>

      <div className="mt-5 grid gap-px overflow-hidden rounded-(--r-card) border border-(--line) bg-(--line) sm:grid-cols-2">
        <StatusCell
          icon={<CreditCard size={16} aria-hidden />}
          label="Plan and billing"
          value={planLabel(plan.accessState)}
          foot={billingTiming(plan)}
        />
        <StatusCell
          icon={<CircleDot size={16} aria-hidden />}
          label="Meta"
          value={metaLabel(meta.state)}
          foot={meta.accountName ?? "Connect only when you are ready to run an ad."}
        />
        <StatusCell
          icon={<CalendarClock size={16} aria-hidden />}
          label="Onboarding call"
          value={bookingLabel(booking.state)}
          foot={
            booking.state === "not_booked"
              ? "Booking becomes available with your paid plan."
              : booking.state === "unavailable"
                ? "Use the hosted booking link in Settings."
                : "Manage booking details in Settings."
          }
        />
        <StatusCell
          icon={<UsersRound size={16} aria-hidden />}
          label="Render credits"
          value={credits.remaining == null ? "Not issued yet" : `${credits.remaining} remaining`}
          foot={
            packEstimate == null
              ? "Credits appear here as soon as the entitlement is issued."
              : `Enough for up to ${packEstimate} complete Feed + Story ${packEstimate === 1 ? "pack" : "packs"}.`
          }
        />
      </div>

      <div className="mt-5 border-t border-(--line) pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[12.5px] font-bold">Completed milestones</h3>
          {completedMilestones.length > 0 ? (
            <span className="text-[11.5px] text-muted-foreground">{completedMilestones.length} shown</span>
          ) : null}
        </div>
        {completedMilestones.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {completedMilestones.map(([key, label]) => (
              <li key={key} className="flex min-h-8 items-center gap-2 text-[12.5px] font-semibold">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                  <Check size={12} strokeWidth={2.5} aria-hidden />
                </span>
                {label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Your server-confirmed milestones will appear here as you complete them.
          </p>
        )}
      </div>
    </section>
  );
}

function StatusCell({
  icon,
  label,
  value,
  foot,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  foot: string;
}) {
  return (
    <div className="bg-(--surface-subtle) p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] uppercase">{label}</span>
      </div>
      <p className="mt-2 text-[13px] font-bold">{value}</p>
      <p className="mt-1 text-[11.5px] leading-4 text-muted-foreground">{foot}</p>
    </div>
  );
}

function planLabel(state: string): string {
  if (state === "paid") return "Self-serve paid";
  if (state === "trialing") return "Seven-day billing trial";
  if (state === "payment_recovery") return "Payment needs attention";
  if (state === "canceled") return "Canceled";
  return "Free creation trial";
}

function billingTiming(plan: ActivationCardData["plan"]): string {
  if (plan.accessState === "unbilled") {
    return `${plan.currency === "USD" ? "US$" : "A$"}99 first month when you launch or seven days after Checkout.`;
  }
  if (!plan.periodEnd) return "Billing timing will appear after Stripe confirms the subscription.";
  const date = formatDate(plan.periodEnd);
  if (plan.cancelAtPeriodEnd) return `Credits and access remain available until ${date}.`;
  return `Next ${plan.currency === "USD" ? "US$" : "A$"}499 renewal: ${date}.`;
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date pending";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
