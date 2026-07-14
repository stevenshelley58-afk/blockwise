"use client";

import { Download, LogOut, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isItemActive, navByVariant, type NavItem, type SidebarVariant } from "@/components/sidebar-nav";

type MobileBottomNavProps = {
  variant: SidebarVariant;
  account: {
    email: string;
    name: string;
    role: string;
  };
};

type MobileNavItem = NavItem & {
  mobileLabel?: string;
};

const primaryHrefsByVariant: Record<SidebarVariant, string[]> = {
  monitor: ["/results", "/ad-radar", "/leads", "/settings"],
  self_serve: ["/ad-studio", "/ad-radar", "/results", "/leads"],
  operator: ["/operator", "/operator/email", "/operator/research"],
};

const mobileLabels: Record<string, string> = {
  "/operator/email": "Email",
  "/operator/research": "Research",
  "/model-control": "Model",
};

function mobileItemsForVariant(variant: SidebarVariant): { primaryItems: MobileNavItem[]; overflowItems: MobileNavItem[] } {
  const allItems = navByVariant[variant];
  const primaryHrefs = primaryHrefsByVariant[variant];
  const primaryItems = primaryHrefs
    .map((href) => allItems.find((item) => item.href === href))
    .filter((item): item is NavItem => Boolean(item))
    .map((item) => ({ ...item, mobileLabel: mobileLabels[item.href] }));
  const primaryHrefSet = new Set(primaryItems.map((item) => item.href));
  const overflowItems = allItems.filter((item) => !primaryHrefSet.has(item.href));

  return { primaryItems, overflowItems };
}

export function MobileBottomNav({ variant, account }: MobileBottomNavProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { primaryItems, overflowItems } = useMemo(() => mobileItemsForVariant(variant), [variant]);

  useEffect(() => {
    if (!moreOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMoreOpen(false);
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  if (pathname.startsWith("/ad-studio")) {
    return null;
  }

  async function signOut() {
    setIsSigningOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function requestInstallPrompt() {
    window.dispatchEvent(new CustomEvent("blockwise:install-app-request"));
    setMoreOpen(false);
  }

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Primary mobile navigation">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(pathname, item.href);

          return (
            <Link
              className={active ? "mobile-bottom-nav-item active" : "mobile-bottom-nav-item"}
              href={item.href}
              key={item.href}
              aria-current={active ? "page" : undefined}
            >
              <Icon aria-hidden size={21} />
              <span>{item.mobileLabel ?? item.label}</span>
            </Link>
          );
        })}
        <button
          className={moreOpen ? "mobile-bottom-nav-item active" : "mobile-bottom-nav-item"}
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-sheet"
        >
          <MoreHorizontal aria-hidden size={22} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen ? (
        <div className="mobile-more-overlay" role="presentation" onClick={() => setMoreOpen(false)}>
          <section
            className="mobile-more-sheet"
            id="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-head">
              <div>
                <strong>{account.name}</strong>
                <span>
                  {account.role} - {account.email}
                </span>
              </div>
              <button className="icon-button" type="button" onClick={() => setMoreOpen(false)} aria-label="Close more menu">
                <X aria-hidden size={18} />
              </button>
            </div>

            {overflowItems.length > 0 ? (
              <div className="mobile-more-links">
                {overflowItems.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(pathname, item.href);
                  return (
                    <Link
                      className={active ? "mobile-more-link active" : "mobile-more-link"}
                      href={item.href}
                      key={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                    >
                      <Icon aria-hidden size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}

            <div className="mobile-more-actions">
              <button className="mobile-more-action" type="button" onClick={requestInstallPrompt}>
                <Download aria-hidden size={18} />
                Install app
              </button>
              <button className="mobile-more-action danger" type="button" onClick={() => void signOut()} disabled={isSigningOut}>
                <LogOut aria-hidden size={18} />
                {isSigningOut ? "Signing out" : "Sign out"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
