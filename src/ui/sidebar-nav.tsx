"use client";

import {
  Bot,
  Building2,
  ClipboardCheck,
  FileSearch,
  Gauge,
  Images,
  LayoutDashboard,
  Megaphone,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Capability } from "@/modules/auth/capabilities";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The capability a user must hold for this item to appear. */
  requires: Capability;
};

// Single source of truth for navigation. Items are filtered by the user's
// derived capabilities, so there are no per-role hardcoded menus.
const NAV_ITEMS: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutDashboard, requires: "manage_all_workspaces" },
  { href: "/monitor", label: "Monitor", icon: Gauge, requires: "monitor_ads" },
  { href: "/self-serve", label: "Self-Serve", icon: Sparkles, requires: "create_ads" },
  { href: "/research", label: "Research", icon: FileSearch, requires: "monitor_ads" },
  { href: "/ad-studio", label: "Ad Studio", icon: Images, requires: "create_ads" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, requires: "create_ads" },
  { href: "/leads", label: "Leads", icon: UsersRound, requires: "view_leads" },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, requires: "approve_ads" },
  { href: "/onboarding", label: "Onboarding", icon: Building2, requires: "monitor_ads" },
  { href: "/ai-workforce", label: "AI Workforce", icon: Bot, requires: "manage_hermes" },
  { href: "/model-control", label: "Model Control", icon: Settings2, requires: "manage_model_controls" },
];

function isItemActive(pathname: string, href: string) {
  if (pathname === href) {
    return true;
  }
  return pathname.startsWith(`${href}/`);
}

export function SidebarNav({ capabilities }: { capabilities: Capability[] }) {
  const pathname = usePathname() ?? "";
  const granted = new Set(capabilities);
  const navItems = NAV_ITEMS.filter((item) => granted.has(item.requires));

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
