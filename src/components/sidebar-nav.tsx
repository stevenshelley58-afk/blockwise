"use client";

import {
  Activity,
  BarChart3,
  Bot,
  Database,
  FileSearch,
  LayoutGrid,
  LineChart,
  Mail,
  Settings,
  Settings2,
  Star,
  UserRound,
  ContactRound,
  UsersRound,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { niche } from "@/config/niche";

export type SidebarVariant = "operator" | "self_serve" | "monitor";

type NavIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Optional grouping label rendered above the item (starts a new section). */
  section?: string;
  feature?: keyof typeof niche.features;
};

// Clean radar mark matching the self-serve mockup (circle + single sweep hand).
function RadarIcon({ size = 18, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12l5-3" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const operatorNavItems = ([
  { href: "/operator", label: "Operator", icon: LayoutGrid },
  { href: "/operator/customers", label: "Customers", icon: ContactRound },
  { href: "/operator/email", label: "Email", icon: Mail },
  { href: "/operator/research", label: "Research Ops", icon: Activity, feature: "adRadar" },
  { href: "/operator/analytics", label: "Site Analytics", icon: BarChart3 },
  { href: "/operator/database", label: "Database", icon: Database },
  { href: "/results", label: "Results", icon: LineChart },
  { href: "/ad-radar", label: "Ad Radar", icon: RadarIcon, feature: "adRadar" },
  { href: "/ad-studio", label: "Ad Studio", icon: Star },
  { href: "/property-check", label: "Property Check", icon: FileSearch, feature: "propertyCheck" },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/workforce", label: "Workforce", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
] satisfies NavItem[]).filter((item) => !item.feature || niche.features[item.feature]);

// Self-serve labels, order, and feature gating live in the niche config
// (src/config/niche) — the white-label layer. Icons stay here, keyed by
// route, because they are structural rather than niche identity.
export const selfServeIcons: Record<string, NavIcon> = {
  "/self-serve": LayoutGrid,
  "/ad-studio": Star,
  "/results": LineChart,
  "/ad-radar": RadarIcon,
  "/property-check": FileSearch,
  "/leads": UsersRound,
  "/ad-studio/brand": UserRound,
  "/settings": Settings,
};

const selfServeNavItems: NavItem[] = niche.nav.items
  .filter((item) => !item.feature || niche.features[item.feature])
  .map((item) => ({
    href: item.href,
    label: item.label,
    icon: selfServeIcons[item.href] ?? LayoutGrid,
    section: item.section,
    feature: item.feature,
  }));

const monitorNavItems = ([
  { href: "/results", label: "Results", icon: LineChart },
  { href: "/ad-radar", label: "Ad Radar", icon: RadarIcon, feature: "adRadar" },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
] satisfies NavItem[]).filter((item) => !item.feature || niche.features[item.feature]);

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

export function SidebarNav({ variant }: { variant: SidebarVariant }) {
  const pathname = usePathname() ?? "";
  const navItems = navByVariant[variant];

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
