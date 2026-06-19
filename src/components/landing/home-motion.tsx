"use client";

import { useEffect } from "react";

/**
 * Progressive-enhancement animations for the homepage (scoped to `.bwx`):
 * scroll-reveal, KPI count-up, and the how-it-works figure draw-in. Renders
 * nothing; runs once on mount. Respects prefers-reduced-motion.
 */
export function HomeMotion() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.querySelector(".bwx");
    if (!root) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("anim");
    const observers: IntersectionObserver[] = [];

    const reveal = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); reveal.unobserve(e.target); } });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    root.querySelectorAll(".reveal, .stagger").forEach((el) => reveal.observe(el));
    observers.push(reveal);

    function countUp(el: Element) {
      const node = el as HTMLElement;
      const target = parseFloat(node.dataset.count || "0");
      const dec = parseInt(node.dataset.decimals || "0", 10);
      const pre = node.dataset.prefix || "", suf = node.dataset.suffix || "";
      const dur = 1100, t0 = performance.now();
      const fmt = (v: number) => pre + v.toLocaleString("en-AU", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
      (function tick(t: number) {
        const p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
        node.textContent = fmt(target * eased);
        if (p < 1) requestAnimationFrame(tick); else node.textContent = fmt(target);
      })(t0);
    }
    const counters = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { countUp(e.target); counters.unobserve(e.target); } });
    }, { threshold: 0.6 });
    root.querySelectorAll(".count").forEach((el) => counters.observe(el));
    observers.push(counters);

    const fig = root.querySelector("#bFig");
    if (fig) {
      let done = false;
      const cnt = (el: Element | null, to: number, pre: string) => {
        if (!el) return; let s: number | null = null;
        const f = (t: number) => { if (s === null) s = t; const p = Math.min((t - s) / 1100, 1); (el as HTMLElement).textContent = (pre || "") + Math.round(p * to); if (p < 1) requestAnimationFrame(f); };
        requestAnimationFrame(f);
      };
      const io = new IntersectionObserver((es) => {
        es.forEach((e) => {
          if (e.isIntersecting && !done) {
            done = true; fig.classList.add("play");
            cnt(fig.querySelector("#bLeads"), 47, "");
            cnt(fig.querySelector("#bCpl"), 13, "$");
          }
        });
      }, { threshold: 0.3 });
      io.observe(fig); observers.push(io);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);
  return null;
}
