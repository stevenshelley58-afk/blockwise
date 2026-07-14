"use client";

import { useEffect } from "react";

/**
 * Scroll-reveal driver for the homepage. Ports the handoff prototype's
 * behaviour exactly: elements marked `[data-reveal]` start hidden (CSS) and
 * get `data-in="1"` once they intersect the viewport (reveal once, never
 * re-hide). Includes the prototype's belt-and-braces paths so content is
 * never left invisible: reduced motion, hidden documents, and throttled /
 * non-rendering contexts all reveal immediately.
 */
export function RevealObserver() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (els.length === 0) return;

    const revealAll = () => els.forEach((el) => el.setAttribute("data-in", "1"));

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      revealAll();
      return;
    }
    if (document.visibilityState === "hidden") {
      revealAll();
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      revealAll();
      return;
    }

    // If rAF hasn't ticked within 500ms we're throttled or not rendering —
    // reveal everything rather than risk a blank page.
    let rafTicked = false;
    const raf = requestAnimationFrame(() => {
      rafTicked = true;
    });
    const fallback = window.setTimeout(() => {
      if (!rafTicked) revealAll();
    }, 500);

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-in", "1");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      io.disconnect();
    };
  }, []);

  return null;
}
