"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { niche } from "@/config/niche";

import { AccountSection, PasswordSection } from "./account-section";
import { BillingSection } from "./billing-section";
import { ConnectionsSection } from "./connections-section";
import { DangerSection } from "./danger-section";
import { NotificationsSection } from "./notifications-section";
import { TeamSection } from "./team-section";
import { WorkspaceSection } from "./workspace-section";
import type { SettingsViewProps } from "./settings-shared";

const chipClass =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-(--line) bg-(--surface) px-3 text-xs font-bold text-muted-foreground transition-colors duration-150 hover:border-(--line-heavy) hover:text-foreground";

export function SettingsView(props: SettingsViewProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const sections = niche.copy.settings.sections;
  const navItems: Array<{ href: string; label: string }> = [
    { href: "#account", label: sections.account },
    { href: "#connections", label: sections.connections },
    { href: "#security", label: sections.password },
    { href: "#billing", label: sections.billing },
    ...(props.canManage
      ? [
          { href: "#workspace", label: sections.workspace },
          { href: "#team", label: sections.team },
        ]
      : []),
    { href: "#notifications", label: sections.notifications },
    { href: "#danger", label: sections.danger },
  ];

  return (
    <div className="grid gap-3.5">
      <nav aria-label="Settings sections" className="flex gap-1.5 overflow-x-auto pb-1">
        {navItems.map((item) => (
          <a key={item.href} href={item.href} className={chipClass}>
            {item.label}
          </a>
        ))}
      </nav>

      <AccountSection supabase={supabase} router={router} user={props.user} profile={props.profile} />
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
        usage={props.usage}
        bookingState={props.bookingState}
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
          invitations={props.invitations}
          billingAccessState={props.workspace.billingAccessState}
          currentRole={props.role}
        />
      ) : null}
      <NotificationsSection supabase={supabase} userId={props.user.id} initial={props.profile.notificationPreferences} />
      <DangerSection supabase={supabase} router={router} workspaceId={props.workspace.id} />
    </div>
  );
}
