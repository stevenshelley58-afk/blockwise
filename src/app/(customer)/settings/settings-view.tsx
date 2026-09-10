"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";

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
  const items = [
    { id: "account", label: sections.account }, { id: "connections", label: sections.connections },
    { id: "security", label: sections.password }, { id: "billing", label: sections.billing },
    ...(props.canManage ? [{ id: "workspace", label: sections.workspace }, { id: "team", label: sections.team }] : []),
    { id: "notifications", label: sections.notifications }, { id: "danger", label: sections.danger },
  ];
  const [selected, setSelected] = useState<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  useEffect(() => {
    const readLocation = () => {
      const hash = window.location.hash.slice(1);
      const query = new URLSearchParams(window.location.search).get("section");
      const next = hash || query;
      setSelected(items.some((item) => item.id === next) ? next : null);
    };
    readLocation();
    window.addEventListener("hashchange", readLocation);
    window.addEventListener("popstate", readLocation);
    return () => { window.removeEventListener("hashchange", readLocation); window.removeEventListener("popstate", readLocation); };
  }, [items.length]);
  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.querySelector('[data-settings-section="' + selected + '"]:not(.hidden)') as HTMLElement | null;
      panel?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);
  const openSection = (id: string) => { window.location.hash = id; setSelected(id); };
  const closeSection = () => { const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("section");
    window.history.pushState(window.history.state, "", url.pathname + (url.search ? url.search : ""));
    const previous = selected;
    setSelected(null);
    requestAnimationFrame(() => {
      if (previous) triggerRefs.current[previous]?.focus();
    });
  };
  const sectionClass = (id: string) => selected === id ? "block" : "hidden";
  return (
    <div className="grid gap-3.5">
      <nav aria-label="Settings sections" className={selected ? "hidden flex-wrap gap-1.5 md:flex" : "hidden"}>
        {items.map((item) => <a key={item.id} ref={(node) => { triggerRefs.current[item.id] = node; }} href={"#" + item.id} onClick={() => openSection(item.id)} aria-current={selected === item.id ? "page" : undefined} className={selected === item.id ? chipClass + " border-(--ink) bg-(--accent-tint)" : chipClass}>{item.label}</a>)}
        {selected ? <button type="button" onClick={closeSection} className={chipClass}>All settings</button> : null}
      </nav>
      <div className={selected ? "sticky top-[calc(54px+env(safe-area-inset-top))] z-10 grid gap-2 bg-background py-1 md:static md:bg-transparent md:py-0" : "grid gap-2"} aria-label="Settings sections">
        {selected ? (
          <button type="button" onClick={closeSection} className="mb-1 inline-flex min-h-11 items-center self-start md:hidden text-sm font-bold text-foreground">
            <ArrowLeft aria-hidden className="mr-2 size-4" />All settings
          </button>
        ) : null}
        {!selected ? <div className="grid gap-2 md:grid-cols-2">{items.map((item) => (
          <a key={item.id} ref={(node) => { triggerRefs.current[item.id] = node; }} href={"#" + item.id} onClick={() => openSection(item.id)} className="flex min-h-14 items-center justify-between rounded-(--r-card) border border-(--line) bg-(--surface) px-4 text-sm font-bold shadow-card md:min-h-16">
            {item.label}<ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </a>
        ))}</div> : null}
      </div>
      <div tabIndex={-1} data-settings-section="account" className={sectionClass("account")}><AccountSection supabase={supabase} router={router} user={props.user} profile={props.profile} /></div>
      <div tabIndex={-1} data-settings-section="connections" className={sectionClass("connections")}><ConnectionsSection supabase={supabase} router={router} canManage={props.canManage} workspaceId={props.workspace.id} connections={props.connections} googleAdsEnabled={props.googleAdsEnabled} metaConnectHref={props.metaConnectHref} googleConnectHref={props.googleConnectHref} /></div>
      <div tabIndex={-1} data-settings-section="security" className={sectionClass("security")}><PasswordSection supabase={supabase} /></div>
      <div tabIndex={-1} data-settings-section="billing" className={sectionClass("billing")}><BillingSection supabase={supabase} router={router} canManage={props.canManage} workspace={props.workspace} plan={props.plan} usage={props.usage} bookingState={props.bookingState} /></div>
      {props.canManage ? <div tabIndex={-1} data-settings-section="workspace" className={sectionClass("workspace")}><WorkspaceSection supabase={supabase} router={router} workspace={props.workspace} /></div> : null}
      {props.canManage ? <div tabIndex={-1} data-settings-section="team" className={sectionClass("team")}><TeamSection supabase={supabase} router={router} workspaceId={props.workspace.id} currentUserId={props.user.id} members={props.members} invitations={props.invitations} billingAccessState={props.workspace.billingAccessState} currentRole={props.role} /></div> : null}
      <div tabIndex={-1} data-settings-section="notifications" className={sectionClass("notifications")}><NotificationsSection supabase={supabase} userId={props.user.id} deliveryEmail={props.user.email} initial={props.profile.notificationPreferences} /></div>
      <div tabIndex={-1} data-settings-section="danger" className={sectionClass("danger")}><DangerSection supabase={supabase} router={router} workspaceId={props.workspace.id} /></div>
    </div>
  );
}
