"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,

  Briefcase,
  CreditCard,



  User,

} from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { niche } from "@/config/niche";

import { AccountSection, PasswordSection } from "./account-section";
import { BillingSection } from "./billing-section";
import { ConnectionsSection } from "./connections-section";
import { DangerSection } from "./danger-section";
import { NotificationsSection } from "./notifications-section";
import { TeamSection } from "./team-section";
import { WorkspaceSection } from "./workspace-section";
import type { SettingsViewProps } from "./settings-shared";

function getTabIcon(tab: string) {
  switch (tab) {
    case "account":
      return <User className="size-4" />;
    case "workspace":
      return <Briefcase className="size-4" />;
    case "billing":
      return <CreditCard className="size-4" />;
    case "danger":
      return <AlertTriangle className="size-4" />;
    default:
      return null;
  }
}

export function SettingsView(props: SettingsViewProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [activeTab, setActiveTab] = useState("account");

  useEffect(() => {
    const readLocation = () => {
      const hash = window.location.hash.slice(1);
      const query = new URLSearchParams(window.location.search).get("section");
      const next = hash || query || "account";
      setActiveTab(next);
    };
    readLocation();
    window.addEventListener("hashchange", readLocation);
    window.addEventListener("popstate", readLocation);
    return () => {
      window.removeEventListener("hashchange", readLocation);
      window.removeEventListener("popstate", readLocation);
    };
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    window.location.hash = value;
  };

  const showWorkspace = props.canManage;

  return (
    <div className="w-full">
      <Tabs value={activeTab} onValueChange={handleTabChange} orientation="horizontal">
        <TabsList
          variant="line"
          className="w-full justify-start gap-0 overflow-x-auto border-b border-(--line) bg-transparent p-0"
        >
          <TabsTrigger value="account" className="gap-2 px-4 py-3 text-[13px] font-semibold">
            {getTabIcon("account")}
            Account
          </TabsTrigger>
          {showWorkspace ? (
            <TabsTrigger value="workspace" className="gap-2 px-4 py-3 text-[13px] font-semibold">
              {getTabIcon("workspace")}
              Workspace
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="billing" className="gap-2 px-4 py-3 text-[13px] font-semibold">
            {getTabIcon("billing")}
            Billing
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-2 px-4 py-3 text-[13px] font-semibold text-error">
            {getTabIcon("danger")}
            Danger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-6 grid gap-6">
          <AccountSection supabase={supabase} router={router} user={props.user} profile={props.profile} />
          <PasswordSection supabase={supabase} />
          <NotificationsSection
            supabase={supabase}
            userId={props.user.id}
            deliveryEmail={props.user.email}
            initial={props.profile.notificationPreferences}
          />
        </TabsContent>

        {showWorkspace ? (
          <TabsContent value="workspace" className="mt-6 grid gap-6">
            <WorkspaceSection supabase={supabase} router={router} workspace={props.workspace} />
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
          </TabsContent>
        ) : null}

        <TabsContent value="billing" className="mt-6 grid gap-6">
          <BillingSection
            supabase={supabase}
            router={router}
            canManage={props.canManage}
            workspace={props.workspace}
            plan={props.plan}
            usage={props.usage}
            bookingState={props.bookingState}
          />
        </TabsContent>

        <TabsContent value="danger" className="mt-6 grid gap-6">
          <DangerSection
            supabase={supabase}
            router={router}
            workspaceId={props.workspace.id}
            workspaceName={props.workspace.name}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
