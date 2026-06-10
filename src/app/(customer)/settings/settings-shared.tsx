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

export function Feedback({ message }: { message: Msg }) {
  if (!message) return null;
  return <p className={`wizard-status ${message.tone}`}>{message.text}</p>;
}

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
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
