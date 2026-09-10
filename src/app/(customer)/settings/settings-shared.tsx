"use client";

import type { ReactNode } from "react";
import type { useRouter } from "next/navigation";

import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const REGION_CURRENCY: Record<string, string> = { AU: "AUD" };

export const REGION_NAMES: Record<string, string> = {
  AU: "Australia",
};

export const ASSIGNABLE_ROLES = ["owner", "admin", "member", "viewer"];

export type Msg = { tone: "success" | "error"; text: string } | null;

export type Connection = {
  id: string;
  provider: string;
  status: string;
  accountName: string | null;
  healthStatus: string;
  lastSyncAt: string | null;
};

export type Member = {
  profileId: string;
  role: string;
  fullName: string | null;
  email: string | null;
  isOperator: boolean;
  emailVerified: boolean;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

export type Plan = {
  name: string;
  key: string;
  monthlyAiBudgetCents: number;
  maxWorkspaces: number;
  maxAgentRunsPerMonth: number;
} | null;

export type SettingsViewProps = {
  user: { id: string; email: string };
  profile: {
    fullName: string;
    phone: string;
    timezone: string;
    emailVerified: boolean;
    notificationPreferences: Record<string, boolean>;
  };
  workspace: {
    id: string;
    name: string;
    region: string;
    country: string;
    currency: string;
    website: string;
    brandPackStatus: string | null;
    marketBound: boolean;
    approvalRequiredByDefault: boolean;
    billingEmail: string;
    stripeCustomerId: string | null;
    subscriptionStatus: string | null;
    billingAccessState: string;
    trialState: string | null;
    trialEndsAt: string | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    latestInvoiceStatus: string | null;
    latestInvoiceAmountPaid: number | null;
  };
  usage: {
    granted: number | null;
    used: number;
    reserved: number;
    remaining: number | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  bookingState: "not_booked" | "booked" | "completed" | "unavailable";
  plan: Plan;
  connections: Connection[];
  members: Member[];
  invitations: WorkspaceInvitation[];
  role: string;
  isOperator: boolean;
  canManage: boolean;
  googleAdsEnabled: boolean;
  metaConnectHref: string;
  googleConnectHref: string;
};

export type SB = ReturnType<typeof createSupabaseBrowserClient>;
export type RT = ReturnType<typeof useRouter>;

export const selectClass =
  "h-9 w-full appearance-none rounded-(--r-card) border border-(--line) bg-(--surface) px-2.5 text-[12.5px] font-semibold text-foreground outline-none transition-[border-color] duration-150 focus:border-(--ink) disabled:cursor-not-allowed disabled:opacity-50";

export function Feedback({ message }: { message: Msg }) {
  if (!message) return null;
  return (
    <p className={`text-[12.5px] font-bold ${message.tone === "error" ? "text-error" : "text-success"}`}>
      {message.text}
    </p>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-20 rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card" id={id}>
      <h2 className="font-display text-[15.5px] font-extrabold tracking-[-0.015em]">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}
