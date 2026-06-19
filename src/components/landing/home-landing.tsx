"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

/**
 * Blockwise marketing homepage — "local signal -> leads" design.
 * Ported from the approved design prototype into the real Next.js homepage and
 * wired to live flows: Start free -> /signup (CtaLink), Log in -> /login,
 * Pricing -> /pricing (real single $799/mo plan), demo -> mailto. The hero
 * search is an in-page demo over a snapshot of real approved ads; "Use this ad"
 * -> /signup. All styling is scoped under `.bwx` (src/app/home-redesign.css).
 */

type Ad = {
  suburb: string; postcode: string; angle: string; headline: string;
  offer: string; cta: string; status: "approved" | "draft";
  platform: "Facebook" | "Instagram"; days: number; grad: string;
};

const SUBURBS = [
  { name: "Spearwood", postcode: "6163" },
  { name: "Canning Vale", postcode: "6155" },
  { name: "Scarborough", postcode: "6019" },
  { name: "South Perth", postcode: "6151" },
];

const ADS: Ad[] = [
  {suburb:"Spearwood",postcode:"6163",angle:"Free appraisal",headline:"Local Selling Plan for Spearwood",offer:"What is your home worth in today's market?",cta:"Learn more",status:"approved",platform:"Facebook",days:1,grad:"g1"},
  {suburb:"Spearwood",postcode:"6163",angle:"Free appraisal",headline:"Get a local selling plan",offer:"What is your home worth in today's market?",cta:"Learn more",status:"draft",platform:"Instagram",days:1,grad:"g3"},
  {suburb:"Spearwood",postcode:"6163",angle:"Market update",headline:"Spearwood Market Report Q2 2026",offer:"Free suburb market report",cta:"Download",status:"approved",platform:"Facebook",days:1,grad:"g5"},
  {suburb:"Spearwood",postcode:"6163",angle:"Market update",headline:"Free Spearwood Market Report Q2 2026",offer:"Free suburb market report",cta:"Download",status:"approved",platform:"Instagram",days:1,grad:"g6"},
  {suburb:"Spearwood",postcode:"6163",angle:"Market update",headline:"Spearwood market update, April 2026",offer:"Free suburb market report",cta:"Download",status:"draft",platform:"Facebook",days:1,grad:"g2"},
  {suburb:"Spearwood",postcode:"6163",angle:"Investor",headline:"Investor Snapshot: Spearwood",offer:"Investor suburb snapshot",cta:"Learn more",status:"approved",platform:"Facebook",days:1,grad:"g4"},
  {suburb:"Spearwood",postcode:"6163",angle:"Coming soon",headline:"Coming soon: Spearwood family home",offer:"Free appraisal",cta:"Contact us",status:"draft",platform:"Instagram",days:2,grad:"g1"},
  {suburb:"Spearwood",postcode:"6163",angle:"Coming soon",headline:"Free Spearwood house appraisal",offer:"Free appraisal",cta:"Contact us",status:"approved",platform:"Facebook",days:2,grad:"g3"},
  {suburb:"Spearwood",postcode:"6163",angle:"Just listed",headline:"Find your Spearwood home value",offer:"What is your home worth in today's market?",cta:"Learn more",status:"approved",platform:"Facebook",days:7,grad:"g5"},
  {suburb:"Spearwood",postcode:"6163",angle:"Seller checklist",headline:"Spearwood Seller Checklist",offer:"Top things to do before selling",cta:"Download",status:"draft",platform:"Instagram",days:7,grad:"g6"},
  {suburb:"Spearwood",postcode:"6163",angle:"Just listed",headline:"A fresh local listing to watch",offer:"What is your home worth in today's market?",cta:"Request price update",status:"draft",platform:"Instagram",days:9,grad:"g2"},
  {suburb:"Spearwood",postcode:"6163",angle:"Market update",headline:"Spearwood market report ready",offer:"Free suburb market report",cta:"Get the report",status:"approved",platform:"Facebook",days:1,grad:"g4"},
  {suburb:"Canning Vale",postcode:"6155",angle:"Seller checklist",headline:"Plan your Canning Vale sale",offer:"Local seller planning guide",cta:"Download checklist",status:"approved",platform:"Facebook",days:1,grad:"g6"},
  {suburb:"Canning Vale",postcode:"6155",angle:"Pre-sale prep",headline:"Know what to fix before you sell",offer:"Free pre-sale preparation checklist",cta:"Download checklist",status:"approved",platform:"Instagram",days:1,grad:"g1"},
  {suburb:"Canning Vale",postcode:"6155",angle:"Appraisal prep",headline:"Get appraisal-ready faster",offer:"Seven-day appraisal prep plan",cta:"Download checklist",status:"approved",platform:"Facebook",days:1,grad:"g3"},
  {suburb:"Canning Vale",postcode:"6155",angle:"Seller checklist",headline:"Top 10 prep tips for Canning Vale sellers",offer:"Top 10 things to do before selling",cta:"Download checklist",status:"approved",platform:"Instagram",days:1,grad:"g5"},
  {suburb:"Canning Vale",postcode:"6155",angle:"Seller checklist",headline:"Top 10 seller tasks in Canning Vale",offer:"Top 10 things to do before selling",cta:"Download checklist",status:"draft",platform:"Facebook",days:1,grad:"g2"},
  {suburb:"Scarborough",postcode:"6019",angle:"Seller checklist",headline:"Seller checklist for Scarborough homeowners",offer:"Top 10 things to do before selling",cta:"Download checklist",status:"draft",platform:"Facebook",days:14,grad:"g4"},
  {suburb:"Scarborough",postcode:"6019",angle:"Market update",headline:"Plan your sale with local context",offer:"Top 10 things to do before selling",cta:"Download checklist",status:"draft",platform:"Instagram",days:14,grad:"g6"},
  {suburb:"Scarborough",postcode:"6019",angle:"Seller checklist",headline:"Selling soon? Start with this checklist",offer:"Top 10 things to do before selling",cta:"Download checklist",status:"draft",platform:"Facebook",days:14,grad:"g1"},
  {suburb:"South Perth",postcode:"6151",angle:"Seller checklist",headline:"Seller checklist for South Perth homeowners",offer:"What is your home worth in today's market?",cta:"Request price update",status:"draft",platform:"Facebook",days:13,grad:"g3"},
  {suburb:"South Perth",postcode:"6151",angle:"Pre-sale prep",headline:"Small prep can improve buyer interest",offer:"What is your home worth in today's market?",cta:"Request price update",status:"draft",platform:"Instagram",days:13,grad:"g5"},
  {suburb:"South Perth",postcode:"6151",angle:"Pre-sale prep",headline:"Before you list, fix these 10 things",offer:"What is your home worth in today's market?",cta:"Request price update",status:"approved",platform:"Facebook",days:13,grad:"g6"},
];

const ANGLES = [...new Set(ADS.map((a) => a.angle))];
const PAGE = 12;

const INCLUDED = [
  "Up to 10 ad packs per month",
  "Campaign builder (Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand, Market Update)",
  "Meta ad account connection",
  "Team approval workflow",
  "Live performance reporting",
  "Email support",
];

const FIG_SVG = `<svg viewBox="0 0 1500 360" role="img" aria-label="Scan the suburb, prepare the campaign, leads come in"><defs><linearGradient id="bRail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f97ff"/><stop offset=".5" stop-color="#2fd2c2"/><stop offset="1" stop-color="#9a7fff"/></linearGradient><linearGradient id="bC1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f97ff"/><stop offset="1" stop-color="#1f5fd6"/></linearGradient><linearGradient id="bC2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd2c2"/><stop offset="1" stop-color="#10a294"/></linearGradient><linearGradient id="bSweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fd2c2" stop-opacity="0"/><stop offset="1" stop-color="#2fd2c2" stop-opacity=".5"/></linearGradient><filter id="bShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="9" stdDeviation="12" flood-color="#1f3a7a" flood-opacity="0.10"/></filter></defs><line x1="250" y1="180" x2="1290" y2="180" stroke="#dde3ee" stroke-width="2" stroke-dasharray="2 9"/><path id="bSig" class="bSig" d="M250,180 C430,90 560,90 700,180 S950,270 1100,180 1230,120 1290,150" pathLength="1" fill="none" stroke="url(#bRail)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle r="6" fill="#1fb3a6" opacity=".9"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href="#bSig"/></animateMotion></circle><circle cx="300" cy="180" r="102" fill="#fff" filter="url(#bShadow)"/><circle cx="300" cy="180" r="86" fill="none" stroke="#2fbfb0" stroke-opacity="0.22" stroke-width="2.2"/><circle cx="300" cy="180" r="53" fill="none" stroke="#2fbfb0" stroke-opacity="0.32" stroke-width="2.2"/><circle cx="300" cy="180" r="26" fill="none" stroke="#2fbfb0" stroke-opacity="0.44" stroke-width="2.2"/><path d="M300,180 L346,107 A86,86 0 0,1 386,183 Z" fill="url(#bSweep)"><animateTransform attributeName="transform" type="rotate" from="0 300 180" to="360 300 180" dur="5s" repeatCount="indefinite"/></path><circle class="bBlip" cx="318" cy="115" r="5" fill="#1f6feb"/><circle class="bBlip" cx="237" cy="192" r="5" fill="#1f6feb"/><circle cx="300" cy="180" r="5" fill="#2fbfb0"/><rect x="678" y="108" width="144" height="144" rx="28" fill="#fff" filter="url(#bShadow)"/><rect x="698" y="126" width="104" height="42" rx="10" fill="url(#bC1)"/><rect x="698" y="178" width="104" height="8" rx="4" fill="#e3e7ee"/><rect x="698" y="192" width="70" height="8" rx="4" fill="#eaedf2"/><rect x="698" y="212" width="60" height="20" rx="10" fill="url(#bC2)"/><text x="728" y="226" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Ready</text><rect x="1080" y="102" width="240" height="156" rx="22" fill="#fff" filter="url(#bShadow)"/><text x="1102" y="134" font-size="13" font-weight="700" letter-spacing="1" fill="#8a90a0">LAST 7 DAYS</text><circle cx="1262" cy="129" r="5" fill="#23a35e"/><text x="1274" y="134" font-size="12.5" font-weight="700" fill="#23a35e">Live</text><text id="bLeads" x="1102" y="188" font-size="40" font-weight="800" fill="#0f1115">0</text><text x="1102" y="212" font-size="14" fill="#6b7280">leads</text><line x1="1196" y1="152" x2="1196" y2="214" stroke="#eef0f4" stroke-width="2"/><text id="bCpl" x="1218" y="188" font-size="40" font-weight="800" fill="#0f1115">$0</text><text x="1218" y="212" font-size="14" fill="#6b7280">cost / lead</text><path class="bSpark" d="M1102,237 L1124,233 L1146,235 L1168,227 L1190,229 L1212,221 L1234,223" pathLength="1" fill="none" stroke="#1fb3a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="1234" cy="223" r="4" fill="#1fb3a6"/></svg>`;
const CHART_SVG = `<svg viewBox="0 0 600 210" role="img" aria-label="Leads over the last 7 days, trending up"><defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6feb" stop-opacity=".20"/><stop offset="1" stop-color="#1f6feb" stop-opacity="0"/></linearGradient></defs><line x1="40" y1="20" x2="568" y2="20" stroke="#eef0f3"/><line x1="40" y1="95" x2="568" y2="95" stroke="#eef0f3"/><line x1="40" y1="170" x2="568" y2="170" stroke="#eef0f3"/><path d="M40,128 L128,108 L216,116 L304,82 L392,90 L480,52 L568,33 L568,170 L40,170 Z" fill="url(#leadFill)"/><polyline points="40,128 128,108 216,116 304,82 392,90 480,52 568,33" fill="none" stroke="#1f6feb" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="568" cy="33" r="5" fill="#fff" stroke="#1f6feb" stroke-width="2.6"/><g fill="#9aa0aa" font-size="11" font-family="inherit" text-anchor="middle"><text x="40" y="196">Mon</text><text x="128" y="196">Tue</text><text x="216" y="196">Wed</text><text x="304" y="196">Thu</text><text x="392" y="196">Fri</text><text x="480" y="196">Sat</text><text x="568" y="196">Sun</text></g></svg>`;

type Entity = { type: string; value: string; label: string; sub: string };
type Suggestion = { type: "suburb" | "postcode" | "angle"; label: string; sub: string; value: string; count: number };

function searchIndex(qRaw: string): Suggestion[] {
  const q = qRaw.trim().toLowerCase();
  if (!q) return [];
  const out: Suggestion[] = [];
  SUBURBS.forEach((s) => {
    if (s.name.toLowerCase().includes(q) || s.postcode.startsWith(q))
      out.push({ type: "suburb", label: s.name, sub: s.postcode + " · WA", value: s.name, count: ADS.filter((a) => a.suburb === s.name).length });
  });
  SUBURBS.forEach((s) => {
    if (s.postcode.startsWith(q) && !out.find((o) => o.value === s.name))
      out.push({ type: "postcode", label: s.postcode, sub: s.name + " · WA", value: s.postcode, count: ADS.filter((a) => a.postcode === s.postcode).length });
  });
  ANGLES.forEach((a) => {
    if (a.toLowerCase().includes(q))
      out.push({ type: "angle", label: a, sub: "Ad angle", value: a, count: ADS.filter((x) => x.angle === a).length });
  });
  return out.slice(0, 8);
}

function fetchAds(entity: Entity): Ad[] {
  return ADS.filter((ad) => {
    if (entity.type === "suburb") return ad.suburb === entity.value;
    if (entity.type === "postcode") return ad.postcode === entity.value;
    if (entity.type === "angle") return ad.angle === entity.value;
    const t = entity.value.toLowerCase();
    return [ad.suburb, ad.postcode, ad.angle, ad.headline].join(" ").toLowerCase().includes(t);
  });
}

function Check() {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="m5 13 4 4L19 7" /></svg>);
}
function PlatIcon({ platform }: { platform: Ad["platform"] }) {
  if (platform === "Facebook")
    return (<svg viewBox="0 0 24 24" fill="#1877f2"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" /></svg>);
  return (<svg viewBox="0 0 24 24" fill="none" stroke="#c13584" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1.2" fill="#c13584" stroke="none" /></svg>);
}
function TypeIcon({ type }: { type: Suggestion["type"] }) {
  if (type === "suburb") return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>);
  if (type === "postcode") return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>);
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M20.6 13.4 11 3.8H4v7l9.6 9.6a2 2 0 0 0 2.8 0l4.2-4.2a2 2 0 0 0 0-2.8Z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>);
}
const GROUP_LABEL: Record<string, string> = { suburb: "Suburbs", postcode: "Postcodes", angle: "Ad angles" };

export function HomeLanding() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [showAC, setShowAC] = useState(false);
  const [active, setActive] = useState(-1);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [angleFilter, setAngleFilter] = useState("All");
  const [platformFilter, setPlatformFilter] = useState("All");
  const [sortMode, setSortMode] = useState("recommended");
  const [shown, setShown] = useState(PAGE);
  const [toast, setToast] = useState<string | null>(null);

  const suggestions = useMemo(() => searchIndex(q), [q]);

  const runSearch = useCallback((e: Entity) => {
    setEntity(e); setAngleFilter("All"); setPlatformFilter("All");
    setSortMode("recommended"); setShown(PAGE); setShowAC(false); setActive(-1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const choose = useCallback((item: Suggestion) => {
    setQ(item.label);
    runSearch({ type: item.type, value: item.value, label: item.label, sub: item.sub });
  }, [runSearch]);

  function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (active >= 0 && suggestions[active]) return choose(suggestions[active]);
    if (suggestions.length) return choose(suggestions[0]);
    if (q.trim()) runSearch({ type: "text", value: q.trim(), label: q.trim(), sub: "Matching ads" });
  }
  function onKeyDown(ev: React.KeyboardEvent) {
    if (!showAC || !suggestions.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((n) => (n + 1 + suggestions.length) % suggestions.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((n) => (n - 1 + suggestions.length) % suggestions.length); }
    else if (ev.key === "Enter" && active >= 0) { ev.preventDefault(); choose(suggestions[active]); }
    else if (ev.key === "Escape") { setShowAC(false); }
  }
  function back() {
    setEntity(null); setQ(""); setShowAC(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }

  const filtered = useMemo(() => {
    if (!entity) return [];
    let ads = fetchAds(entity);
    if (angleFilter !== "All") ads = ads.filter((a) => a.angle === angleFilter);
    if (platformFilter !== "All") ads = ads.filter((a) => a.platform === platformFilter);
    if (sortMode === "newest") ads = [...ads].sort((a, b) => a.days - b.days);
    else if (sortMode === "longest") ads = [...ads].sort((a, b) => b.days - a.days);
    else if (sortMode === "angle") ads = [...ads].sort((a, b) => ANGLES.indexOf(a.angle) - ANGLES.indexOf(b.angle));
    return ads;
  }, [entity, angleFilter, platformFilter, sortMode]);

  const baseForEntity = useMemo(() => (entity ? fetchAds(entity) : []), [entity]);
  const angleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    baseForEntity.forEach((a) => { c[a.angle] = (c[a.angle] || 0) + 1; });
    return c;
  }, [baseForEntity]);

  const summary = useMemo(() => {
    if (!filtered.length) return null;
    const byAngle: Record<string, number> = {}; let fb = 0;
    filtered.forEach((a) => { byAngle[a.angle] = (byAngle[a.angle] || 0) + 1; if (a.platform === "Facebook") fb++; });
    const top = Object.entries(byAngle).sort((a, b) => b[1] - a[1])[0];
    return { total: filtered.length, topAngle: top[0], topCount: top[1], fbPct: Math.round((fb / filtered.length) * 100) };
  }, [filtered]);

  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    if (typeof window === "undefined") return;
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
  }, [entity]);

  return (
    <div className="bwx" ref={rootRef}>
      <header className="nav">
        <Link className="brand" href="/"><span className="mark" />blockwise</Link>
        <nav className="nav__links">
          <a href="#how">How it works</a>
          <Link href="/pricing">Pricing</Link>
          <a href="#dash">Examples</a>
        </nav>
        <div className="nav__cta">
          <span className="nav__login"><SignInLink /></span>
          <CtaLink location="nav" href="/signup" className="btn btn--ink btn--sm">Start free</CtaLink>
        </div>
      </header>

      <main className="wrap">
        {!entity && (
        <div id="landing">
          <section className="hero stagger">
            <span className="eyebrow"><span className="dot" /> Meta ads for real estate agents</span>
            <h1>See every ad running in your suburb.</h1>
            <p className="sub">Ads built from what&rsquo;s actually working in your area. Start getting leads today.</p>

            <div className="searchwrap">
              <form className="searchbar" onSubmit={onSubmit} autoComplete="off" role="search" onFocusCapture={() => { if (q.trim()) setShowAC(true); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  type="text"
                  placeholder="Enter a suburb, postcode, agent or agency"
                  aria-label="Search by suburb, postcode, agent or agency"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setShowAC(!!e.target.value.trim()); setActive(-1); }}
                  onKeyDown={onKeyDown}
                  onBlur={() => window.setTimeout(() => setShowAC(false), 120)}
                />
                <button className="btn btn--ink" type="submit">Show me the ads</button>
              </form>
              <div className={"ac" + (showAC && q.trim() ? " is-open" : "")} role="listbox" aria-label="Search suggestions">
                {q.trim() && suggestions.length === 0 && (
                  <div className="ac__empty">No matches yet — try a suburb like &ldquo;Spearwood&rdquo;, a postcode, or an angle.</div>
                )}
                {suggestions.map((item, i) => {
                  const prev = suggestions[i - 1];
                  return (
                    <div key={item.type + item.value}>
                      {(!prev || prev.type !== item.type) && <div className="ac__group">{GROUP_LABEL[item.type]}</div>}
                      <div className={"ac__item" + (i === active ? " is-active" : "")} role="option" aria-selected={i === active}
                        onMouseDown={(e) => { e.preventDefault(); choose(item); }}>
                        <span className="ac__ico"><TypeIcon type={item.type} /></span>
                        <span className="ac__txt"><b>{item.label}</b><span>{item.sub}</span></span>
                        <span className="ac__count">{item.count} ads</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="trial">7-day trial · 10 ad packs · <b>No card required</b></p>

            <div className="adrow" aria-label="Example real estate ads">
              <figure className="adcard"><div className="adcard__img g1"><span className="tag">Spearwood</span></div><figcaption><b>Local Selling Plan for Spearwood</b><span>Free appraisal</span></figcaption></figure>
              <figure className="adcard"><div className="adcard__img g3"><span className="tag">Canning Vale</span></div><figcaption><b>Plan your Canning Vale sale</b><span>Local seller planning guide</span></figcaption></figure>
              <figure className="adcard"><div className="adcard__img g5"><span className="tag">South Perth</span></div><figcaption><b>Before you list, fix these 10 things</b><span>What is your home worth in today&rsquo;s market?</span></figcaption></figure>
            </div>
            <p className="adrow__note"><span className="count" data-count="23">23</span> ads built across 4 Perth suburbs</p>
          </section>

          <section className="how" id="how">
            <div className="how__head reveal">
              <span className="eyebrow"><span className="dot" /> How it works</span>
              <h2>From local signal to real leads.</h2>
              <p className="how__sub">We scan the area, prepare the campaign, and the leads come in.</p>
            </div>
            <div className="how-fig reveal" id="bFig" dangerouslySetInnerHTML={{ __html: FIG_SVG }} />
            <ol className="how__steps2 reveal">
              <li className="how__s"><b><em className="e1">1</em> Scan</b><p>See local lead angles.</p></li>
              <li className="how__s"><b><em className="e2">2</em> Prepared</b><p>Blockwise prepares the campaign.</p></li>
              <li className="how__s"><b><em className="e3">3</em> Leads</b><p>Approve, run, and track results.</p></li>
            </ol>
          </section>

          <section className="dash" id="dash">
            <div className="dash__head reveal">
              <span className="eyebrow"><span className="dot" /> Live dashboard</span>
              <h2>Finally understand what your ads are doing.</h2>
              <p className="lead">Leads, spend and clicks in one clean view — updated live. No spreadsheets, no digging through Meta Ads Manager.</p>
            </div>
            <div className="board reveal">
              <div className="board__bar">
                <div className="board__title">Campaign performance <span className="board__live"><i /> Live</span></div>
                <div className="board__range">
                  <button type="button" aria-pressed="true">7d</button>
                  <button type="button" aria-pressed="false">30d</button>
                  <button type="button" aria-pressed="false">90d</button>
                </div>
              </div>
              <div className="kpis stagger">
                <div className="kpi"><div className="kpi__k">Leads</div><div className="kpi__v"><span className="count" data-count="47">47</span></div><span className="delta">▲ 18% vs last week</span></div>
                <div className="kpi"><div className="kpi__k">Ad spend</div><div className="kpi__v"><span className="count" data-count="612" data-prefix="$">$612</span></div><span className="delta delta--muted">$25 / day · on track</span></div>
                <div className="kpi"><div className="kpi__k">Clicks</div><div className="kpi__v"><span className="count" data-count="1940">1,940</span></div><span className="delta">▲ 9% vs last week</span></div>
                <div className="kpi"><div className="kpi__k">Cost per lead</div><div className="kpi__v"><span className="count" data-count="13.02" data-prefix="$" data-decimals="2">$13.02</span></div><span className="delta">▼ 6% — cheaper</span></div>
              </div>
              <div className="board__chart" dangerouslySetInnerHTML={{ __html: CHART_SVG }} />
              <div className="chart-legend">
                <span><i style={{ background: "#1f6feb" }} /> Leads this week</span>
                <span><i style={{ background: "#dfe3e8" }} /> Previous week</span>
              </div>
              <div className="camps">
                <div className="crow crow--head"><span>Campaign</span><span>Status</span><span className="crow__num">Leads</span><span className="crow__num crow__spend">Spend</span></div>
                <div className="crow"><span className="crow__name">Mt Lawley · Free appraisal</span><span className="cstatus cstatus--active"><i /> Active</span><span className="crow__num">18</span><span className="crow__num crow__spend">$324</span></div>
                <div className="crow"><span className="crow__name">Subiaco · Just listed</span><span className="cstatus cstatus--active"><i /> Active</span><span className="crow__num">11</span><span className="crow__num crow__spend">$210</span></div>
                <div className="crow"><span className="crow__name">Cottesloe · Open home</span><span className="cstatus cstatus--paused"><i /> Paused</span><span className="crow__num">7</span><span className="crow__num crow__spend">$98</span></div>
              </div>
            </div>
          </section>

          <section className="trust">
            <div className="trust__grid">
              <div className="trust__copy reveal">
                <span className="eyebrow"><span className="dot" /> Approval &amp; control</span>
                <h2>Nothing spends until you say so.</h2>
                <p className="lead">Blockwise builds the ad — you approve it. You stay in control of every dollar, every claim and every campaign.</p>
                <ul className="checks stagger">
                  <li><Check /> Approve every ad before it goes live</li>
                  <li><Check /> Runs through your own Meta ad account</li>
                  <li><Check /> You set the budget and the schedule</li>
                  <li><Check /> Claims &amp; brand checked before sign-off</li>
                </ul>
              </div>
              <aside className="approve reveal" aria-label="Ad pending your approval">
                <div className="approve__top"><span>Ready for your approval</span><span className="approve__tag">1 pending</span></div>
                <div className="approve__ad">
                  <div className="approve__img g3" />
                  <div className="approve__adtxt"><b>Free appraisal · Mount Lawley</b><span>What&rsquo;s your home worth in today&rsquo;s market? Free, no-obligation appraisal.</span></div>
                </div>
                <div className="approve__rows">
                  <div><span>Budget</span><b>$25 / day</b></div>
                  <div><span>Audience</span><b>Mount Lawley · 8 km</b></div>
                  <div><span>Billed to</span><b>Your Meta account</b></div>
                </div>
                <div className="approve__btns">
                  <CtaLink location="approve-card" href="/signup" className="btn btn--ink">Approve &amp; launch</CtaLink>
                  <CtaLink location="approve-card-edit" href="/signup" className="btn btn--ghost">Edit</CtaLink>
                </div>
                <p className="approve__note">Ad spend is billed by Meta directly to your account — never to Blockwise.</p>
              </aside>
            </div>
          </section>

          <section className="pricing" id="pricing">
            <div className="pricing__head reveal">
              <span className="eyebrow"><span className="dot" /> Pricing</span>
              <h2>Simple pricing. Cancel anytime.</h2>
              <p className="lead">One plan, everything included. Start with a free 7-day trial and 10 ad packs — your ad spend is always separate and paid to Meta.</p>
            </div>
            <div className="ptiers stagger" style={{ gridTemplateColumns: "minmax(0,460px)", justifyContent: "center" }}>
              <div className="ptier ptier--pop">
                <span className="ptier__badge">Everything included</span>
                <div className="ptier__name">Blockwise</div>
                <div className="ptier__price">$799<em> /mo</em></div>
                <div className="ptier__per">Then $799/month · less than half a typical agency retainer</div>
                <p className="ptier__desc">For real estate teams who want local Meta ads running — built, approved and tracked — without opening Ads Manager.</p>
                <CtaLink location="pricing" href="/signup" className="btn btn--ink">Start free — no card</CtaLink>
                <ul className="plist">
                  {INCLUDED.map((item) => (<li key={item}><Check /> {item}</li>))}
                </ul>
                <Link href="/pricing" className="btn btn--ghost" style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>See full pricing</Link>
              </div>
            </div>
            <p className="pricing__note">7-day free trial · 10 free ad packs · No card required · Ad spend paid separately to Meta</p>
          </section>

          <section className="cta reveal">
            <span className="eyebrow"><span className="dot" /> Get started</span>
            <h2>See what&rsquo;s running in your suburb today.</h2>
            <p>Search your area free, see the live ads, and build your first campaign in minutes.</p>
            <div className="cta__btns">
              <CtaLink location="closing" href="/signup" className="btn btn--white">Start free — no card</CtaLink>
              <a className="btn btn--outline" href="mailto:hello@blockwise.sale?subject=Blockwise%20demo">Book a 15-min demo</a>
            </div>
          </section>
        </div>
        )}

        {entity && (
          <section className="results is-open" aria-live="polite">
            <div className="results__head">
              <div>
                <div className="results__title">{filtered.length} {filtered.length === 1 ? "ad" : "ads"} {entity.type === "angle" ? "·" : entity.type === "text" ? "for" : "in"} <em>{entity.label}</em></div>
                <div className="results__sub">{entity.sub || "From your ad library"}</div>
              </div>
              <button className="results__back" type="button" onClick={back}>← New search</button>
            </div>

            <div className="filters">
              <button className="chip" type="button" aria-pressed={angleFilter === "All"} onClick={() => { setAngleFilter("All"); setShown(PAGE); }}>All angles</button>
              {ANGLES.filter((a) => angleCounts[a]).map((a) => (
                <button key={a} className="chip" type="button" aria-pressed={angleFilter === a} onClick={() => { setAngleFilter(a); setShown(PAGE); }}>{a} <span style={{ opacity: 0.55 }}>{angleCounts[a]}</span></button>
              ))}
            </div>
            <div className="filters filters--platform">
              {["All", "Facebook", "Instagram"].map((p) => (
                <button key={p} className="chip" type="button" aria-pressed={platformFilter === p} onClick={() => { setPlatformFilter(p); setShown(PAGE); }}>{p === "All" ? "All platforms" : p}</button>
              ))}
            </div>

            <div className="resbar">
              <div className="summary">
                {summary && (<><b>{summary.total}</b> ads<span className="sep">·</span>most common angle: <b>{summary.topAngle}</b> ({summary.topCount})<span className="sep">·</span><b>{summary.fbPct}%</b> Facebook</>)}
              </div>
              <label className="sort">Sort
                <select value={sortMode} onChange={(e) => { setSortMode(e.target.value); setShown(PAGE); }}>
                  <option value="recommended">Recommended</option>
                  <option value="newest">Newest first</option>
                  <option value="longest">Longest running</option>
                  <option value="angle">By angle</option>
                </select>
              </label>
            </div>

            <div className="grid">
              {filtered.length === 0 && (<div className="noresults" style={{ gridColumn: "1/-1" }}>No ads match that filter. Try &ldquo;All angles&rdquo;.</div>)}
              {filtered.slice(0, shown).map((ad, i) => (
                <article className="ad" key={ad.headline + i}>
                  <div className={"ad__media " + ad.grad}>
                    <span className="ad__angle">{ad.angle}</span>
                    <span className="ad__plat" title={ad.platform}><PlatIcon platform={ad.platform} /></span>
                  </div>
                  <div className="ad__body">
                    <div className="ad__head">
                      {ad.status === "approved"
                        ? (<span className="ad__status ad__status--ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="m5 13 4 4L19 7" /></svg> Approved</span>)
                        : (<span className="ad__status ad__status--draft">Draft</span>)}
                      <span className="ad__where">{ad.suburb}</span>
                    </div>
                    <div className="ad__headline">{ad.headline}</div>
                    <div className="ad__copy">{ad.offer}</div>
                    <div className="ad__meta">
                      <span className="ad__cta">{ad.cta}</span>
                      <Link className="ad__use" href="/signup" onClick={() => showToast("Sign up to load “" + ad.headline + "” into the builder")}>Use this ad →</Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {filtered.length > shown && (
              <div className="loadmore is-open">
                <button className="btn btn--ghost" type="button" onClick={() => setShown((s) => s + PAGE)}>Load more — showing {Math.min(shown, filtered.length)} of {filtered.length}</button>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="site">
        <div className="foot">
          <div className="foot__brand-col">
            <div className="foot__brand"><span className="mark" />blockwise</div>
            <p>Meta ads for real estate agents. See what&rsquo;s running nearby, then launch ads built from what&rsquo;s working in your area.</p>
            <a className="foot__mail" href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
          </div>
          <div className="foot__col">
            <h4>Product</h4>
            <a href="#how">How it works</a>
            <Link href="/pricing">Pricing</Link>
            <a href="#dash">Live dashboard</a>
            <a href="#dash">Examples</a>
          </div>
          <div className="foot__col">
            <h4>Company</h4>
            <a href="mailto:hello@blockwise.sale">Contact</a>
            <CtaLink location="footer" href="/signup">Start free</CtaLink>
            <Link href="/login">Log in</Link>
          </div>
          <div className="foot__col">
            <h4>Legal</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </div>
        <div className="foot__bot">
          <div>
            <span>© 2026 Blockwise. All rights reserved.</span>
            <span>Perth, WA · built for real estate teams</span>
          </div>
        </div>
      </footer>

      <div className={"toast" + (toast ? " is-open" : "")}>{toast}</div>
    </div>
  );
}
