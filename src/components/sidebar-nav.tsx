"use client";

import {
  Activity,
  Bot,
  ClipboardCheck,
  FileSearch,
  Gauge,
  Images,
  LayoutDashboard,
  Megaphone,
  Settings,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarVariant = "operator" | "self_serve" | "monitor";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const operatorNavItems: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutDashboard },
  { href: "/operator/research", label: "Research Ops", icon: Activity },
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/self-serve", label: "Create", icon: Sparkles },
  { href: "/research", label: "Ad Library", icon: FileSearch },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
];

// Self-serve = monitor's view + Ad Studio. The self-serve home (/self-serve)
// is reached via the brand logo and post-login redirect, not a sidebar link.
const selfServeNavItems: NavItem[] = [
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/research", label: "Research", icon: FileSearch },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/ad-studio", label: "Ad Studio", icon: Images },
];

const monitorNavItems: NavItem[] = [
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/research", label: "Research", icon: FileSearch },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

const navByVariant: Record<SidebarVariant, NavItem[]> = {
  operator: operatorNavItems,
  self_serve: selfServeNavItems,
  monitor: monitorNavItems,
};

function isItemActive(pathname: string, href: string) {
  if (pathname === href) {
    return true;
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
