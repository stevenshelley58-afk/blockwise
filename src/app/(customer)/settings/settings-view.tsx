"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { AccountSection, PasswordSection } from "./account-section";
import { BillingSection } from "./billing-section";
import { ConnectionsSection } from "./connections-section";
import { DangerSection } from "./danger-section";
import { NotificationsSection } from "./notifications-section";
import type { SettingsViewProps } from "./settings-shared";
import { TeamSection } from "./team-section";
import { WorkspaceSection } from "./workspace-section";

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
