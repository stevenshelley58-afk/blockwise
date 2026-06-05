"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { isTrackablePath } from "@/lib/analytics/events";

/**
 * Fires a first-party page-view beacon to /api/track on every client
 * navigation. Cookie-free and best-effort: failures are swallowed so
 * analytics can never affect navigation.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTracked.current === pathname || !isTrackablePath(pathname)) return;
    lastTracked.current = pathname;

    const payload = JSON.stringify({ path: pathname, referrer: document.referrer || null });
    try {
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        void fetch("/api/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      }
    } catch {
      // Best-effort only.
    }
  }, [pathname]);

  return null;
}
