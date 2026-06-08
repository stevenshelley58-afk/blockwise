"use client";

import {
  Activity,
  BarChart3,
  Bot,
  ChartNoAxesCombined,
  ClipboardCheck,
  Images,
  LayoutDashboard,
  PenLine,
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
};

const operatorNavItems: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutDashboard },
  { href: "/operator/research", label: "Research Ops", icon: Activity },
  { href: "/operator/analytics", label: "Site Analytics", icon: BarChart3 },
  { href: "/results", label: "Results", icon: ChartNoAxesCombined },
  { href: "/self-serve", label: "Create", icon: PenLine },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
];

const selfServeNavItems: NavItem[] = [
  { href: "/results", label: "Results", icon: ChartNoAxesCombined },
  { href: "/self-serve", label: "Create", icon: PenLine },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

const monitorNavItems: NavItem[] = [
  { href: "/results", label: "Results", icon: ChartNoAxesCombined },
  { href: "/ad-radar", label: "Ad Radar", icon: Radar },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export const navByVariant: Record<SidebarVariant, NavItem[]> = {
  operator: operatorNavItems,
  self_serve: selfServeNavItems,
  monitor: monitorNavItems,
};

export function isItemActive(pathname: string, href: string) {
  if (pathname === href) {
    return true;
  }
  if (href === "/operator") {
    return false;
  }
  return pathname.startsWith(`${href}/`);
}

export function SidebarNav({ variant }: { variant: SidebarVariant }) {
  const pathname = usePathname() ?? "";
  const navItems = navByVariant[variant];

  return (
    <nav className="nav-group">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item.href);

        return (
          <Link
            className={active ? "nav-link active" : "nav-link"}
            href={item.href}
            key={item.href}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden size={18} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
