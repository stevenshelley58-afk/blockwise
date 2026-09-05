"use client";

import {
  BarChart3,
  Bot,
  Database,
  FileSearch,
  LayoutGrid,
  LineChart,
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
import { activeRouteHref } from "@/lib/navigation/active-nav-item";

export type SidebarVariant = "operator" | "self_serve" | "monitor";

type NavIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" | "false" }>;

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  mobileLabel?: string;
  /** Optional grouping label rendered above the item (starts a new section). */
  section?: string;
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

const operatorNavItems: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutGrid },
  { href: "/operator/customers", label: "Customers", icon: ContactRound },
  { href: "/operator/analytics", label: "Site Analytics", icon: BarChart3 },
  { href: "/operator/database", label: "Database", icon: Database },
  { href: "/results", label: "Results", icon: LineChart },
  { href: "/ad-radar", label: "Ad Radar", icon: RadarIcon },
  { href: "/ad-studio", label: "Ad Studio", icon: Star },
  { href: "/property-check", label: "Property Check", icon: FileSearch },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/workforce", label: "Workforce", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
].filter((item) => {
  if (item.href === "/ad-radar") return niche.features.adRadar;
  if (item.href === "/property-check") return niche.features.propertyCheck;
  return true;
});

const customerToolIcons = {
  home: LayoutGrid,
  studio: Star,
  performance: LineChart,
  radar: RadarIcon,
  property: FileSearch,
  leads: UsersRound,
  brand: UserRound,
  settings: Settings,
} satisfies Record<(typeof niche.nav.items)[number]["icon"], NavIcon>;

const selfServeNavItems: NavItem[] = niche.nav.items
  .filter((item) => !item.feature || niche.features[item.feature])
  .map((item) => ({
    href: item.href,
    label: item.label,
    icon: customerToolIcons[item.icon],
    mobileLabel: item.mobileLabel,
    section: item.section,
  }));

const monitorNavItems: NavItem[] = [
  { href: "/results", label: "Results", icon: LineChart },
  { href: "/ad-radar", label: "Ad Radar", icon: RadarIcon },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
].filter((item) => item.href !== "/ad-radar" || niche.features.adRadar);

export const navByVariant: Record<SidebarVariant, NavItem[]> = {
  operator: operatorNavItems,
  self_serve: selfServeNavItems,
  monitor: monitorNavItems,
};

export function isItemActive(pathname: string, href: string, items: readonly NavItem[]) {
  return activeRouteHref(pathname, items) === href;
}

export function SidebarNav({ variant }: { variant: SidebarVariant }) {
  const pathname = usePathname() ?? "";
  const navItems = navByVariant[variant];

  let lastSection: string | undefined;

  return (
    <nav className="nav-group">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isItemActive(pathname, item.href, navItems);
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
