"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";

const LIKELY_ROUTES: Record<string, readonly string[]> = {
  "/self-serve": ["/ad-studio", "/results"],
  "/ad-studio": ["/ad-studio/library", "/results"],
  "/results": ["/leads", "/ad-studio"],
  "/settings": ["/self-serve", "/ad-studio"],
};

type NetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

function canPrefetch(): boolean {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
  const navigatorWithHints = navigator as Navigator & {
    connection?: NetworkInformation;
    deviceMemory?: number;
  };
  const connection = navigatorWithHints.connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return false;
  if ((navigatorWithHints.deviceMemory ?? 4) <= 2) return false;
  return (navigator.hardwareConcurrency ?? 4) > 2;
}

export function useSmartPrefetch(): {
  prefetchNow: (href: string) => void;
} {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const prefetchNow = useCallback(
    (href: string) => {
      if (!canPrefetch() || !href.startsWith("/")) return;
      router.prefetch(href);
    },
    [router],
  );

  useEffect(() => {
    if (!canPrefetch()) return;
    const exactPath = Object.keys(LIKELY_ROUTES)
      .sort((a, b) => b.length - a.length)
      .find((path) => pathname === path || pathname.startsWith(`${path}/`));
    const routes = exactPath ? LIKELY_ROUTES[exactPath]?.slice(0, 2) ?? [] : [];
    if (routes.length === 0) return;

    const run = () => {
      if (!canPrefetch()) return;
      for (const route of routes) router.prefetch(route);
    };
    const browser = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (browser.requestIdleCallback) {
      const id = browser.requestIdleCallback(run, { timeout: 2_000 });
      return () => browser.cancelIdleCallback?.(id);
    }
    const timeout = window.setTimeout(run, 1_000);
    return () => window.clearTimeout(timeout);
  }, [pathname, router]);

  return { prefetchNow };
}
