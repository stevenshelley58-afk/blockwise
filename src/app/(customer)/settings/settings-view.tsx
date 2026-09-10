"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  ChevronRight,
  CreditCard,
  Link as LinkIcon,
  Lock,
  Palette,
  User,
  Users,
} from "lucide-react";

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

type NavItem = {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  value: string;
  href?: string;
};

type Group = {
  title: string;
  items: NavItem[];
};

function makeGroups(props: SettingsViewProps): Group[] {
  const sections = niche.copy.settings.sections;
  const connectedAccount =
    props.connections.find((c) => c.status !== "not_connected")?.accountName ?? null;

  const notifEnabled = Object.entries(props.profile.notificationPreferences).filter(
    ([k, v]) => v === true && ["approvalRequests", "leadAlerts", "weeklyDigest", "productUpdates"].includes(k)
  ).length;
  const notifTotal = 4;

  const groups: Group[] = [
    {
      title: "Account",
      items: [
        {
          id: "account",
          label: sections.account,
          description: "Profile, email, and name",
          icon: <User className="size-4" />,
          value: props.profile.fullName || props.user.email,
        },
        {
          id: "security",
          label: sections.password,
          description: "Update your password",
          icon: <Lock className="size-4" />,
          value: "Password protected",
        },
        {
          id: "notifications",
          label: sections.notifications,
          description: "Email alerts and digests",
          icon: <Bell className="size-4" />,
          value: `${notifEnabled} of ${notifTotal} on`,
        },
      ],
    },
  ];

  if (props.canManage) {
    groups.push({
      title: "Workspace",
      items: [
        {
          id: "workspace",
          label: sections.workspace,
          description: "Name, region, and website",
          icon: <Briefcase className="size-4" />,
          value: props.workspace.name,
        },
        {
          id: "team",
          label: sections.team,
          description: "Members and invitations",
          icon: <Users className="size-4" />,
          value:
            `${props.members.length} member${props.members.length !== 1 ? "s" : ""}` +
            (props.invitations.length ? `, ${props.invitations.length} pending` : ""),
        },
        {
          id: "connections",
          label: sections.connections,
          description: "Meta and Google ad accounts",
          icon: <LinkIcon className="size-4" />,
          value: connectedAccount ?? "Not connected",
        },
        {
          id: "brand-pack",
          label: "Brand Pack",
          description: "Logo, colours, and fonts",
          icon: <Palette className="size-4" />,
          value: props.workspace.brandPackStatus?.replaceAll("_", " ") ?? "Not started",
          href: "/ad-studio/brand",
        },
      ],
    });
  } else {
    groups.push({
      title: "Workspace",
      items: [
        {
          id: "connections",
          label: sections.connections,
          description: "Meta and Google ad accounts",
          icon: <LinkIcon className="size-4" />,
          value: connectedAccount ?? "Not connected",
        },
      ],
    });
  }

  groups.push({
    title: "Billing",
    items: [
      {
        id: "billing",
        label: sections.billing,
        description: "Plan, invoices, and usage",
        icon: <CreditCard className="size-4" />,
        value: props.plan?.name
          ? `${props.plan.name}${props.workspace.subscriptionStatus ? ` - ${props.workspace.subscriptionStatus}` : ""}`
          : "No plan",
      },
    ],
  });

  return groups;
}

function makeDangerItem(props: SettingsViewProps): NavItem {
  return {
    id: "danger",
    label: niche.copy.settings.sections.danger,
    description: "Sign out everywhere or delete",
    icon: <AlertTriangle className="size-4" />,
    value: "Destructive action",
  };
}

export function SettingsView(props: SettingsViewProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const groups = useMemo(() => makeGroups(props), [props]);
  const dangerItem = useMemo(() => makeDangerItem(props), [props]);

  const validIds = useMemo(
    () => [...groups.flatMap((g) => g.items.map((i) => i.id)), dangerItem.id],
    [groups, dangerItem]
  );

  const [selected, setSelected] = useState<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLAnchorElement | HTMLButtonElement | null>>({});

  useEffect(() => {
    const readLocation = () => {
      const hash = window.location.hash.slice(1);
      const query = new URLSearchParams(window.location.search).get("section");
      const next = hash || query || "";
      setSelected(validIds.includes(next) ? next : null);
    };
    readLocation();
    window.addEventListener("hashchange", readLocation);
    window.addEventListener("popstate", readLocation);
    return () => {
      window.removeEventListener("hashchange", readLocation);
      window.removeEventListener("popstate", readLocation);
    };
  }, [validIds.join(",")]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = document.querySelector(`[data-settings-section="${selected}"]:not(.hidden)`) as HTMLElement | null;
      panel?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  const openSection = (id: string) => {
    window.location.hash = id;
    setSelected(id);
  };

  const closeSection = () => {
    const url = new URL(window.location.href);
    url.hash = "";
    url.searchParams.delete("section");
    window.history.pushState(window.history.state, "", url.pathname + (url.search ? url.search : ""));
    const previous = selected;
    setSelected(null);
    requestAnimationFrame(() => {
      if (previous) triggerRefs.current[previous]?.focus();
    });
  };

  const activeSection = selected ?? "account";
  const sectionClass = (id: string) => (activeSection === id ? "block" : "hidden");

  const renderNavItem = (item: NavItem) => {
    const active = selected === item.id;
    const baseClass =
      "flex w-full items-center gap-3 rounded-(--r-card) border px-3 py-2.5 text-left text-sm transition-colors duration-150";
    const stateClass = active
      ? "border-(--ink) bg-(--accent-tint) font-bold text-foreground"
      : "border-transparent bg-transparent font-medium text-foreground hover:bg-(--surface) hover:border-(--line)";

    if (item.href) {
      return (
        <Link
          key={item.id}
          href={item.href}
          className={`${baseClass} ${stateClass}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--surface)">
            {item.icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{item.label}</span>
            <span className="truncate text-xs text-muted-foreground font-normal">{item.description}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      );
    }

    return (
      <button
        key={item.id}
        ref={(node) => { triggerRefs.current[item.id] = node; }}
        onClick={() => { openSection(item.id); }}
        className={`${baseClass} ${stateClass}`}
        aria-current={active ? "page" : undefined}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-(--line) bg-(--surface)">
          {item.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          <span className="truncate text-xs text-muted-foreground font-normal">{item.description}</span>
        </span>
        <span className="ml-1 shrink-0 text-xs text-muted-foreground font-normal hidden md:block">{item.value}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground md:hidden" />
      </button>
    );
  };

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr] md:gap-8">
      {/* LEFT NAV */}
      <nav aria-label="Settings sections" className={`flex flex-col gap-5 ${selected ? "hidden md:flex" : "flex"}`}>
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <h3 className="px-3 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </h3>
            {group.items.map(renderNavItem)}
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <h3 className="px-3 text-[11px] font-extrabold uppercase tracking-wider text-error">Danger zone</h3>
          {renderNavItem(dangerItem)}
        </div>
      </nav>

      {/* RIGHT CONTENT */}
      <div className={`min-w-0 ${!selected ? "hidden md:block" : "block"}`}>
        {/* Mobile back button */}
        {selected ? (
          <button
            type="button"
            onClick={closeSection}
            className="mb-3 inline-flex min-h-10 items-center text-sm font-bold text-foreground md:hidden"
          >
            <ChevronRight className="mr-1 size-4 rotate-180" aria-hidden />
            Back to settings
          </button>
        ) : null}

        <div
          tabIndex={-1}
          data-settings-section="account"
          className={`${selected && selected !== "account" ? "hidden md:block" : sectionClass("account")}`}
        >
          <AccountSection supabase={supabase} router={router} user={props.user} profile={props.profile} />
        </div>
        <div
          tabIndex={-1}
          data-settings-section="connections"
          className={sectionClass("connections")}
        >
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
        </div>
        <div tabIndex={-1} data-settings-section="security" className={sectionClass("security")}>
          <PasswordSection supabase={supabase} />
        </div>
        <div tabIndex={-1} data-settings-section="billing" className={sectionClass("billing")}>
          <BillingSection
            supabase={supabase}
            router={router}
            canManage={props.canManage}
            workspace={props.workspace}
            plan={props.plan}
            usage={props.usage}
            bookingState={props.bookingState}
          />
        </div>
        {props.canManage ? (
          <div tabIndex={-1} data-settings-section="workspace" className={sectionClass("workspace")}>
            <WorkspaceSection supabase={supabase} router={router} workspace={props.workspace} />
          </div>
        ) : null}
        {props.canManage ? (
          <div tabIndex={-1} data-settings-section="team" className={sectionClass("team")}>
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
          </div>
        ) : null}
        <div tabIndex={-1} data-settings-section="notifications" className={sectionClass("notifications")}>
          <NotificationsSection
            supabase={supabase}
            userId={props.user.id}
            deliveryEmail={props.user.email}
            initial={props.profile.notificationPreferences}
          />
        </div>
        <div tabIndex={-1} data-settings-section="danger" className={sectionClass("danger")}>
          <DangerSection supabase={supabase} router={router} workspaceId={props.workspace.id} workspaceName={props.workspace.name} />
        </div>
      </div>
    </div>
  );
}
