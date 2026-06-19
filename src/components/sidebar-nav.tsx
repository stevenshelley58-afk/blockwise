"use client";

import {
  Activity,
  BarChart3,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ClipboardCheck,
  Images,
  LayoutDashboard,
  Mail,
  Palette,
  Plug,
  Radar,
  Settings2,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarVariant = "operator" | "self_serve" | "monitor";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional grouping label rendered above the item (starts a new section). */
  section?: string;
};

const operatorNavItems: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutDashboard },
  { href: "/operator/email", label: "Email", icon: Mail },
  { href: "/operator/research", label: "Research Ops", icon: Activity },
  { href: "/operator/analytics", label: "Site Analytics", icon: BarChart3 },
  { href: "/results", label: "Results", icon: ChartNoAxesCombined },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/workforce", label: "Workforce", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
];

// Self-serve menu mirrors the approved self-serve mockup: a primary group, then
// a "Set up" group. Every entry maps to a real, working route.
const selfServeNavItems: NavItem[] = [
  { href: "/self-serve", label: "Overview", icon: LayoutDashboard },
  { href: "/results", label: "Performance", icon: ChartNoAxesCombined },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/ad-studio/brand", label: "Identity", icon: Palette, section: "Set up" },
  { href: "/settings#connections", label: "Integrations", icon: Plug, section: "Set up" },
  { href: "/settings", label: "Workspace", icon: Building2, section: "Set up" },
];

const monitorNavItems: NavItem[] = [
  { href: "/results", label: "Results", icon: ChartNoAxesCombined },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export const navByVariant: Record<SidebarVariant, NavItem[]> = {
  operator: operatorNavItems,
  self_serve: selfServeNavItems,
  monitor: monitorNavItems,
};

export function isItemActive(pathname: string, href: string) {
  const path = href.split(/[?#]/)[0];
  if (pathname === path) {
    return true;
  }
  if (path === "/operator" || path === "/settings") {
    return pathname === path;
  }
  return pathname.startsWith(`${path}/`);
}

export function SidebarNav({ variant, showApprovals = true }: { variant: SidebarVariant; showApprovals?: boolean }) {
  const pathname = usePathname() ?? "";
  const navItems = navByVariant[variant].filter((item) => showApprovals || item.href !== "/approvals");

  let lastSection: string | undefined;

  return (
    <nav className="nav-group">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item.href);
        const showSection = item.section && item.section !== lastSection;
        lastSection = item.section;

        return (
          <div key={item.href}>
            {showSection ? <p className="sidebar-kicker nav-section">{item.section}</p> : null}
            <Link
              className={active ? "nav-link active" : "nav-link"}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden size={18} />
              <span>{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
