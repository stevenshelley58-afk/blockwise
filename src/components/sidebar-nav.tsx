"use client";

import {
  BarChart3,
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

export type SidebarVariant = "self_serve";

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

export const navByVariant: Record<SidebarVariant, NavItem[]> = {
  self_serve: selfServeNavItems,
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
