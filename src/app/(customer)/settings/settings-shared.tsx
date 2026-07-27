"use client";

import type { ReactNode } from "react";
import type { useRouter } from "next/navigation";

import type { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export const REGION_CURRENCY: Record<string, string> = { AU: "AUD", NZ: "NZD", GB: "GBP", US: "USD", CA: "CAD" };

export const REGION_NAMES: Record<string, string> = {
  AU: "Australia",
  NZ: "New Zealand",
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
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
